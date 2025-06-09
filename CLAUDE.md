# CLAUDE.md

このファイルはこのリポジトリのコードを操作する際に Claude Code (claude.ai/code) へのガイダンスを提供します。

## 主要コマンド

### セットアップとインストール

- 全ての依存関係をインストール: `npm run install-all-dependencies` (VS Codeタスク) または コマンドパレット経由: `Tasks: Run Task` > `install-all-dependencies`
- Node.js 20.19.0以上が必要 (NVMをインストールしている場合は `nvm use` を使用)

### ビルド

- 完全ビルド: `npm run build:prod` (core, gui, vscode, binaryコンポーネントをビルド)
- コンポーネント別ビルド:
  - Core: `cd core && npm run build:npm`
  - GUI: `cd gui && npm run build`
  - VS Code拡張機能: `cd extensions/vscode && npm run build:prod`
  - Binary: `cd binary && npm run build:prod`

### テスト

- Coreテスト: `cd core && npm test`
- VS Codeテスト: `cd extensions/vscode && npm test`
- VS Code エンドツーエンドテスト: `cd extensions/vscode && npm run e2e:all`
- パターンマッチングで特定のテストファイルを実行: `cd core && npm test -- -t "pattern"` 

### リントとフォーマット

- コードフォーマット: `npm run format` (Prettierを使用)
- フォーマットチェック: `npm run format:check`
- Core用リント: `cd core && npm run lint`
- Core用リント問題修正: `cd core && npm run lint:fix`

### 開発

- ドキュメント開発サーバーの起動: `cd docs && npm run start`
- デバッグモードでVS Code拡張機能を実行: VS Codeの「実行とデバッグ」ビューを開き、「Launch extension」を選択して再生ボタンをクリック
- GUI用ホットリロード: GUIコンポーネントはViteを使用しており、再ビルドせずにホットリロードをサポートしています

## アーキテクチャ概要

Continueは、VS CodeとJetBrains拡張機能を持つオープンソースのAIコードアシスタントです。コードベースは以下の主要コンポーネントに分かれています:

### Core (./core)

共有機能を持つ中央コンポーネント:
- LLM統合と抽象インターフェース (`core/llm/*`)
- 設定管理 (`core/config/*`)
- コード取得用コンテキストプロバイダ (`core/context/providers/*`)
- ツールとコマンド (`core/tools/*`)
- コードベース検索用インデックスエンジン (`core/indexing/*`)
- チャットと補完のストリーミング (`core/llm/stream.ts`)
- コード修正用の編集機能 (`core/edit/*`)

### 拡張機能

- VS Code拡張機能 (`./extensions/vscode`): VS Code統合
- JetBrainsプラグイン (`./extensions/intellij`): JetBrains IDEs統合

### GUI (./gui)

拡張機能間で共有されるReactベースのユーザーインターフェース:
- チャットコンポーネント (`gui/src/pages/gui/*`)
- 設定UI (`gui/src/pages/config/*`)
- ツールUIコンポーネント (`gui/src/pages/gui/ToolCallDiv/*`)

### Binary (./binary)

Node.jsバイナリコンポーネント:
- IPC通信 (`binary/src/IpcMessenger.ts`)
- TCP通信 (`binary/src/TcpMessenger.ts`)

## 設計パターンと規約

1. **モジュラーアーキテクチャ**: コードベースは、コア機能とIDE統合の間に明確な分離を持つモジュラー設計を使用しています。

2. **プロトコルベースの通信**: コンポーネント間の通信は、IDE非依存設計を促進するためのプロトコルハンドラとメッセンジャーを使用しています。

3. **型付きインターフェース**: コンポーネント間のデータ交換には、TypeScriptインターフェースが多用されています。

4. **LLMプロバイダーパターン**: 新しいLLMプロバイダーは、`core/llm/llms/`の`BaseLLM`クラスを拡張し、`core/llm/llms/index.ts`に登録されます。

5. **コンテキストプロバイダー**: RAG機能は、共通インターフェースに従う`core/context/providers/`のコンテキストプロバイダーによって提供されています。

6. **ツールシステム**: このシステムは、`core/tools/`で定義されるIDE操作のためのツールベースのアプローチを使用しています。

7. **プロンプトテンプレート**: 異なるLLMプロバイダー用のテンプレートは`core/llm/templates/`にあります。

## Gitワークフロー

- 主要ブランチ: `main`
- プレリリースは `v1.1.x-vscode` のようなタグを使用して作成されます
- 完全リリースは `v1.0x-vscode` のようなタグを使用します

## 重要なファイルの場所

- メイン設定タイプ: `packages/config-types/src/index.ts`
- コアプロトコル定義: `core/protocol/`
- LLMプロバイダー実装: `core/llm/llms/`
- コンテキストプロバイダー: `core/context/providers/`
- ツール定義: `core/tools/definitions/`
- ツール実装: `core/tools/implementations/`

## 新機能の追加

1. **新しいLLMプロバイダーの追加**:
   - `core/llm/llms/`に`BaseLLM`を拡張する新しいファイルを作成
   - `core/llm/llms/index.ts`の`LLMs`配列にプロバイダーを追加
   - 画像サポートが利用可能な場合は、`core/llm/autodetect.ts`の`PROVIDER_SUPPORTS_IMAGES`に追加
   - `docs/docs/customize/model-providers/more/`にドキュメントを追加

2. **新しいモデルの追加**:
   - `gui/src/pages/AddNewModel/configs/models.ts`に`ModelPackage`エントリを追加
   - `gui/src/pages/AddNewModel/configs/providers.ts`のプロバイダー配列にモデルを追加
   - それぞれのファイルでプロバイダー固有のモデルマッピングを更新
   - `core/llm/autodetect.ts`の`autodetectTemplateType`を更新

3. **新しいコンテキストプロバイダーの追加**:
   - `core/context/providers/`にコンテキストプロバイダーインターフェースに従う新しいファイルを作成
   - コンテキストプロバイダーレジストリに追加

## ドキュメント

- 公式ドキュメントサイト: [https://docs.continue.dev](https://docs.continue.dev)
- ローカルでのドキュメントサーバー起動: `cd docs && npm start`