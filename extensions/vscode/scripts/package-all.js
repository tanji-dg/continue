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

// 'package-all'コマンドはデフォルトですべてのプラットフォームを対象とする
// 特定プラットフォームのみのビルドは明示的に--platform=オプションで指定する
if (specificPlatform) {
  // 特定のプラットフォームが指定された場合
  targetPlatforms = [specificPlatform];
  console.log(`[info] 指定されたプラットフォーム: ${specificPlatform} のみをビルドします`);
} else {
  // デフォルトですべてのプラットフォームをビルド
  targetPlatforms = [...ALL_PLATFORMS];
  console.log(`[info] すべてのプラットフォームをビルドします: ${targetPlatforms.join(', ')}`);
  
  // フラグでビルド対象を制限できる
  if (args.includes("--current-platform-only")) {
    targetPlatforms = [currentPlatform];
    console.log(`[info] --current-platform-onlyオプション: 現在の環境 ${currentPlatform} のみをビルドします`);
  }
}

(async () => {
  for (const platform of targetPlatforms) {
    // 前回のビルド成果物をクリーンアップして、バイナリの蓄積を防ぐ
    console.log(`\n[info] プラットフォーム ${platform} 用のビルドを開始します`);
    console.log(`[info] ビルド成果物をクリーンアップしています...`);
    rimrafSync(path.join(__dirname, "..", "bin"), { force: true });
    rimrafSync(path.join(__dirname, "..", "out"), { force: true });
    
    const pkgCommand = isPreRelease
      ? `node scripts/package.js --pre-release --target ${platform}`
      : `node scripts/package.js --target ${platform}`;

    try {
      // prepackageとpackageコマンドを実行
      console.log(`[info] プラットフォーム ${platform} 用のprepackage実行中...`);
      execSync(`node scripts/prepackage.js --target ${platform} --cross-platform`, {
        stdio: "inherit",
      });
      
      console.log(`[info] プラットフォーム ${platform} 用のpackage実行中...`);
      execSync(pkgCommand, { stdio: "inherit" });
      
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
})();
