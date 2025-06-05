import react from "@vitejs/plugin-react-swc";
import { resolve } from "path";
import tailwindcss from "tailwindcss";
import { defineConfig } from "vitest/config";

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  const isProduction = mode === 'production';

  return {
    plugins: [react(), tailwindcss()],
    build: {
      // Change the output .js filename to not include a hash
      rollupOptions: {
        input: {
          index: resolve(__dirname, "index.html"),
          indexConsole: resolve(__dirname, "indexConsole.html"),
        },
        output: {
          entryFileNames: `assets/[name].js`,
          chunkFileNames: `assets/[name].js`,
          assetFileNames: `assets/[name].[ext]`,
        },
      },
      // プロダクションビルドの最適化（Terserの代わりにesbuildを使用）
      ...(isProduction && {
        minify: 'esbuild', // terserの代わりにesbuildを使用
        target: 'es2020',
        sourcemap: false,
        // バンドルサイズ分析のためのオプション
        reportCompressedSize: true,
        chunkSizeWarningLimit: 1000,
      }),
    },
    // 基本的な最適化
    esbuild: isProduction ? {
      drop: ['console', 'debugger'],
    } : undefined,
    // Node.jsモジュールのポリフィル設定
    define: {
      // プロダクションビルドでは厳密な型チェック
      ...(isProduction && {
        'process.env.NODE_ENV': '"production"',
      }),
      // ブラウザ環境での Node.js モジュールの代替
      global: 'globalThis',
    },
    server: {
      cors: {
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
        allowedHeaders: ["*", "Content-Type", "Authorization"],
        credentials: true,
      },
    },
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: "./src/util/test/setupTests.ts",
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/util/test/setupTests.ts",
    onConsoleLog(log, type) {
      if (type === "stderr") {
        if (
          [
            "contentEditable",
            "An update to Chat inside a test was not wrapped in act",
          ].some((text) => log.includes(text))
        ) {
          return false;
        }
      }
      return true;
    },
  },
});
