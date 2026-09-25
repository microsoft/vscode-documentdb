# src layout

The package has four public entry points, one folder each. Every folder below
has its own README with the details.

| Folder    | Import path                             | Runs on                     |
| --------- | --------------------------------------- | --------------------------- |
| `shared`  | `@microsoft/vscode-ext-webview`         | host and webview (agnostic) |
| `host`    | `@microsoft/vscode-ext-webview/host`    | extension host (Node)       |
| `webview` | `@microsoft/vscode-ext-webview/webview` | webview (browser)           |
| `react`   | `@microsoft/vscode-ext-webview/react`   | webview (browser, React)    |

The `*.ts` files at this level (`index.ts`, `host.ts`, `webview.ts`,
`react.ts`) are entry barrels that re-export each folder; they map to the
subpaths declared in `package.json` `exports`. `testing/` holds shared test
helpers and ships no runtime code.

Import direction: `react` builds on `webview`; `host` and `webview` both build
on `shared`; `shared` depends on nothing else in this package.
