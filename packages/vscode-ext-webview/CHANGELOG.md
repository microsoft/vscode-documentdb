# Changelog

## 0.11.0

Changes since 0.10.1.

### Breaking changes

- The package now ships ESM only and requires Node.js `>=22.18.0`. Unbundled CommonJS extensions must load `@microsoft/vscode-ext-webview/host` with `await import()`, not `require()`. See [MIGRATION.md](./MIGRATION.md#010x--0110) for runtime and TypeScript loading guidance.

### Improvements

- Added optional `panelViewType` to `WebviewControllerOptions`, allowing the VS Code panel identifier to differ from the webview's render key. Omitting it preserves `react-webview-${viewType}`.
- Added the `./package.json` export for package metadata access.
- Published sourcemaps now embed their sources (`inlineSources`), avoiding missing-source warnings in tools that load them.

The tRPC wire protocol is unchanged. `ProcedureLogEntry.concurrent` remains available; removal of the DocumentDB extension's `rpcConcurrency` telemetry gauge is not a package API change.
