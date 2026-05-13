# PR #631: Visible Underline for Shell Terminal Links

## Why

The Interactive Shell emits clickable action sentinels after query results (Collection View, Query Playground) and on certain error hints (Settings links). These sentinels are registered with VS Code's `TerminalLinkProvider` API, which provides hover/Ctrl+click interactivity. However, VS Code's API does not offer a way to make extension-provided terminal links visually distinct at rest. There is no flag, no style property, and no decoration API for terminal links. The only visual feedback is a highlight that appears on hover.

This means users see plain gray text and have no indication that it is clickable. The links are effectively invisible until discovered by accident.

## What was done

Added ANSI underline escape codes (`\x1b[4m` to start, `\x1b[24m` to stop) around each link sentinel at the point where it is written to the terminal. This gives users a persistent visual cue that the text is interactive, without requiring any hover.

### Files changed

- **`ShellOutputFormatter.ts`**: Extended the ANSI constants table with `underline` and `noUnderline` entries. Added a `formatLinkSentinel(text)` helper that wraps text in underline codes.
- **`DocumentDBShellPty.ts`**: Updated three emission sites to use `formatLinkSentinel()`:
  - `maybeWriteActionLine` (Collection View and Query Playground links after query results)
  - `initializeSession` (settings link on connection failure)
  - `handleEvalError` (settings link on eval errors)
- **`ShellTerminalLinkProvider.test.ts`**: Added four test cases verifying that link detection regex patterns match sentinels wrapped in underline codes, both standalone and combined with gray color wrapping.

## Key decisions and rationale

### Use `\x1b[24m` (underline-off), not `\x1b[0m` (full reset)

The action sentinels are wrapped inside `formatSystemMessage`, which applies gray color (`\x1b[90m ... \x1b[0m`). If we used a full reset (`\x1b[0m`) to end the underline, it would also kill the gray styling for any text following the link on the same line. Using the specific underline-off escape (`\x1b[24m`) only disables underline while preserving the surrounding color context.

### Underline is not gated by the `colorSupport` setting

The `documentDB.shell.display.colorSupport` setting controls decorative styling (syntax colors, JSON colorization). Underline on links serves a different purpose: it communicates that the text is interactive. Users who disable colors to reduce visual noise still benefit from knowing what is clickable. Treating clickability as a separate concern from decoration keeps the UX accessible.

### The entire sentinel is underlined, not just the `[db.collection]` portion

The `ShellTerminalLinkProvider` reports each link's clickable region via `startIndex` and `length`, which span the entire sentinel text (e.g., the full `↗ Collection View [mydb.users]`). Underlining only a substring would create a mismatch between what looks clickable and what actually responds to click. Aligning the visual and interactive boundaries avoids confusion.

### No markup-tag abstraction layer

A structured markup system (where styled strings are built with tags like `[underline]...[/]` and converted to ANSI in a separate pass) is a powerful pattern for tools with many styled token types. This extension has a small ANSI constants table and only three link types. Adding a markup parser would introduce complexity (parsing, tag nesting, escaping) without proportional benefit. The direct approach (call a helper at each emission site) is simpler, easier to audit, and sufficient for the current scope.

### No changes to `ShellTerminalLinkProvider` regex patterns

The existing regex patterns already tolerate arbitrary ANSI escape sequences at link boundaries via `(?:\x1b\[\d+m)*`. The underline codes (`\x1b[4m`, `\x1b[24m`) match this pattern, so link detection continues to work with zero regex changes. This was verified with four new test cases covering standalone underline wrapping, combined gray+underline wrapping, and multi-link lines with individual underline wrapping.

## Scope

Only the three existing extension-provided link sentinels are affected. Auto-detected URLs in arbitrary command output are handled separately by VS Code's built-in URL detector and are out of scope.
