import { jest } from "@jest/globals";

import {
  insertMockChunks,
  mockPathAndCacheKey,
  updateIndexAndAwaitGenerator,
} from "./test/indexing";

import { getIndexSqlitePath } from "../util/paths";
import { FullTextSearchCodebaseIndex } from "./FullTextSearchCodebaseIndex";
import { DatabaseConnection, SqliteDb } from "./refreshIndex";
import { IndexResultType } from "./types";

describe.skip("FullTextSearchCodebaseIndex", () => {
  let index: FullTextSearchCodebaseIndex;
  let db: DatabaseConnection;

  async function getFts() {
    return await db.all("SELECT * FROM fts");
  }

  async function getFtsMetadata() {
    return await db.all("SELECT * FROM fts_metadata");
  }

  beforeEach(async () => {
    db = await SqliteDb.get();
    index = new FullTextSearchCodebaseIndex();
  });

  it("should update the index and maintain expected database state", async () => {
    const mockMarkComplete = jest
      .fn()
      .mockImplementation(() => Promise.resolve()) as any;

    await insertMockChunks();

    // Compute test
    await updateIndexAndAwaitGenerator(index, "compute", mockMarkComplete);
    expect((await getFts()).length).toBe(1);
    expect((await getFtsMetadata()).length).toBe(1);
    expect(mockMarkComplete).toHaveBeenCalledWith(
      [mockPathAndCacheKey],
      IndexResultType.Compute,
    );

    // RemoveTag test - currently, we don't do anything other than mark complete
    await updateIndexAndAwaitGenerator(index, "removeTag", mockMarkComplete);
    expect(mockMarkComplete).toHaveBeenCalledWith(
      [mockPathAndCacheKey],
      IndexResultType.RemoveTag,
    );

    // AddTag test - currently, we don't do anything other than mark complete
    await updateIndexAndAwaitGenerator(index, "addTag", mockMarkComplete);
    expect(mockMarkComplete).toHaveBeenCalledWith(
      [mockPathAndCacheKey],
      IndexResultType.AddTag,
    );

    // Delete test
    await updateIndexAndAwaitGenerator(index, "del", mockMarkComplete);
    expect((await getFts()).length).toBe(0);
    expect((await getFtsMetadata()).length).toBe(0);
    expect(mockMarkComplete).toHaveBeenCalledWith(
      [mockPathAndCacheKey],
      IndexResultType.Delete,
    );
  });
});

describe("全文検索のテスト", () => {
  let db: DatabaseConnection;

  console.log(getIndexSqlitePath());

  beforeEach(async () => {
    db = await SqliteDb.get();
  });

  it("Drv", async () => {
    const query = "\n      SELECT fts_metadata.chunkId, fts_metadata.path, fts.content, rank\n      FROM fts\n      JOIN fts_metadata ON fts.rowid = fts_metadata.id\n      JOIN chunk_tags ON fts_metadata.chunkId = chunk_tags.chunkId\n      WHERE fts MATCH ?\n      AND chunk_tags.tag IN (?)\n      \n      ORDER BY bm25(fts, 10)\n      LIMIT ?\n    ";
    const parameters = [
      "msd OR sdr OR drv OR rvi OR vin OR ini OR nit OR itl OR tla OR lam OR amp OR mps OR pse OR ser OR eri",
      //"Drv",
      "file:///d%3A/git/sysu-gitlab/continue/drv::dg/sjis_support::chunks",
      //"file:///d%3A/git/sysu-gitlab/continue/drv::NONE::chunks",
      2,
    ];

    let results = await db.all(query, parameters);
    expect(results.length).toBeGreaterThan(1);
  });

  it("delay.h", async () => {
    const query = "SELECT fts_metadata.chunkId, fts_metadata.path, fts.content, rank FROM fts JOIN fts_metadata ON fts.rowid = fts_metadata.id WHERE fts.content LIKE ? OR fts_metadata.path LIKE ?  LIMIT ?;";
    const parameters = [
      //"'del' OR 'ela' OR 'lay' OR 'ay ' OR 'y h'",
      //"del OR ela OR lay OR ay\\  OR y\\ h",
      "del",
      "file:///d%3A/git/sysu-gitlab/continue/drv::dg/sjis_support::chunks",
      //"file:///d%3A/git/sysu-gitlab/continue/drv::NONE::chunks",
      2,
    ];
    let results = await db.all(query, parameters);
    expect(results.length).toEqual(0);
  });

  it("日本語", async () => {
    const query = "\n      SELECT fts_metadata.chunkId, fts_metadata.path, fts.content, rank\n      FROM fts\n      JOIN fts_metadata ON fts.rowid = fts_metadata.id\n      JOIN chunk_tags ON fts_metadata.chunkId = chunk_tags.chunkId\n      WHERE fts MATCH ?\n      AND chunk_tags.tag IN (?)\n      \n      ORDER BY bm25(fts, 10)\n      LIMIT ?\n    ";
    const parameters = [
      "ランプ OR ンプド OR プドラ OR ドライ OR ライバ",
      "file:///d%3A/git/sysu-gitlab/continue/drv::dg/sjis_support::chunks",
      2,
    ];
    let results = await db.all(query, parameters);
    expect(results.length).toBeGreaterThan(1);
    //console.log(results);
  });

  it("最低限", async () => {
    const query = "SELECT * FROM fts WHERE fts MATCH ?";
    const parameters = [
      //"\"msd OR sdr OR drv OR rvi OR vin OR ini OR nit OR itl OR tla OR lam OR amp OR mps OR pse OR ser OR eri\""
      "msd OR sdr OR drv OR rvi OR vin OR ini OR nit OR itl OR tla OR lam OR amp OR mps OR pse OR ser OR eri",
      //"Drv OR drv OR rvi",
    ];
    let results = await db.all(query, parameters);
    expect(results.length).toBeGreaterThan(1);
  });

}); 

describe.skip("ftsのテスト", () => {
  let db: DatabaseConnection;

  beforeEach(async () => {
    db = await SqliteDb.get();
  });

  it("全文検索のテスト", async () => {
    //-- FTS向けテーブル作成 trigram_fts、カラムは title, text
    //-- トークナイザをtrigramに指定
     
    await db.all("CREATE VIRTUAL TABLE trigram_fts USING fts5( title, text, tokenize='trigram');");
     
    //--テストデータ挿入
     
    await db.all("INSERT INTO trigram_fts( title, text ) VALUES ('検索システム','実務者の為の開発改善ガイドブック');");
    await db.all("INSERT INTO trigram_fts( title, text ) VALUES ('推薦システム実践入門','仕事で使える導入ガイド');");
     
    // --全文検索　「ガイド」で検索
    let results : any[] = await db.all("SELECT * FROM trigram_fts WHERE trigram_fts MATCH ('ガイド');");
    expect(results.length).toBeGreaterThan(1);
    console.log(results);
  });

});
