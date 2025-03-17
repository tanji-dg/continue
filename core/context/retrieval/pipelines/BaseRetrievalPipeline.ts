// @ts-ignore
import kuromoji from "kuromoji";
import * as path from 'path';
// @ts-ignore
import nlp from "wink-nlp-utils";

import {
  BranchAndDir,
  Chunk,
  ContextItem,
  ContinueConfig,
  IDE,
  ILLM,
  Tool,
  ToolExtras,
} from "../../../";
import { openedFilesLruCache } from "../../../autocomplete/util/openedFilesLruCache";
import { chunkDocument } from "../../../indexing/chunk/chunk";
import { FullTextSearchCodebaseIndex } from "../../../indexing/FullTextSearchCodebaseIndex";
import { LanceDbIndex } from "../../../indexing/LanceDbIndex";
import { BuiltInToolNames } from "../../../tools/builtIn";
import { callBuiltInTool } from "../../../tools/callTool";
import { globSearchTool } from "../../../tools/definitions/globSearch";
import { grepSearchTool } from "../../../tools/definitions/grepSearch";
import { lsTool } from "../../../tools/definitions/lsTool";
import { readFileTool } from "../../../tools/definitions/readFile";
import { viewRepoMapTool } from "../../../tools/definitions/viewRepoMap";
import { viewSubdirectoryTool } from "../../../tools/definitions/viewSubdirectory";

const DEFAULT_CHUNK_SIZE = 384;

const AVAILABLE_TOOLS: Tool[] = [
  globSearchTool,
  grepSearchTool,
  lsTool,
  readFileTool,
  viewRepoMapTool,
  viewSubdirectoryTool,
];

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

class NLPProcessor {

  private tokenizer: kuromoji.Tokenizer<string> | null = null;

  private tokenizerBuildPromise: Promise<kuromoji.Tokenizer<string>>;

  constructor() {
    // __dirname を使用してスクリプトファイルのディレクトリを取得
    const dicPath: string = path.join(__dirname, 'kuromoji_dict');
    console.log(dicPath);

    // Promiseを作成してtokenizerのbuildをラップする
    this.tokenizerBuildPromise = new Promise((resolve, reject) => {
      kuromoji.builder({ dicPath: dicPath }).build((err, tokenizer) => {
        if (err) {
          console.error("Kuromoji tokenizer error:", err);
          reject(err); // エラーが発生したらPromiseをreject
          return;
        }
        this.tokenizer = tokenizer;
        console.log("Kuromoji tokenizer initialized.");
        resolve(tokenizer); // 成功したらPromiseをresolve
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
      .map(token => token.basic_form || token.surface_form);

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
<<<<<<< HEAD
    return nlp.string.ngram(cleanedTokens, 3);
=======
    const trigrams = nlp.string.ngram(cleanedTokens, 3);

    return trigrams.map(this.escapeFtsQueryString);
>>>>>>> 284b53065 (WIP)
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
    const escapedDoubleQuotes = query.replace(/\"/g, '""');
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

	const tokens = this.getCleanedTrigrams(args.query).join(" OR ");

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
      openedFilesLruCache.keys(),
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

  protected async retrieveWithTools(input: string): Promise<Chunk[]> {
    const toolSelectionPrompt = `Given the following user input: \"${input}\"\n\nAvailable tools:\n${AVAILABLE_TOOLS.map((tool) => {
  const requiredParams = tool.function.parameters?.required || [];
  const properties = tool.function.parameters?.properties || {};
  const paramDescriptions = requiredParams
    .map(
      (param: any) => `${param}: ${properties[param]?.description || "string"}`,
    )
    .join(", ");

  return `- ${tool.function.name}: ${tool.function.description}\n  Required arguments: ${paramDescriptions || "none"}`;
}).join("\n")}\n\nDetermine which tools should be used to answer this query. You should feel free to use multiple tools when they would be helpful for comprehensive results. Respond ONLY a JSON object containing the following and nothing else:\n{\n  \"tools\": [\n    {\n      \"name\": \"<tool_name>\",\n      \"args\": { \"<required_parameter_name>\": \"<required_parameter_value>\" }\n    }\n  ]\n}`;

    // Get LLM response for tool selection
    const toolSelectionResponse = await this.options.llm.chat(
      [{ role: "user", content: toolSelectionPrompt }],
      new AbortController().signal,
    );

    let toolCalls: { name: string; args: any }[] = [];
    try {
      const responseContent =
        typeof toolSelectionResponse.content === "string"
          ? toolSelectionResponse.content
          : toolSelectionResponse.content
              .map((part) => (part.type === "text" ? part.text : ""))
              .join("");
      const parsed = JSON.parse(responseContent);
      toolCalls = parsed.tools || [];
    } catch (e) {
      console.log(
        `Failed to parse tool selection response: ${toolSelectionResponse.content}\n\n`,
        e,
      );
      return [];
    }

    // Execute tools and collect results
    const allContextItems: ContextItem[] = [];

    const toolExtras: ToolExtras = {
      ide: this.options.ide,
      llm: this.options.llm,
      fetch: fetch,
      tool: grepSearchTool,
      config: this.options.config,
    };

    for (const toolCall of toolCalls) {
      const tool = AVAILABLE_TOOLS.find(
        (t) => t.function.name === toolCall.name,
      )!;

      const args = toolCall.args;
      if (toolCall.name === BuiltInToolNames.GrepSearch) {
        args.splitByFile = true;
      }

      toolExtras.tool = tool;
      const contextItems = await callBuiltInTool(
        toolCall.name,
        args,
        toolExtras,
      );
      allContextItems.push(...contextItems);
    }

    const chunks: Chunk[] = [];

    // Transform ContextItem[] to Chunk[]
    for (let i = 0; i < allContextItems.length; i++) {
      const contextItem = allContextItems[i];
      const filepath = contextItem.uri?.value || contextItem.name || "unknown";
      const cleanedFilepath = filepath.replace(/^file:\/\/\//, "");

      chunks.push({
        content: contextItem.content,
        startLine: -1,
        endLine: -1,
        digest: `file:\/\/\/${cleanedFilepath}`,
        filepath: `file:\/\/\/${cleanedFilepath}`,
        index: i,
      });
    }

    console.log("retrieveWithTools chunks", chunks);
    return chunks;
  }
}