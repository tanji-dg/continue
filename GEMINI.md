# Gemini Workspace Context

This document provides context about the project for the Gemini AI model.

## Project Overview

Continue is an open-source AI code assistant that enables developers to create, share, and use custom AI assistants within their IDE. It is available as a VS Code and JetBrains extension and is supported by a hub of models, rules, prompts, and other building blocks.

### Key Features

- **Agent**: Make substantial changes to the codebase.
- **Chat**: Get help from an LLM without leaving the IDE.
- **Autocomplete**: Inline code suggestions as you type.
- **Edit**: Conveniently modify code in the current file.

### Architecture

This is a monorepo for a TypeScript project that consists of four main sub-projects:

- **`core`**: Contains the core logic of the application, shared across different environments.
- **`gui`**: The user interface of the application, built with React and Vite.
- **`extensions/vscode`**: The VS Code extension.
- **`binary`**: A binary component of the application.

## Development Setup

### Prerequisites

- **Node.js**: Version 20.19.0 (LTS) or higher. Use `nvm use` in the root directory to switch to the correct version if you have NVM.
- **Vite**: Install Vite globally: `npm i -g vite`.

### Installation

Run the `install-all-dependencies` task from the VS Code command palette (`Ctrl+Shift+P`) or run `npm install` in the root directory and in each sub-directory (`core`, `gui`, `extensions/vscode`, `binary`).

### Debugging (VS Code)

1.  Open the "Run and Debug" view.
2.  Select `Launch extension` from the dropdown menu.
3.  Press the play button to start the extension in a new "Host" VS Code window.
4.  Changes to `gui`, `core`, or `extensions/vscode` will be automatically hot-reloaded in the Host window. For `core` and `extensions/vscode` changes, you may need to reload the window (`Ctrl+Shift+P` -> "Reload Window").

## Common Tasks

### Building the Project

- **Production Build (Optimized)**: To create a smaller, optimized build for release, run the following command from the root directory. This removes debug information and minimizes files.
  ```bash
  npm run build:prod
  ```
- **Development Build**: For development, you can build individual components. For example, to build the VS Code extension with sourcemaps for debugging:
  ```bash
  cd extensions/vscode
  npm run esbuild
  ```

### Running Tests

Tests are written using both Jest and Vitest.

- To run all tests for a sub-project, `cd` into its directory and run `npm test`.
- Some sub-projects also have a `vitest` script to run only Vitest tests.

For example, to run tests for the `core` sub-project:
```bash
cd core
npm test
```

### Formatting and Linting

- **Formatting**: This project uses Prettier. To format the entire codebase:
  ```bash
  npm run format
  ```
- **Linting**: This project uses ESLint. To lint a specific sub-project:
  ```bash
  cd core
  npm run lint
  ```

### Packaging the Extension

To package the VS Code extension into a `.vsix` file for installation:

1.  Navigate to the `extensions/vscode` directory.
2.  Run a production build: `npm run build:prod`
3.  Run the packaging script: `npm run package`
    The output will be in `extensions/vscode/build/continue-{VERSION}.vsix`.

### Running the Documentation Server

To run the documentation website locally:

1.  Navigate to the `docs` directory.
2.  Install dependencies: `npm install`
3.  Start the server: `npm run start`
    The documentation will be available at `http://localhost:3000`.

## Contribution Guidelines

- **Git Workflow**: Create feature branches from `main` and open pull requests against `main`.
- **Pull Requests**: Before writing code, open or comment on an issue. Keep PRs focused on a single change.
- **CLA**: All contributors must sign the Contributor License Agreement by commenting on their pull request.