const { exec, execSync } = require("child_process"); // execSyncを追加
const fs = require("fs");

const version = JSON.parse(
  fs.readFileSync("./package.json", { encoding: "utf-8" }),
).version;

// Gitコミットハッシュを取得（短縮版）
let gitHash;
try {
  gitHash = execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
} catch (e) {
  gitHash = "nogit"; // Gitが利用できない場合のフォールバック
}
const args = process.argv.slice(2);
let target;

if (args[0] === "--target") {
  target = args[1];
}

if (!fs.existsSync("build")) {
  fs.mkdirSync("build");
}

const isPreRelease = args.includes("--pre-release");

// 出力ファイル名を構築
const baseName = `continue-${version}-${gitHash}`;
const targetSuffix = target ? `-${target}` : '';
const fileName = `${baseName}${targetSuffix}.vsix`;

let command = isPreRelease
  ? `npx vsce package --out ./build/${fileName} --pre-release --no-dependencies`
  : `npx vsce package --out ./build/${fileName} --no-dependencies`;

if (target) {
  command += ` --target ${target}`;
}

exec(command, (error) => {
  if (error) {
    throw error;
  }
  console.log(
    `vsce package completed - extension created at extensions/vscode/build/${fileName}`,
  );
});
