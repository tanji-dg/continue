const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { rimrafSync } = require("rimraf");

// サポートされているすべてのプラットフォームのリスト
const ALL_PLATFORMS = [
  "win32-x64",
  "linux-x64",
  // "darwin-x64",
  // "darwin-arm64", 
  // "linux-arm64",
  // "win32-arm64",
];

const args = process.argv.slice(2);
const isPreRelease = args.includes("--pre-release");

// コマンドラインオプションの解析
const specificPlatformArg = args.find(arg => arg.startsWith("--platform="));
const specificPlatform = specificPlatformArg ? specificPlatformArg.split("=")[1] : null;

// 現在の環境を取得
const { autodetectPlatformAndArch } = require("../../../scripts/util/index");
const [currentOs, currentArch] = autodetectPlatformAndArch();
const currentPlatform = `${currentOs}-${currentArch}`;

// ビルド対象プラットフォームを決定
let targetPlatforms;

if (specificPlatform) {
  targetPlatforms = [specificPlatform];
  console.log(`[info] 指定されたプラットフォーム: ${specificPlatform} のみをビルドします`);
} else {
  targetPlatforms = [...ALL_PLATFORMS];
  console.log(`[info] すべてのプラットフォームをビルドします: ${targetPlatforms.join(', ')}`);
  
  if (args.includes("--current-platform-only")) {
    targetPlatforms = [currentPlatform];
    console.log(`[info] --current-platform-onlyオプション: 現在の環境 ${currentPlatform} のみをビルドします`);
  }
}

