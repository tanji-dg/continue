## Gemini-CLI Learnings

This document captures key learnings and best practices discovered while using the Gemini CLI on this project.

### Git

*   **Rebase Strategy for `package-lock.json`:** When a rebase results in conflicts within `package-lock.json`, it is often more efficient to run `npm install` to resolve the conflicts. This regenerates the lockfile based on the final state of `package.json`.
*   **Automating Rebase:** To prevent interactive prompts during a rebase, especially when scripting, use `GIT_EDITOR=true git rebase --continue`.

### TypeScript

*   **Missing Properties:** When a TypeScript build fails due to a missing property, you can often fix it by adding the missing property with a default value. For example, if a function call is missing a required `contextItems` property, you can add `contextItems: []` to the object passed to the function.

### VSCode Extension Release Builds

To create a release package for the VSCode extension, follow these steps:

1.  **Create a production build:**
    ```bash
    npm run build:prod --workspace=extensions/vscode
    ```

2.  **Package for a specific platform:**
    ```bash
    cd extensions/vscode
    node scripts/package-all.js --platform=<platform>
    ```
    Replace `<platform>` with the desired target, such as `win32-x64` or `linux-x64`.