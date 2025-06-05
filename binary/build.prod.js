const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");
const { execCmdSync } = require("../scripts/util");

const esbuildOutputFile = "out/index.js";

// プロダクション専用のesbuildビルド
async function buildWithEsbuildProduction() {
  console.log("[info] Building with esbuild (production)...");
  await esbuild.build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    outfile: esbuildOutputFile,
    external: [
      "esbuild",
      "./xhr-sync-worker.js",
      "llamaTokenizerWorkerPool.mjs",
      "tiktokenWorkerPool.mjs",
      "vscode",
      "./index.node",
    ],
    format: "cjs",
    platform: "node",
    // プロダクションビルドではsourcemapを無効化
    sourcemap: false,
    // 最小化を有効化
    minify: true,
    treeShaking: true,
    // 名前を短縮
    keepNames: false,
    // デバッグ情報を削除
    drop: ['console', 'debugger'],
    loader: {
      ".node": "file",
    },
    // プロダクション環境変数を設定
    define: {
      "import.meta.url": "importMetaUrl",
      "process.env.NODE_ENV": '"production"'
    },
    inject: ["./importMetaUrl.js"],
    logLevel: "error",
  });

  console.log("[info] Production build complete");
}

// プロダクションビルド用のpackage.jsonを作成
function createProductionPackageJson() {
  const prodPackageJson = {
    name: "binary",
    version: "1.0.0",
    author: "Continue Dev, Inc",
    license: "Apache-2.0",
    // プロダクション用の最小限の設定
  };

  fs.writeFileSync(
    "out/package.json",
    JSON.stringify(prodPackageJson, undefined, 2)
  );
}

(async () => {
  console.log("[info] Starting production build...");
  
  // TypeScriptコンパイル
  console.log("[info] Compiling TypeScript...");
  execCmdSync("tsc -p ./tsconfig.prod.json");
  
  // プロダクション用package.json作成
  createProductionPackageJson();
  
  // esbuildでバンドル
  await buildWithEsbuildProduction();
  
  console.log("[info] Production build completed successfully!");
})();