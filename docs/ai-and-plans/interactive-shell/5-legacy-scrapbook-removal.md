# Step 5 — Legacy Scrapbook Removal

**PR:** [#533](https://github.com/microsoft/vscode-documentdb/pull/533)

## Summary

Removed all legacy scrapbook code — ANTLR grammar, Language Server Process (LSP), shell child process, TextMate grammars, commands, menus, and tests — to provide a clean slate for the new Query Playground (Step 6).

## Motivation

The legacy scrapbook was a multi-component system built on fundamentally different architecture:

- **ANTLR4 grammar** for parsing
- **Separate Language Server** (Node.js process, IPC) for completions and diagnostics
- **`mongosh` child process** spawned per execution via `ShellScriptRunner`
- **TextMate grammars** for syntax highlighting

This predated the architecture decisions in Steps 3–4.5. The new approach (Steps 6+) uses `@mongosh` packages for in-process evaluation, `documentdb-constants` for operator metadata, and the `documentdb-query` completion provider framework. None of the legacy components were reusable.

## What Was Preserved

Before deletion, two reusable utilities were relocated:

- `connectToClient.ts` → moved to `src/documentdb/` (exported from `extension.bundle.ts`, used by test infrastructure)
- `mongoConnectionStrings.ts` → moved to `src/documentdb/` (generally useful connection string utilities)

## What Was Removed

### Source Files

- Entire `src/documentdb/scrapbook/` directory (17 files)
- `src/commands/scrapbook-commands/` directory (4 files)
- `src/documentdb/grammar/` directory (7 ANTLR-generated files)
- Root `grammar/` directory (TextMate grammars, ANTLR source, configuration)

### Extension Infrastructure

- Language registration for `vscode-documentdb-scrapbook-language`
- Grammar registration (`source.mongo.js`)
- 4 scrapbook commands and their menu contributions
- 2 submenu definitions
- 2 keybindings
- Webpack language server entry point

### Dependencies Evaluated

- `antlr4ts`, `vscode-languageserver`, `vscode-languageserver-textdocument`, `vscode-json-languageservice` checked for removal (removed if no remaining references)

## UX Preservation

Before any code was deleted, a comprehensive UX preservation document was created ([06-scrapbook-rebuild.md](6-query-playground.md)) documenting every feature, user flow, CodeLens pattern, connection management approach, and package.json contribution of the legacy scrapbook. This served as the sole reference for what the new Query Playground needed to replicate.
