const fs = require("fs");
const path = require("path");

const ncp = require("ncp").ncp;
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

// Clear folders that will be packaged to ensure clean slate
rimrafSync(path.join(__dirname, "..", "bin"));
rimrafSync(path.join(__dirname, "..", "out"));
fs.mkdirSync(path.join(__dirname, "..", "out", "node_modules"), {
  recursive: true,
});
const guiDist = path.join(__dirname, "..", "..", "..", "gui", "dist");
if (!fs.existsSync(guiDist)) {
  fs.mkdirSync(guiDist, { recursive: true });
}

const skipInstalls = process.env.SKIP_INSTALLS === "true";

// Get the target to package for
let target = undefined;
const args = process.argv;
if (args[2] === "--target") {
  target = args[3];
}

let os;
let arch;
if (target) {
  [os, arch] = target.split("-");
} else {
  [os, arch] = autodetectPlatformAndArch();
}

if (os === "alpine") {
  os = "linux";
}
if (arch === "armhf") {
  arch = "arm64";
}
target = `${os}-${arch}`;
console.log("[info] Using target: ", target);

const exe = os === "win32" ? ".exe" : "";

const isInGitHubAction = !!process.env.GITHUB_ACTIONS;

const isArmTarget =
  target === "darwin-arm64" ||
  target === "linux-arm64" ||
  target === "win32-arm64";

const isWinTarget = target?.startsWith("win");
const isLinuxTarget = target?.startsWith("linux");
const isMacTarget = target?.startsWith("darwin");

// 不要なプラットフォームバイナリを削除してパッケージサイズを最適化
function cleanupUnusedPlatformBinaries(targetPlatform) {
  console.log(`[info] Cleaning up unused platform binaries for ${targetPlatform}`);
  
  try {
    // @esbuildの不要なプラットフォームを削除
    const esbuildDir = path.join(__dirname, "..", "out", "node_modules", "@esbuild");
    if (fs.existsSync(esbuildDir)) {
      const allPlatforms = fs.readdirSync(esbuildDir);
      for (const platform of allPlatforms) {
        if (platform !== targetPlatform && platform !== '.gitkeep') {
          const platformPath = path.join(esbuildDir, platform);
          if (fs.statSync(platformPath).isDirectory()) {
            const sizeBeforeCleanup = getFolderSize(platformPath);
            rimrafSync(platformPath, { force: true });
            console.log(`[info] Removed unused @esbuild/${platform} (${(sizeBeforeCleanup / 1024 / 1024).toFixed(2)} MB)`);
          }
        }
      }
    }
    
    // @lancedbの不要なプラットフォームを削除
    const lancedbDir = path.join(__dirname, "..", "out", "node_modules", "@lancedb");
    if (fs.existsSync(lancedbDir)) {
      const expectedDir = `vectordb-${targetPlatform}${isWinTarget ? "-msvc" : isLinuxTarget ? "-gnu" : ""}`;
      const allDirs = fs.readdirSync(lancedbDir);
      for (const dir of allDirs) {
        if (dir !== expectedDir && dir !== '.gitkeep') {
          const dirPath = path.join(lancedbDir, dir);
          if (fs.statSync(dirPath).isDirectory()) {
            const sizeBeforeCleanup = getFolderSize(dirPath);
            rimrafSync(dirPath, { force: true });
            console.log(`[info] Removed unused @lancedb/${dir} (${(sizeBeforeCleanup / 1024 / 1024).toFixed(2)} MB)`);
          }
        }
      }
    }
    
    // @vscode/ripgrepの不要なバイナリを削除（Windows以外のrgがある場合）
    if (isWinTarget) {
      const ripgrepBinDir = path.join(__dirname, "..", "out", "node_modules", "@vscode", "ripgrep", "bin");
      const rgPath = path.join(ripgrepBinDir, "rg");
      if (fs.existsSync(rgPath)) {
        fs.rmSync(rgPath);
        console.log(`[info] Removed unused rg binary (keeping rg.exe for Windows)`);
      }
    }
    
  } catch (error) {
    console.warn(`[warn] Error during cleanup: ${error.message}`);
  }
}

