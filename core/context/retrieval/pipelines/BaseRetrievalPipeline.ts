// @ts-ignore
import kuromoji from "kuromoji";
import * as path from 'path';
// @ts-ignore
import nlp from "wink-nlp-utils";

import { BranchAndDir, Chunk, ContinueConfig, IDE, ILLM } from "../../../";
import { chunkDocument } from "../../../indexing/chunk/chunk";
import { FullTextSearchCodebaseIndex } from "../../../indexing/FullTextSearchCodebaseIndex";
import { LanceDbIndex } from "../../../indexing/LanceDbIndex";
import { recentlyEditedFilesCache } from "../recentlyEditedFilesCache";

const DEFAULT_CHUNK_SIZE = 384;

export interface RetrievalPipelineOptions {
  llm: ILLM;
  config: ContinueConfig;
  ide: IDE;
  input: string;
  nRetrieve: number;
  nFinal: number;
  tags: BranchAndDir[];
  filterDirectory?: string;
}

export interface RetrievalPipelineRunArguments {
  query: string;
  tags: BranchAndDir[];
  filterDirectory?: string;
  includeEmbeddings: boolean;
}

export interface IRetrievalPipeline {
  run(args: RetrievalPipelineRunArguments): Promise<Chunk[]>;
}

// kuromoji の Tokenizer が返すオブジェクトの型定義
interface IpadicFeatures {
  word_id: number;
  word_type: string;
  surface_form: string;
  pos: string;
  pos_detail_1: string;
  pos_detail_2: string;
  pos_detail_3: string;
  conjugated_type: string;
  conjugated_form: string;
  basic_form: string;
  reading: string;
  pronunciation: string;
}

class NLPProcessor {

  private tokenizer: kuromoji.Tokenizer<IpadicFeatures> | null = null; // 型を修正

  private tokenizerBuildPromise: Promise<kuromoji.Tokenizer<IpadicFeatures>>; // 型を修正

  constructor() {
    // __dirname を使用してスクリプトファイルのディレクトリを取得
    const dicPath: string = path.join(__dirname, 'kuromoji_dict');
    console.log(dicPath);

    // Promiseを作成してtokenizerのbuildをラップする
    this.tokenizerBuildPromise = new Promise<kuromoji.Tokenizer<IpadicFeatures>>((resolve, reject) => {  // 型を修正
      kuromoji.builder({ dicPath: dicPath }).build((err, tokenizer) => {
        if (err) {
          console.error("Kuromoji tokenizer error:", err);
          reject(err); // エラーが発生したらPromiseをreject
          return;
        }
        this.tokenizer = tokenizer as kuromoji.Tokenizer<IpadicFeatures>; // 型アサーションを追加
        console.log("Kuromoji tokenizer initialized.");
        resolve(tokenizer as kuromoji.Tokenizer<IpadicFeatures>); // 型アサーションを追加
      });
    });
  }

  // tokenizerのbuildが完了するまで待つ関数
  async waitForTokenizerBuild(): Promise<void> {
    if (!this.tokenizer) {
      await this.tokenizerBuildPromise;
    }
  }

  private isJapanese(text: string): boolean {
    return /[一-龠ぁ-んァ-ン]/.test(text);
  }

  getCleanedTrigrams(query: string): string[] {
    if (this.isJapanese(query)) {
      return this.getJapaneseTrigrams(query);
    } else {
      return this.getEnglishTrigrams(query);
    }
  }

  private getJapaneseTrigrams(query: string): string[] {
    if (!this.tokenizer) throw new Error("Tokenizer not initialized");

    // 1. 形態素解析
    const tokens = this.tokenizer.tokenize(query);

    // 2. 名詞・動詞を抽出
    const words = tokens
      .filter(token => token.pos === "名詞" || token.pos === "動詞")
      .map(token => token.basic_form !== '*' ? token.basic_form : token.surface_form);

    // 3. ストップワードを除去
    const stopwords = new Set(["の", "は", "が", "を", "に", "で", "と", "も", "する", "なる"]);
    const filteredWords = words.filter(word => !stopwords.has(word));

    // 4. 重複削除
    const uniqueWords = [...new Set(filteredWords)];

    // 5. 3-gram の生成
    return uniqueWords.length < 3
      ? uniqueWords  // 2単語以下ならそのまま配列を返す
      : uniqueWords.map((_, i, arr) => arr.slice(i, i + 3))  // 3-gram 配列の生成
        .filter(trigram => trigram.length === 3)  // 3単語のものだけを抽出
        .flat();  // フラット化して1次元の配列にする
  }

