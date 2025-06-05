const fs = require("fs");
const { writeBuildTimestamp } = require("./utils");

const esbuild = require("esbuild");

const flags = process.argv.slice(2);
const isProduction = flags.includes("--minify");

const esbuildConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "out/extension.js",
  external: ["vscode", "esbuild", "./xhr-sync-worker.js"],
  format: "cjs",
  platform: "node",
  // プロダクションビルドではsourcemapを無効化
  sourcemap: !isProduction && flags.includes("--sourcemap"),
  // プロダクションビルドではデッドコード除去を有効化
  treeShaking: true,
  // プロダクションビルドでは最適化を有効化
  minify: isProduction,
  // プロダクションビルドではコメントを削除
  keepNames: !isProduction,
  loader: {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    ".node": "file",
  },

  // To allow import.meta.path for transformers.js
  // https://github.com/evanw/esbuild/issues/1492#issuecomment-893144483
  inject: ["./scripts/importMetaUrl.js"],
  define: {
    "import.meta.url": "importMetaUrl",
    // プロダクションビルドでは開発用コードを除去
    ...(isProduction && {
      "process.env.NODE_ENV": '"production"'
    })
  },
  supported: { "dynamic-import": false },
  metafile: true,
  // プロダクションビルドでは警告を抑制
  logLevel: isProduction ? "error" : "info",
  plugins: [
    {
      name: "on-end-plugin",
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length > 0) {
            console.error("Build failed with errors:", result.errors);
            throw new Error(result.errors);
          } else {
            try {
              fs.writeFileSync(
                "./build/meta.json",
                JSON.stringify(result.metafile, null, 2),
              );
            } catch (e) {
              console.error("Failed to write esbuild meta file", e);
            }
            const buildType = isProduction ? "production" : "development";
            console.log(`VS Code Extension esbuild complete (${buildType})`); // used verbatim in vscode tasks to detect completion
          }
        });
      },
    },
  ],
};

(async () => {
  // Create .buildTimestamp.js before starting the first build
  writeBuildTimestamp();
  // Bundles the extension into one file
  if (flags.includes("--watch")) {
    const ctx = await esbuild.context(esbuildConfig);
    await ctx.watch();
  } else if (flags.includes("--notify")) {
    const inFile = esbuildConfig.entryPoints[0];
    const outFile = esbuildConfig.outfile;

    // The watcher automatically notices changes to source files
    // so the only thing it needs to be notified about is if the
    // output file gets removed.
    if (fs.existsSync(outFile)) {
      console.log("VS Code Extension esbuild up to date");
      return;
    }

    fs.watchFile(outFile, (current, previous) => {
      if (current.size > 0) {
        console.log("VS Code Extension esbuild rebuild complete");
        fs.unwatchFile(outFile);
        process.exit(0);
      }
    });

    console.log("Triggering VS Code Extension esbuild rebuild...");
    writeBuildTimestamp();
  } else {
    await esbuild.build(esbuildConfig);
  }
})();