// フォルダサイズを再帰的に計算する関数
function getFolderSize(folderPath) {
  let totalSize = 0;
  
  try {
    const files = fs.readdirSync(folderPath);
    
    for (const file of files) {
      const filePath = path.join(folderPath, file);
      const stats = fs.statSync(filePath);
      
      if (stats.isDirectory()) {
        totalSize += getFolderSize(filePath);
      } else {
        totalSize += stats.size;
      }
    }
  } catch (e) {
    console.warn(`[warn] フォルダサイズ計算エラー (${folderPath}): ${e.message}`);
  }
  
  return totalSize;
}

// 追加最適化で不要なファイルを削除
function performAdditionalOptimizations() {
  console.log(`[info] Performing additional size optimizations`);
  
  try {
    // 1. 不要なonnxruntimeバイナリを削除 (CUDA/TensorRT等)
    const onnxDir = path.join(__dirname, "..", "bin", "napi-v3");
    if (fs.existsSync(onnxDir)) {
      removeOnnxRuntimeUnusedBinaries(onnxDir);
    }
    
    // 2. node_modules内の不要ファイルを削除
    removeUnnecessaryNodeModuleFiles();
    
    // 3. 不要なドキュメントやテストファイルを削除
    removeDevelopmentFiles();
    
  } catch (error) {
    console.warn(`[warn] Error during additional optimizations: ${error.message}`);
  }
}

// onnxruntimeの不要なバイナリを削除
function removeOnnxRuntimeUnusedBinaries(onnxDir) {
  const platformDirs = fs.readdirSync(onnxDir);
  
  for (const platform of platformDirs) {
    const platformPath = path.join(onnxDir, platform);
    if (!fs.statSync(platformPath).isDirectory()) continue;
    
    const archDirs = fs.readdirSync(platformPath);
    for (const arch of archDirs) {
      const archPath = path.join(platformPath, arch);
      if (!fs.statSync(archPath).isDirectory()) continue;
      
      // CUDA/TensorRT/シェアードプロバイダ等の大きなバイナリを削除
      const filesToRemove = [
        "libonnxruntime_providers_cuda.so",
        "libonnxruntime_providers_shared.so", 
        "libonnxruntime_providers_tensorrt.so",
        "onnxruntime_providers_cuda.dll",
        "onnxruntime_providers_shared.dll",
        "onnxruntime_providers_tensorrt.dll",
      ];
      
      for (const file of filesToRemove) {
        const filePath = path.join(archPath, file);
        if (fs.existsSync(filePath)) {
          const sizeMB = (fs.statSync(filePath).size / 1024 / 1024).toFixed(2);
          fs.rmSync(filePath);
          console.log(`[info] Removed ${file} (${sizeMB} MB)`);
        }
      }
    }
  }
}

// node_modules内の不要ファイルを削除
function removeUnnecessaryNodeModuleFiles() {
  const outNodeModules = path.join(__dirname, "..", "out", "node_modules");
  
  // 不要なドキュメント等を削除
  const patternsToRemove = [
    "**/README.md",
    "**/LICENSE", 
    "**/LICENSE.txt",
    "**/*.md",
    "**/docs/**",
    "**/test/**",
    "**/tests/**",
    "**/.github/**",
    "**/examples/**",
  ];
  
  for (const pattern of patternsToRemove) {
    try {
      const glob = require('glob');
      const files = glob.sync(pattern, { cwd: outNodeModules });
      let totalSize = 0;
      
      for (const file of files) {
        const filePath = path.join(outNodeModules, file);
        if (fs.existsSync(filePath)) {
          const stats = fs.statSync(filePath);
          totalSize += stats.isDirectory() ? getFolderSize(filePath) : stats.size;
          rimrafSync(filePath, { force: true });
        }
      }
      
      if (totalSize > 0) {
        console.log(`[info] Removed ${files.length} files matching ${pattern} (${(totalSize / 1024 / 1024).toFixed(2)} MB)`);
      }
    } catch (error) {
      // globが無い場合はスキップ
      console.warn(`[warn] Could not remove pattern ${pattern}: ${error.message}`);
    }
  }
}

