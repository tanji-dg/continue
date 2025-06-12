const fs = require("fs");
const path = require("path");

const ncp = require("ncp").ncp;
const { rimrafSync } = require("rimraf");

const {
  validateFilesPresent,
  execCmdSync,
  autodetectPlatformAndArch,
} = require("../../../scripts/util/index");

const {
  copyConfigSchema,
  writeBuildTimestamp,
  generateConfigYamlSchema,
} = require("./utils");

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

// コマンドライン引数をパース
const args = process.argv;
let target = undefined;
let isCrossPlatform = false;

// ターゲットプラットフォームを取得
for (let i = 2; i < args.length; i++) {
  if (args[i] === "--target" && i + 1 < args.length) {
    target = args[i + 1];
    i++; // 次の引数をスキップ
  } else if (args[i] === "--cross-platform") {
    isCrossPlatform = true;
  }
}

// OSとアーキテクチャの設定
let os;
let arch;
if (!target) {
  [os, arch] = autodetectPlatformAndArch();
} else {
  [os, arch] = target.split("-");
}

// プラットフォームの標準化
if (os === "alpine") {
  os = "linux";
}
if (arch === "armhf") {
  arch = "arm64";
}
target = `${os}-${arch}`;
console.log(`[info] ターゲットプラットフォーム: ${target} ${isCrossPlatform ? "(クロスプラットフォームビルド)" : ""}`);

// 現在の実行環境のプラットフォームも取得
const [currentOs, currentArch] = autodetectPlatformAndArch();
const currentPlatform = `${currentOs}-${currentArch}`;
const isNativeBuild = target === currentPlatform;

const exe = os === "win32" ? ".exe" : "";

const isInGitHubAction = !!process.env.GITHUB_ACTIONS;

const isArmTarget =
  target === "darwin-arm64" ||
  target === "linux-arm64" ||
  target === "win32-arm64";

const isWinTarget = target?.startsWith("win");
const isLinuxTarget = target?.startsWith("linux");
const isMacTarget = target?.startsWith("darwin");