// バイナリサイズを確認する関数
function checkBinarySize(platform) {
  const binPath = path.join(__dirname, "..", "bin");
  const outPath = path.join(__dirname, "..", "out");
  
  let totalSize = 0;
  
  if (fs.existsSync(binPath)) {
    try {
      totalSize += getFolderSize(binPath);
    } catch (e) {
      console.log(`[info] ${platform}: bin/ サイズ取得エラー: ${e.message}`);
    }
  }
  
  if (fs.existsSync(outPath)) {
    try {
      totalSize += getFolderSize(outPath);
    } catch (e) {
      console.log(`[info] ${platform}: out/ サイズ取得エラー: ${e.message}`);
    }
  }
  
  console.log(`[info] ${platform}: 合計サイズ: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
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

// 強制的なクリーンアップ関数
function forceCleanup() {
  const pathsToClean = [
    path.join(__dirname, "..", "bin"),
    path.join(__dirname, "..", "out"),
    path.join(__dirname, "..", "node_modules", "@esbuild"),
    path.join(__dirname, "..", "node_modules", "@lancedb"),
    path.join(__dirname, "..", "node_modules", "@vscode"),
  ];
  
  pathsToClean.forEach(pathToClean => {
    if (fs.existsSync(pathToClean)) {
      try {
        console.log(`[info] 強制クリーンアップ: ${path.basename(pathToClean)}`);
        rimrafSync(pathToClean, { force: true });
      } catch (e) {
        console.warn(`[warn] クリーンアップエラー ${pathToClean}: ${e.message}`);
      }
    }
  });
}

// プラットフォーム固有の依存関係をインストールする関数
async function installPlatformDependencies(platform) {
  try {
    const [os, arch] = platform.split("-");
    
    // 既存のプラットフォーム固有パッケージをクリーンアップ
    const packagesToClean = [
      path.join(__dirname, "..", "node_modules", "@esbuild"),
      path.join(__dirname, "..", "node_modules", "@lancedb"),
    ];
    
    packagesToClean.forEach(pkg => {
      if (fs.existsSync(pkg)) {
        rimrafSync(pkg, { force: true });
        console.log(`[info] Cleaned up ${path.basename(pkg)}`);
      }
    });
    
    // @esbuild パッケージのインストール
    const esbuildPackage = `@esbuild/${platform}`;
    console.log(`[info] Installing ${esbuildPackage}...`);
    execSync(`npm install --no-save --force ${esbuildPackage}@0.17.19`, { stdio: "inherit" });
    
    // @lancedb パッケージのインストール
    const suffix = os === "win32" ? "-msvc" : os === "linux" ? "-gnu" : "";
    const lancedbPackage = `@lancedb/vectordb-${platform}${suffix}`;
    console.log(`[info] Installing ${lancedbPackage}...`);
    execSync(`npm install --no-save --force "${lancedbPackage}@>=0.4.0"`, { stdio: "inherit" });
    
    // ripgrep用のWindows実行ファイル取得（win32プラットフォームの場合）
    if (os === "win32") {
      await downloadRipgrepForWindows();
      // out/node_modulesにもコピーする
      await copyRipgrepToOut();
    }
    
  } catch (error) {
    console.warn(`[warn] プラットフォーム固有依存関係のインストール中にエラーが発生しました: ${error.message}`);
    // エラーが発生してもビルドを継続
  }
}

// Windows用のripgrep実行ファイルをダウンロード
async function downloadRipgrepForWindows() {
  console.log("[info] Setting up ripgrep for Windows...");
  
  const ripgrepBinDir = path.join(__dirname, "..", "node_modules", "@vscode", "ripgrep", "bin");
  const rgExePath = path.join(ripgrepBinDir, "rg.exe");
  const rgPath = path.join(ripgrepBinDir, "rg");
  
  // ディレクトリが存在しない場合作成
  if (!fs.existsSync(ripgrepBinDir)) {
    fs.mkdirSync(ripgrepBinDir, { recursive: true });
  }
  
  // 既にrg.exeが存在する場合はスキップ
  if (fs.existsSync(rgExePath)) {
    console.log(`[info] rg.exe already exists`);
    return;
  }
  
  // シンプルなフォールバック: 既存のrgをrg.exeとしてコピー
  if (fs.existsSync(rgPath)) {
    fs.copyFileSync(rgPath, rgExePath);
    // 実行可能権を付与（Linux上でのクロスビルドの場合）
    fs.chmodSync(rgExePath, 0o755);
    console.log(`[info] Created rg.exe from existing rg binary`);
  } else {
    console.error(`[error] Neither rg nor rg.exe found in ${ripgrepBinDir}`);
  }
}

// out/node_modulesにもripgrepをコピー
async function copyRipgrepToOut() {
  const sourceDir = path.join(__dirname, "..", "node_modules", "@vscode", "ripgrep", "bin");
  const targetDir = path.join(__dirname, "..", "out", "node_modules", "@vscode", "ripgrep", "bin");
  
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  
  const rgExePath = path.join(sourceDir, "rg.exe");
  const targetRgExePath = path.join(targetDir, "rg.exe");
  
  if (fs.existsSync(rgExePath)) {
    fs.copyFileSync(rgExePath, targetRgExePath);
    fs.chmodSync(targetRgExePath, 0o755);
    console.log(`[info] Copied rg.exe to out/node_modules`);
  }
}

(async () => {
  for (const platform of targetPlatforms) {
    console.log(`\n[info] ===== プラットフォーム ${platform} 用のビルドを開始します =====`);
    
    // 各プラットフォームビルド前に強制クリーンアップ
    console.log(`[info] プラットフォーム ${platform} 用の強制クリーンアップを実行中...`);
    forceCleanup();
    
    // 追加: buildディレクトリの .vsix 以外をクリーンアップ
    const buildPath = path.join(__dirname, "..", "build");
    if (fs.existsSync(buildPath)) {
      try {
        const files = fs.readdirSync(buildPath);
        for (const file of files) {
          if (!file.endsWith('.vsix') && file !== 'meta.json') {
            const filePath = path.join(buildPath, file);
            rimrafSync(filePath, { force: true });
            console.log(`[info] build ディレクトリ内 ${file} をクリーンアップ`);
          }
        }
      } catch (e) {
        console.warn(`[warn] build ディレクトリ内クリーンアップエラー: ${e.message}`);
      }
    }

    const pkgCommand = isPreRelease
      ? `node scripts/package.js --pre-release --target ${platform}`
      : `node scripts/package.js --target ${platform}`;

    try {
      // プラットフォーム固有の依存関係をインストール
      console.log(`[info] プラットフォーム ${platform} 用の依存関係インストール中...`);
      await installPlatformDependencies(platform);
      
      // prepackageとpackageコマンドを実行
      console.log(`[info] プラットフォーム ${platform} 用のprepackage実行中...`);
      execSync(`node scripts/prepackage.js --target ${platform} --cross-platform`, {
        stdio: "inherit",
      });
      
      // prepackage後のサイズを確認
      console.log(`[info] prepackage後のサイズ確認:`);
      checkBinarySize(platform);
      
      console.log(`[info] プラットフォーム ${platform} 用のpackage実行中...`);
      execSync(pkgCommand, { stdio: "inherit" });
      
      // package後のサイズを確認
      console.log(`[info] package後のサイズ確認:`);
      checkBinarySize(platform);
      
      console.log(`[success] ✅ プラットフォーム ${platform} 用のパッケージ作成が完了しました`);
    } catch (error) {
      console.error(`[error] ❌ プラットフォーム ${platform} 用のパッケージ作成中にエラーが発生しました:`);
      console.error(error.message);
      
      // エラーが発生しても他のプラットフォームのビルドを続行
      console.log(`[info] 残りのプラットフォームのビルドを継続します`);
      continue;
    }
  }
  
  console.log(`\n[info] すべてのプラットフォーム向けパッケージ化処理が完了しました`);
  console.log(`[info] パッケージは ./build ディレクトリに作成されています`);
  
  // 最終的な各VSIXファイルのサイズを表示
  const buildDir = path.join(__dirname, "..", "build");
  if (fs.existsSync(buildDir)) {
    console.log(`\n[info] 作成されたVSIXファイル:`);
    const files = fs.readdirSync(buildDir).filter(f => f.endsWith('.vsix'));
    for (const file of files) {
      const filepath = path.join(buildDir, file);
      const stats = fs.statSync(filepath);
      console.log(`[info] ${file}: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    }
  }
})();