// 開発用ファイルの削除
function removeDevelopmentFiles() {
  const outDir = path.join(__dirname, "..", "out");
  
  // 不要な開発ファイルのパターン
  const devFilesToRemove = [
    path.join(outDir, "**", "*.d.ts"),
    path.join(outDir, "**", "*.map"),
    path.join(outDir, "**", "tsconfig.json"),
    path.join(outDir, "**", ".eslintrc*"),
    path.join(outDir, "**", "jest.config*"),
  ];
  
  let totalRemoved = 0;
  for (const pattern of devFilesToRemove) {
    try {
      const glob = require('glob');
      const files = glob.sync(pattern);
      
      for (const file of files) {
        if (fs.existsSync(file)) {
          const size = fs.statSync(file).size;
          fs.rmSync(file);
          totalRemoved += size;
        }
      }
    } catch (error) {
      // globのエラーは無視
    }
  }
  
  if (totalRemoved > 0) {
    console.log(`[info] Removed development files (${(totalRemoved / 1024 / 1024).toFixed(2)} MB)`);
  }
}

void (async () => {
  const startTime = Date.now();
  console.log(
    `[info] Packaging extension for target ${target} - started at ${new Date().toISOString()}`,
  );

  // Make sure we have an initial timestamp file
  writeBuildTimestamp();

  if (!skipInstalls) {
    const installStart = Date.now();
    console.log(`[timer] Starting npm installs at ${new Date().toISOString()}`);
    await Promise.all([generateAndCopyConfigYamlSchema(), npmInstall()]);
    console.log(
      `[timer] npm installs completed in ${Date.now() - installStart}ms`,
    );
  }

  process.chdir(path.join(continueDir, "gui"));

  if (isInGitHubAction) {
    const guiBuildStart = Date.now();
    console.log(`[timer] Starting GUI build at ${new Date().toISOString()}`);
    execCmdSync("npm run build");
    console.log(
      `[timer] GUI build completed in ${Date.now() - guiBuildStart}ms`,
    );
  }

  // Copy over the dist folder to the JetBrains extension //
  const intellijExtensionWebviewPath = path.join(
    "..",
    "extensions",
    "intellij",
    "src",
    "main",
    "resources",
    "webview",
  );

  const indexHtmlPath = path.join(intellijExtensionWebviewPath, "index.html");
  fs.copyFileSync(indexHtmlPath, "tmp_index.html");
  rimrafSync(intellijExtensionWebviewPath);
  fs.mkdirSync(intellijExtensionWebviewPath, { recursive: true });

  const jetbrainsCopyStart = Date.now();
  console.log(`[timer] Starting JetBrains copy at ${new Date().toISOString()}`);
  await new Promise((resolve, reject) => {
    ncp("dist", intellijExtensionWebviewPath, (error) => {
      if (error) {
        console.warn(
          "[error] Error copying React app build to JetBrains extension: ",
          error,
        );
        reject(error);
      }
      resolve();
    });
  });
  console.log(
    `[timer] JetBrains copy completed in ${Date.now() - jetbrainsCopyStart}ms`,
  );

  // Put back index.html
  if (fs.existsSync(indexHtmlPath)) {
    rimrafSync(indexHtmlPath);
  }
  fs.copyFileSync("tmp_index.html", indexHtmlPath);
  fs.unlinkSync("tmp_index.html");

  console.log("[info] Copied gui build to JetBrains extension");

  // Then copy over the dist folder to the VSCode extension //
  const vscodeGuiPath = path.join("../extensions/vscode/gui");
  const vscodeCopyStart = Date.now();
  console.log(`[timer] Starting VSCode copy at ${new Date().toISOString()}`);
  
  // Remove existing gui directory and recreate it
  if (fs.existsSync(vscodeGuiPath)) {
    rimrafSync(vscodeGuiPath);
  }
  fs.mkdirSync(vscodeGuiPath, { recursive: true });
  
  // Use ncp with timeout and proper error handling
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('VSCode copy timeout after 30 seconds'));
    }, 30000);
    
    ncp("dist", vscodeGuiPath, { 
      dereference: true,
      clobber: true,
      stopOnErr: true 
    }, (error) => {
      clearTimeout(timeout);
      if (error) {
        console.log(
          "Error copying React app build to VSCode extension: ",
          error,
        );
        reject(error);
      } else {
        console.log("Copied gui build to VSCode extension");
        resolve();
      }
    });
  });
  console.log(
    `[timer] VSCode copy completed in ${Date.now() - vscodeCopyStart}ms`,
  );

  if (!fs.existsSync(path.join("dist", "assets", "index.js"))) {
    throw new Error("gui build did not produce index.js");
  }
  if (!fs.existsSync(path.join("dist", "assets", "index.css"))) {
    throw new Error("gui build did not produce index.css");
  }

  // Copy over native / wasm modules //
  process.chdir("../extensions/vscode");

  fs.mkdirSync("bin", { recursive: true });

  // onnxruntime-node
  const onnxCopyStart = Date.now();
  console.log(
    `[timer] Starting onnxruntime copy at ${new Date().toISOString()}`,
  );
  await new Promise((resolve, reject) => {
    ncp(
      path.join(__dirname, "../../../core/node_modules/onnxruntime-node/bin"),
      path.join(__dirname, "../bin"),
      {
        dereference: true,
      },
      (error) => {
        if (error) {
          console.warn("[info] Error copying onnxruntime-node files", error);
          reject(error);
        }
        resolve();
      },
    );
  });
  console.log(
    `[timer] onnxruntime copy completed in ${Date.now() - onnxCopyStart}ms`,
  );
  if (target) {
    // If building for production, only need the binaries for current platform
    try {
      if (!target.startsWith("darwin")) {
        rimrafSync(path.join(__dirname, "../bin/napi-v3/darwin"));
      }
      if (!target.startsWith("linux")) {
        rimrafSync(path.join(__dirname, "../bin/napi-v3/linux"));
      }
      if (!target.startsWith("win")) {
        rimrafSync(path.join(__dirname, "../bin/napi-v3/win32"));
      }

      // Also don't want to include cuda/shared/tensorrt binaries, they are too large
      if (target.startsWith("linux")) {
        const filesToRemove = [
          "libonnxruntime_providers_cuda.so",
          "libonnxruntime_providers_shared.so",
          "libonnxruntime_providers_tensorrt.so",
        ];
        filesToRemove.forEach((file) => {
          const filepath = path.join(
            __dirname,
            "../bin/napi-v3/linux/x64",
            file,
          );
          if (fs.existsSync(filepath)) {
            fs.rmSync(filepath);
          }
        });
      }
    } catch (e) {
      console.warn("[info] Error removing unused binaries", e);
    }
  }
  console.log("[info] Copied onnxruntime-node");

  // tree-sitter-wasm
  fs.mkdirSync("out", { recursive: true });

  await new Promise((resolve, reject) => {
    ncp(
      path.join(__dirname, "../../../core/node_modules/tree-sitter-wasms/out"),
      path.join(__dirname, "../out/tree-sitter-wasms"),
      { dereference: true },
      (error) => {
        if (error) {
          console.warn("[error] Error copying tree-sitter-wasm files", error);
          reject(error);
        } else {
          resolve();
        }
      },
    );
  });

  const filesToCopy = [
    "../../../core/vendor/tree-sitter.wasm",
    "../../../core/llm/llamaTokenizerWorkerPool.mjs",
    "../../../core/llm/llamaTokenizer.mjs",
    "../../../core/llm/tiktokenWorkerPool.mjs",
    "../../../core/util/start_ollama.sh",
  ];

  for (const f of filesToCopy) {
    fs.copyFileSync(
      path.join(__dirname, f),
      path.join(__dirname, "..", "out", path.basename(f)),
    );
    console.log(`[info] Copied ${path.basename(f)}`);
  }

  // tree-sitter tag query files
  // ncp(
  //   path.join(
  //     __dirname,
  //     "../../../core/node_modules/llm-code-highlighter/dist/tag-qry",
  //   ),
  //   path.join(__dirname, "../out/tag-qry"),
  //   (error) => {
  //     if (error)
  //       console.warn("Error copying code-highlighter tag-qry files", error);
  //   },
  // );

  // textmate-syntaxes
  await new Promise((resolve, reject) => {
    ncp(
      path.join(__dirname, "../textmate-syntaxes"),
      path.join(__dirname, "../gui/textmate-syntaxes"),
      (error) => {
        if (error) {
          console.warn("[error] Error copying textmate-syntaxes", error);
          reject(error);
        } else {
          resolve();
        }
      },
    );
  });

  if (!skipInstalls) {
    // GitHub Actions doesn't support ARM, so we need to download pre-saved binaries
    // 02/07/25 - the above comment is out of date, there is now support for ARM runners on GitHub Actions
    if (isArmTarget) {
      // lancedb binary
      const packageToInstall = {
        "darwin-arm64": "@lancedb/vectordb-darwin-arm64",
        "linux-arm64": "@lancedb/vectordb-linux-arm64-gnu",
        "win32-arm64": "@lancedb/vectordb-win32-arm64-msvc",
      }[target];
      console.log(
        "[info] Downloading pre-built lancedb binary: " + packageToInstall,
      );

      await Promise.all([
        copyEsbuild(target),
        copySqlite(target),
        installAndCopyNodeModules(packageToInstall, "@lancedb"),
      ]);
    } else {
      // Check if platform-specific packages already exist (installed by package-all.js)
      const esbuildDir = path.join(__dirname, "..", "node_modules", "@esbuild", target);
      const lancedbSuffix = isWinTarget ? "-msvc" : isLinuxTarget ? "-gnu" : "";
      const lancedbDir = path.join(__dirname, "..", "node_modules", "@lancedb", `vectordb-${target}${lancedbSuffix}`);
      
      if (!fs.existsSync(esbuildDir)) {
        // If platform-specific esbuild doesn't exist, install generic one
        console.log("[info] npm installing esbuild binary");
        await installAndCopyNodeModules("esbuild@0.17.19", "@esbuild");
      } else {
        console.log(`[info] Using existing platform-specific esbuild for ${target}`);
      }
      
      if (!fs.existsSync(lancedbDir)) {
        // If platform-specific lancedb doesn't exist, install it
        const lancedbPackage = {
          "win32-x64": "@lancedb/vectordb-win32-x64-msvc",
          "linux-x64": "@lancedb/vectordb-linux-x64-gnu", 
          "darwin-x64": "@lancedb/vectordb-darwin-x64",
        }[target];
        
        if (lancedbPackage) {
          console.log(`[info] Installing platform-specific lancedb binary: ${lancedbPackage}`);
          await installAndCopyNodeModules(lancedbPackage, "@lancedb");
        }
      } else {
        console.log(`[info] Using existing platform-specific lancedb for ${target}`);
      }
    }
  }

  // Install platform-specific sqlite3 binary if not current platform
  if (target !== `${process.platform}-${process.arch}`) {
    console.log(`[info] Installing platform-specific sqlite3 binary for ${target}`);
    await copySqlite(target);
  }

  console.log("[info] Copying sqlite node binding from core");
  await new Promise((resolve, reject) => {
    ncp(
      path.join(__dirname, "../../../core/node_modules/sqlite3/build"),
      path.join(__dirname, "../out/build"),
      { dereference: true },
      (error) => {
        if (error) {
          console.warn("[error] Error copying sqlite3 files", error);
          reject(error);
        } else {
          resolve();
        }
      },
    );
  });

  // Copied here as well for the VS Code test suite
  await new Promise((resolve, reject) => {
    ncp(
      path.join(__dirname, "../../../core/node_modules/sqlite3/build"),
      path.join(__dirname, "../out"),
      { dereference: true },
      (error) => {
        if (error) {
          console.warn("[error] Error copying sqlite3 files", error);
          reject(error);
        } else {
          resolve();
        }
      },
    );
  });

  // Copy node_modules for pre-built binaries
  const NODE_MODULES_TO_COPY = [
    "esbuild",
    "@esbuild",
    "@lancedb",
    "@vscode/ripgrep",
    "workerpool",
  ];

  fs.mkdirSync("out/node_modules", { recursive: true });

  await Promise.all(
    NODE_MODULES_TO_COPY.map(
      (mod) =>
        new Promise((resolve, reject) => {
          fs.mkdirSync(`out/node_modules/${mod}`, { recursive: true });
          ncp(
            `node_modules/${mod}`,
            `out/node_modules/${mod}`,
            { dereference: true },
            function (error) {
              if (error) {
                console.error(`[error] Error copying ${mod}`, error);
                reject(error);
              } else {
                console.log(`[info] Copied ${mod}`);
                resolve();
              }
            },
          );
        }),
    ),
  );

  // delete esbuild/bin because platform-specific @esbuild is downloaded
  fs.rmSync(`out/node_modules/esbuild/bin`, { recursive: true });
  
  // 不要なプラットフォームのバイナリを削除してサイズを最適化
  cleanupUnusedPlatformBinaries(target);
  
  // 追加最適化: 不要なファイルを削除してサイズを最小化
  performAdditionalOptimizations();

  console.log(`[info] Copied ${NODE_MODULES_TO_COPY.join(", ")}`);

  // Copy over any worker files
  fs.cpSync(
    "node_modules/jsdom/lib/jsdom/living/xhr/xhr-sync-worker.js",
    "out/xhr-sync-worker.js",
  );

  // Wait briefly to ensure all file operations are complete
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Validate the all of the necessary files are present
  validateFilesPresent([
    // Queries used to create the index for @code context provider
    "tree-sitter/code-snippet-queries/c_sharp.scm",

    // Queries used for @outline and @highlights context providers
    "tag-qry/tree-sitter-c_sharp-tags.scm",

    // onnx runtime bindngs
    `bin/napi-v3/${os}/${arch}/onnxruntime_binding.node`,
    `bin/napi-v3/${os}/${arch}/${
      isMacTarget
        ? "libonnxruntime.1.14.0.dylib"
        : isLinuxTarget
          ? "libonnxruntime.so.1.14.0"
          : "onnxruntime.dll"
    }`,

    // Code/styling for the sidebar
    "gui/assets/index.js",
    "gui/assets/index.css",

    // Tutorial
    "media/move-chat-panel-right.md",
    "continue_tutorial.py",
    "config_schema.json",

    // Embeddings model
    "models/all-MiniLM-L6-v2/config.json",
    "models/all-MiniLM-L6-v2/special_tokens_map.json",
    "models/all-MiniLM-L6-v2/tokenizer_config.json",
    "models/all-MiniLM-L6-v2/tokenizer.json",
    "models/all-MiniLM-L6-v2/vocab.txt",
    "models/all-MiniLM-L6-v2/onnx/model_quantized.onnx",

    // node_modules (it's a bit confusing why this is necessary)
    `node_modules/@vscode/ripgrep/bin/rg${exe}`,

    // out directory (where the extension.js lives)
    // "out/extension.js", This is generated afterward by vsce
    // web-tree-sitter
    "out/tree-sitter.wasm",
    // Worker required by jsdom
    "out/xhr-sync-worker.js",
    // SQLite3 Node native module
    "out/build/Release/node_sqlite3.node",

    // out/node_modules (to be accessed by extension.js)
    `out/node_modules/@vscode/ripgrep/bin/rg${exe}`,
    `out/node_modules/@esbuild/${
      target === "win32-arm64"
        ? "esbuild.exe"
        : target === "win32-x64"
          ? "win32-x64/esbuild.exe"
          : `${target}/bin/esbuild`
    }`,
    `out/node_modules/@lancedb/vectordb-${target}${isWinTarget ? "-msvc" : ""}${isLinuxTarget ? "-gnu" : ""}/index.node`,
    `out/node_modules/esbuild/lib/main.js`,
  ]);

  // 最終クリーンアップ: tmpディレクトリを完全に削除
  try {
    const tmpDir = path.join(__dirname, "..", "tmp");
    if (fs.existsSync(tmpDir)) {
      const tmpSize = getFolderSize(tmpDir);
      rimrafSync(tmpDir, { force: true });
      console.log(`[info] Final cleanup: removed tmp directory (${(tmpSize / 1024 / 1024).toFixed(2)} MB)`);
    }
  } catch (error) {
    console.warn(`[warn] Failed to clean up tmp directory: ${error.message}`);
  }

  console.log(
    `[timer] Prepackage completed in ${Date.now() - startTime}ms - finished at ${new Date().toISOString()}`,
  );
  process.exit(0);
})();