  private getEnglishTrigrams(query: string): string[] {
    let text = nlp.string.removeExtraSpaces(query);
    text = nlp.string.stem(text);

    let tokens = nlp.string
      .tokenize(text, true)
      .filter((token: any) => token.tag === "word")
      .map((token: any) => token.value);

    tokens = nlp.tokens.removeWords(tokens);
    tokens = nlp.tokens.setOfWords(tokens);

    const cleanedTokens = [...tokens].join(" ");
    return nlp.string.ngram(cleanedTokens, 3);
  }
}

export default class BaseRetrievalPipeline implements IRetrievalPipeline {
  private ftsIndex = new FullTextSearchCodebaseIndex();
  private lanceDbIndex: LanceDbIndex | null = null;
  private processor = new NLPProcessor();

  constructor(protected readonly options: RetrievalPipelineOptions) {
    void this.initLanceDb();
  }

  private async initLanceDb() {
    const embedModel = this.options.config.selectedModelByRole.embed;

    if (!embedModel) {
      return;
    }

    this.lanceDbIndex = await LanceDbIndex.create(embedModel, (uri) =>
      this.options.ide.readFile(uri),
    );
  }

  private getCleanedTrigrams(
    query: RetrievalPipelineRunArguments["query"],
  ): string[] {
    return this.processor.getCleanedTrigrams(query);
  }

  private escapeFtsQueryString(query: string): string {
    const escapedDoubleQuotes = query.replace(/"/g, '""');
    return `"${escapedDoubleQuotes}"`;
  }

  protected async retrieveFts(
    args: RetrievalPipelineRunArguments,
    n: number,
  ): Promise<Chunk[]> {
    if (args.query.trim() === "") {
      return [];
    }

    await this.processor.waitForTokenizerBuild();

    const tokensRaw = this.getCleanedTrigrams(args.query).join(" OR ");
    const tokens = this.escapeFtsQueryString(tokensRaw);

    return await this.ftsIndex.retrieve({
      n,
      text: tokens,
      tags: args.tags,
      directory: args.filterDirectory,
    });
  }

  protected async retrieveAndChunkRecentlyEditedFiles(
    n: number,
  ): Promise<Chunk[]> {
    const recentlyEditedFilesSlice = Array.from(
      recentlyEditedFilesCache.keys(),
    ).slice(0, n);

    // If the number of recently edited files is less than the retrieval limit,
    // include additional open files. This is useful in the case where a user
    // has many tabs open and reloads their IDE. They now have 0 recently edited files,
    // but many open tabs that represent what they were working on prior to reload.
    if (recentlyEditedFilesSlice.length < n) {
      const openFiles = await this.options.ide.getOpenFiles();
      recentlyEditedFilesSlice.push(
        ...openFiles.slice(0, n - recentlyEditedFilesSlice.length),
      );
    }

    const chunks: Chunk[] = [];

    for (const filepath of recentlyEditedFilesSlice) {
      const contents = await this.options.ide.readFile(filepath);
      const fileChunks = chunkDocument({
        filepath,
        contents,
        maxChunkSize:
          this.options.config.selectedModelByRole.embed
            ?.maxEmbeddingChunkSize ?? DEFAULT_CHUNK_SIZE,
        digest: filepath,
      });

      for await (const chunk of fileChunks) {
        chunks.push(chunk);
      }
    }

    return chunks.slice(0, n);
  }

  protected async retrieveEmbeddings(
    input: string,
    n: number,
  ): Promise<Chunk[]> {
    if (!this.lanceDbIndex) {
      console.warn(
        "LanceDB index not available, skipping embeddings retrieval",
      );
      return [];
    }

    return this.lanceDbIndex.retrieve(
      input,
      n,
      this.options.tags,
      this.options.filterDirectory,
    );
  }

  run(args: RetrievalPipelineRunArguments): Promise<Chunk[]> {
    throw new Error("Not implemented");
  }
}