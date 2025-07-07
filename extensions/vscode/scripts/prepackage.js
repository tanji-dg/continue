const fs = require("fs");
const path = require("path");
const { rimrafSync } = require("rimraf");
const {
  validateFilesPresent,
  execCmdSync,
  autodetectPlatformAndArch,
} = require("../../../scripts/util/index");
const { copySqlite, copyEsbuild } = require("./download-copy-sqlite-esbuild");
const { generateAndCopyConfigYamlSchema } = require("./generate-copy-config");
const { installAndCopyNodeModules } = require("./install-copy-nodemodule");
const { npmInstall } = require("./npm-install");
const { writeBuildTimestamp, continueDir } = require("./utils");

// 非同期リソーストラッキング
const async_hooks = require('async_hooks');
const activeHandles = new Set();

const asyncHook = async_hooks.createHook({
  init(asyncId, type, triggerAsyncId, resource) {
    activeHandles.add({ asyncId, type });
  },
  destroy(asyncId) {
    for (const handle of activeHandles) {
    // Workerプールの終了
        activeHandles.delete(handle);
        break;
      }
    if (workerPool && workerPool.stats().activeTasks === 0) {
    }
  }
});

// リソースクリーンアップ
function cleanupResources() {
  try {
    // アクティブハンドルの強制クリーンアップ
    process._getActiveHandles().forEach(handle => {
      if (handle.close) handle.close();
    });
  } catch (e) {
    console.warn('[cleanup] Cleanup error:', e.message);
  }
}

// 同期ファイル操作ヘルパー
function syncCopy(source, dest) {
  try {
    const stat = fs.statSync(source);
    if (stat.isDirectory()) {
      fs.cpSync(source, dest, { recursive: true, force: true });
      console.log(`[copy] Directory copied: ${source} → ${dest}`);
    } else {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(source, dest);
      console.log(`[copy] File copied: ${source} → ${dest}`);
    }
  } catch (error) {
    console.error(`[error] Copy failed: ${source} → ${dest}`, error);
    process.exit(1);
  }
}

// メイン処理
(async () => {
  try {
    // 初期化処理
    console.log('[init] Starting packaging process');
    const startTime = Date.now();

    // クリーンアップ
    rimrafSync(path.join(__dirname, "..", "bin"));
    rimrafSync(path.join(__dirname, "..", "out"));
    fs.mkdirSync(path.join(__dirname, "..", "out", "node_modules"), { recursive: true });

    // 引数解析
    let target, isCrossPlatform = false;
    process.argv.slice(2).forEach((arg, i, arr) => {
      if (arg === "--target") target = arr[i+1];
      if (arg === "--cross-platform") isCrossPlatform = true;
    });

    // プラットフォーム検出
    let [os, arch] = target ? target.split('-') : autodetectPlatformAndArch();
    os = os === 'alpine' ? 'linux' : os;
    arch = arch === 'armhf' ? 'arm64' : arch;
    target = `${os}-${arch}`;
    console.log(`[config] Target platform: ${target}`);

    // 事前処理
    writeBuildTimestamp();
    await Promise.all([generateAndCopyConfigYamlSchema(), npmInstall()]);

    // GUIビルド処理
    process.chdir(path.join(continueDir, "gui"));
    execCmdSync("npm run build");

    // JetBrains拡張へのコピー
    const intellijWebviewPath = path.join(
      "..", "extensions", "intellij", "src", "main", "resources", "webview"
    );
    syncCopy("dist", intellijWebviewPath);

    // VSCode拡張へのコピー
    const vscodeGuiPath = path.join("..", "extensions", "vscode", "gui");
    syncCopy("dist", vscodeGuiPath);

    // ネイティブモジュールコピー
    process.chdir("../extensions/vscode");
    fs.mkdirSync("bin", { recursive: true });
    syncCopy(
      path.join(__dirname, "../../../core/node_modules/onnxruntime-node/bin"),
      path.join(__dirname, "../bin")
    );

    // プラットフォーム固有のクリーンアップ
    if (target) {
      const nativeDir = path.join(__dirname, `../bin/napi-v3/${os}`);
      if (fs.existsSync(nativeDir)) {
        fs.readdirSync(nativeDir).forEach(dir => {
          if (dir !== arch) {
            rimrafSync(path.join(nativeDir, dir));
          }
        });
      }
    }

    // 依存関係コピー
    const dependencies = [
      { src: "../../../core/vendor/tree-sitter.wasm", dest: "out/tree-sitter.wasm" },
      { src: "../../../core/llm/llamaTokenizerWorkerPool.mjs", dest: "out/llamaTokenizerWorkerPool.mjs" },
      { src: "../../../core/llm/tiktokenWorkerPool.mjs", dest: "out/tiktokenWorkerPool.mjs" },
      { src: "../../../core/util/start_ollama.sh", dest: "out/start_ollama.sh" }
    ];

    dependencies.forEach(({ src, dest }) => {
      syncCopy(path.join(__dirname, src), path.join(__dirname, "../", dest));
    });

    // モジュールインストール
    if (target.includes('arm64')) {
      const pkgMap = {
        'darwin-arm64': '@lancedb/vectordb-darwin-arm64',
        'linux-arm64': '@lancedb/vectordb-linux-arm64-gnu',
        'win32-arm64': '@lancedb/vectordb-win32-arm64-msvc'
      };
      await Promise.all([
        installAndCopyNodeModules(pkgMap[target], '@lancedb'),
        copySqlite(target),
        copyEsbuild(target)
      ]);
    } else {
      await Promise.all([
        installAndCopyNodeModules('esbuild@0.17.19', '@esbuild'),
        copySqlite(target)
      ]);
    }

    // Copy sqlite3 binary after download
    syncCopy(
      path.join(__dirname, "../../../core/node_modules/sqlite3/build"),
      path.join(__dirname, "../out/build")
    );

    // 最終検証
    const requiredFiles = [
      'gui/assets/index.js',
      'gui/assets/index.css',
      'out/tree-sitter.wasm',
      'out/build/Release/node_sqlite3.node'
    ];
    validateFilesPresent(requiredFiles);

    console.log(`[success] Packaging completed in ${((Date.now() - startTime)/1000).toFixed(2)}s`);

  } catch (error) {
    console.error('[error] Critical failure:', error);
    process.exitCode = 1;
  } finally {
    // クリーンアップ実行
    cleanupResources();

    // 非同期リソースチェック
    process.on('beforeExit', (code) => {
      if (activeHandles.size > 0) {
        console.error('[error] Pending async handles:', activeHandles);
        process.exit(1);
      }
    });

    // プロセス終了保証
    setTimeout(() => {
      console.log('[info] Force exiting process');
      process.exit(process.exitCode || 0);
    }, 1000).unref();
  }
})();