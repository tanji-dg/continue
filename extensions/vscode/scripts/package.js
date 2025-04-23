const { exec } = require("child_process");
const fs = require("fs");

const version = JSON.parse(
  fs.readFileSync("./package.json", { encoding: "utf-8" }),
).version;

// ビルド日時を生成 (UTC時間)
const now = new Date();
const datetime = now.toISOString()
  .replace(/T/, '-')
  .replace(/\..+/, '')
  .replace(/:/g, '');

const args = process.argv.slice(2);
let target;

if (args[0] === "--target") {
  target = args[1];
}

if (!fs.existsSync("build")) {
  fs.mkdirSync("build");
}

const isPreRelease = args.includes("--pre-release");

let command = isPreRelease
  ? `npx @vscode/vsce package --out ./build/continue-${version}-${datetime}.vsix --pre-release --no-dependencies`
  : `npx @vscode/vsce package --out ./build/continue-${version}-${datetime}.vsix --no-dependencies`;

if (target) {
  command += ` --target ${target}`;
}

exec(command, (error) => {
  if (error) {
    throw error;
  }
  console.log(
    `vsce package completed - extension created at extensions/vscode/build/continue-${version}-${datetime}.vsix`,
  );
});