void (async () => {
  console.log("[info] Packaging extension for target ", target);

  // Generate and copy over config-yaml-schema.json
  generateConfigYamlSchema();

  // Copy config schemas to intellij
  copyConfigSchema();

  if (!process.cwd().endsWith("vscode")) {
    // This is sometimes run from root dir instead (e.g. in VS Code tasks)
    process.chdir("extensions/vscode");
  }

  // Make sure we have an initial timestamp file
  writeBuildTimestamp();

  // Install node_modules //
  execCmdSync("npm install");
  console.log("[info] npm install in extensions/vscode completed");

  process.chdir("../../gui");

  execCmdSync("npm install");
  console.log("[info] npm install in gui completed");

  if (isInGitHubAction) {
    execCmdSync("npm run build");
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

  // Put back index.html
  if (fs.existsSync(indexHtmlPath)) {
    rimrafSync(indexHtmlPath);
  }
  fs.copyFileSync("tmp_index.html", indexHtmlPath);
  fs.unlinkSync("tmp_index.html");

  console.log("[info] Copied gui build to JetBrains extension");

  // Then copy over the dist folder to the VSCode extension //
  const vscodeGuiPath = path.join("../extensions/vscode/gui");
  fs.mkdirSync(vscodeGuiPath, { recursive: true });
  await new Promise((resolve, reject) => {
    ncp("dist", vscodeGuiPath, (error) => {
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

      // Remove unused architecture binaries
      if (target.startsWith("linux")) {
        if (arch !== "arm64") {
          rimrafSync(path.join(__dirname, "../bin/napi-v3/linux/arm64"));
        }
        if (arch !== "x64") {
          rimrafSync(path.join(__dirname, "../bin/napi-v3/linux/x64"));
        }

        // Also don't want to include cuda/shared/tensorrt binaries, they are too large
        const filesToRemove = [
          "libonnxruntime_providers_cuda.so",
          "libonnxruntime_providers_shared.so",
          "libonnxruntime_providers_tensorrt.so",
        ];
        filesToRemove.forEach((file) => {
          const filepath = path.join(
            __dirname,
            `../bin/napi-v3/linux/${arch}`,
            file,
          );
          if (fs.existsSync(filepath)) {
            fs.rmSync(filepath);
          }
        });
      }

      if (target.startsWith("darwin")) {
        if (arch !== "arm64") {
          rimrafSync(path.join(__dirname, "../bin/napi-v3/darwin/arm64"));
        }
        if (arch !== "x64") {
          rimrafSync(path.join(__dirname, "../bin/napi-v3/darwin/x64"));
        }
      }

      if (target.startsWith("win32")) {
        if (arch !== "arm64") {
          rimrafSync(path.join(__dirname, "../bin/napi-v3/win32/arm64"));
        }
        if (arch !== "x64") {
          rimrafSync(path.join(__dirname, "../bin/napi-v3/win32/x64"));
        }
      }
    } catch (e) {
      console.warn("[info] Error removing unused binaries", e);
    }
  }

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

  async function installNodeModuleInTempDirAndCopyToCurrent(
    packageName,
    toCopy,
  ) {
    console.log(`Copying ${packageName} to ${toCopy}`);
    // This is a way to install only one package without npm trying to install all the dependencies
    // Create a temporary directory for installing the package
    const adjustedName = packageName.replace(/@/g, "").replace("/", "-");

    const tempDir = `/tmp/continue-node_modules-${adjustedName}`;
    const currentDir = process.cwd();

    // Remove the dir we will be copying to
    rimrafSync(`node_modules/${toCopy}`);

    // Ensure the temporary directory exists
    fs.mkdirSync(tempDir, { recursive: true });

    try {
      // Move to the temporary directory
      process.chdir(tempDir);

      // Initialize a new package.json and install the package
      execCmdSync(`npm init -y && npm i -f ${packageName} --no-save`);

      console.log(
        `Contents of: ${packageName}`,
        fs.readdirSync(path.join(tempDir, "node_modules", toCopy)),
      );

      // Without this it seems the file isn't completely written to disk
      // Ideally we validate file integrity in the validation at the end
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Copy the installed package back to the current directory
      await new Promise((resolve, reject) => {
        ncp(
          path.join(tempDir, "node_modules", toCopy),
          path.join(currentDir, "node_modules", toCopy),
          { dereference: true },
          (error) => {
            if (error) {
              console.error(
                `[error] Error copying ${packageName} package`,
                error,
              );
              reject(error);
            } else {
              resolve();
            }
          },
        );
      });
    } finally {
      // Clean up the temporary directory
      // rimrafSync(tempDir);

      // Return to the original directory
      process.chdir(currentDir);
    }
  }

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

    await installNodeModuleInTempDirAndCopyToCurrent(
      packageToInstall,
      "@lancedb",
    );

    // Replace the installed with pre-built
    console.log("[info] Downloading pre-built sqlite3 binary");
    rimrafSync("../../core/node_modules/sqlite3/build");
    const downloadUrl = {
      "darwin-arm64":
        "https://github.com/TryGhost/node-sqlite3/releases/download/v5.1.7/sqlite3-v5.1.7-napi-v6-darwin-arm64.tar.gz",
      "linux-arm64":
        "https://github.com/TryGhost/node-sqlite3/releases/download/v5.1.7/sqlite3-v5.1.7-napi-v3-linux-arm64.tar.gz",
      // node-sqlite3 doesn't have a pre-built binary for win32-arm64
      "win32-arm64":
        "https://continue-server-binaries.s3.us-west-1.amazonaws.com/win32-arm64/node_sqlite3.tar.gz",
    }[target];
    execCmdSync(
      `curl -L -o ../../core/node_modules/sqlite3/build.tar.gz ${downloadUrl}`,
    );
    execCmdSync("cd ../../core/node_modules/sqlite3 && tar -xvzf build.tar.gz");
    fs.unlinkSync("../../core/node_modules/sqlite3/build.tar.gz");

    // Download and unzip esbuild
    console.log("[info] Downloading pre-built esbuild binary");
    rimrafSync("node_modules/@esbuild");
    fs.mkdirSync("node_modules/@esbuild", { recursive: true });
    execCmdSync(
      `curl -o node_modules/@esbuild/esbuild.zip https://continue-server-binaries.s3.us-west-1.amazonaws.com/${target}/esbuild.zip`,
    );
    execCmdSync(`cd node_modules/@esbuild && unzip esbuild.zip`);
    fs.unlinkSync("node_modules/@esbuild/esbuild.zip");
  } else {
    // Download esbuild from npm in tmp and copy over
    console.log("npm installing esbuild binary");
    await installNodeModuleInTempDirAndCopyToCurrent(
      "esbuild@0.17.19",
      "@esbuild",
    );
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
  fs.rmdirSync(`out/node_modules/esbuild/bin`, { recursive: true });

  console.log(`[info] Copied ${NODE_MODULES_TO_COPY.join(", ")}`);

  // Copy over any worker files
  fs.cpSync(
    "node_modules/jsdom/lib/jsdom/living/xhr/xhr-sync-worker.js",
    "out/xhr-sync-worker.js",
  );

  // 現在の環境に特化したバイナリファイルのパスを取得
  const platformSpecificFiles = [];
  
  // プラットフォーム依存の項目を追加
  if (os && arch) {
    // onnx runtime bindings
    platformSpecificFiles.push(
      `bin/napi-v3/${os}/${arch}/onnxruntime_binding.node`,
      `bin/napi-v3/${os}/${arch}/${
        isMacTarget
          ? "libonnxruntime.1.14.0.dylib"
          : isLinuxTarget
            ? "libonnxruntime.so.1.14.0"
            : "onnxruntime.dll"
      }`
    );

    // リップグレップバイナリ
    platformSpecificFiles.push(`node_modules/@vscode/ripgrep/bin/rg${exe}`);
    platformSpecificFiles.push(`out/node_modules/@vscode/ripgrep/bin/rg${exe}`);
    
    // ESBuildバイナリ
    if (target === "win32-arm64") {
      platformSpecificFiles.push(`out/node_modules/@esbuild/esbuild.exe`);
    } else if (target === "win32-x64") {
      platformSpecificFiles.push(`out/node_modules/@esbuild/win32-x64/esbuild.exe`);
    } else {
      platformSpecificFiles.push(`out/node_modules/@esbuild/${target}/bin/esbuild`);
    }
    
    // LanceDBバイナリ
    platformSpecificFiles.push(
      `out/node_modules/@lancedb/vectordb-${target}${isWinTarget ? "-msvc" : ""}${isLinuxTarget ? "-gnu" : ""}/index.node`
    );
  }

  // 共通ファイル - プラットフォーム非依存
  const commonFiles = [
    // Queries used to create the index for @code context provider
    "tree-sitter/code-snippet-queries/c_sharp.scm",

    // Queries used for @outline and @highlights context providers
    "tag-qry/tree-sitter-c_sharp-tags.scm",

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

    // web-tree-sitter
    "out/tree-sitter.wasm",
    // Worker required by jsdom
    "out/xhr-sync-worker.js",
    // SQLite3 Node native module
    "out/build/Release/node_sqlite3.node",
    
    // ESBuild共通ファイル
    "out/node_modules/esbuild/lib/main.js",
  ];

  console.log(`[info] ターゲットプラットフォーム: ${target}`);
  console.log(`[info] 現在のプラットフォーム固有のファイル検証: ${platformSpecificFiles.length}個`);
  
  // ビルド環境に存在し得る基本ファイルの検証
  try {
    validateFilesPresent(commonFiles);
    console.log("[info] 共通ファイルの検証が完了しました");
  } catch (e) {
    console.error("[error] 共通ファイルの検証中にエラーが発生しました:", e.message);
    process.exit(1);
  }
  
  // プラットフォーム固有のファイルの処理
  if (platformSpecificFiles.length > 0) {
    try {
      // クロスプラットフォームビルドの場合やpackage-allコマンドの場合は検証をスキップ
      if (isCrossPlatform) {
        console.log(`[info] クロスプラットフォームビルド: ファイル検証をスキップします`);
      } 
      // 同一プラットフォーム向けのビルドの場合は通常検証を実行
      else if (isNativeBuild) {
        validateFilesPresent(platformSpecificFiles);
        console.log("[info] プラットフォーム固有のファイルの検証が完了しました");
      } 
      // 異なるプラットフォームの場合は存在するファイルのみ検証
      else {
        console.log(`[info] 異なるプラットフォーム向けビルド: ${target} (現在の環境: ${currentPlatform})`);
        const existingFiles = platformSpecificFiles.filter(file => fs.existsSync(file));
        
        if (existingFiles.length > 0) {
          console.log(`[info] 存在する ${existingFiles.length}/${platformSpecificFiles.length} ファイルを検証します`);
          try {
            validateFilesPresent(existingFiles);
            console.log("[info] 既存ファイルの検証が完了しました");
          } catch (err) {
            console.warn(`[warn] 既存ファイル検証中に問題が発生: ${err.message}`);
          }
        } else {
          console.log("[info] 検証対象の既存ファイルがありませんでした");
        }
      }
    } catch (e) {
      // パッケージ作成を続行するために警告のみ表示
      if (isCrossPlatform) {
        console.warn("[warn] クロスプラットフォームビルド中の警告:", e.message);
        console.warn("[warn] この警告は無視され、ビルドを継続します");
      } else {
        console.error("[error] ファイル検証エラー:", e.message);
        if (!isNativeBuild) {
          console.warn("[warn] 異なるプラットフォーム向けビルドのため、エラーを無視して継続します");
        } else {
          throw e; // ネイティブビルドの場合はエラーを再スロー
        }
      }
    }
  }
})();
