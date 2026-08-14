# PR #732 Review: Current-state correctness and input/output handling

Review date: 2026-07-27

Reassessed: 2026-07-28 (vector-limit source and generated-command comment handling)

Independent re-review: 2026-07-28 (second reviewer). Every finding below was re-verified against the current branch; all six original findings are confirmed and none were fabricated. Severities were revisited and left unchanged, except that one new **Medium** finding (MEDIUM-2) was added. Per-finding **Reviewer verification & recommended solution** blocks with code-level directions, trade-offs, and a recommended pick were added inline.

PR: https://github.com/microsoft/vscode-documentdb/pull/732

Baseline: `origin/main` (`c745a327`) ... `dev/khelanmodi/index-management-ui` (`d0854f25`)

## Severity summary

| Severity | Count | Summary                                                                                                                                                                                        |
| -------- | ----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Critical |     0 | No extension-wide outage, confirmed data-loss path, or security boundary break found.                                                                                                          |
| High     |     0 | No issue met the bar for broad or difficult-to-recover user harm.                                                                                                                              |
| Medium   |     2 | Index deletion bypasses the configured destructive-action confirmation style (MEDIUM-1); sustained background build-poll failures spam an error toast every 5s (MEDIUM-2, added on re-review). |
| Low      |     5 | Repeatable in-flight actions, a shell-command rendering edge case, host-schema defense gaps, one screen-reader issue, and a dev-only listener leak.                                            |

## Review scope

This review used the current PR diff against `origin/main`, not the stale local `main` branch. It reviewed the implementation and intent records in this folder, especially:

- [feature-01-index-management-overview.md](../../design.md)
- [feature-02-collectionview-toolbar-redesign.md](../../design-collectionview-toolbar.md)
- [feature-03-vector-index-support.md](../../design-vector-index-support.md)
- [code-review-2026-07-20.md](./code-review-2026-07-20.md)

The completed UX review was not repeated. The focus was correctness, user input crossing the extension-host boundary, server-result handling, destructive operations, async state, empty catches, generated commands, and supporting scraper/dev-tooling changes.

The July 20 findings were used as a regression checklist. Their resolved defects were not copied into this report unless the current implementation still exhibited the behavior.

## Findings

### MEDIUM-1: Index deletion no longer honors the configured destructive-action confirmation style

Files:

- [confirmIndexAction.ts](../../../../../../src/utils/dialogs/confirmIndexAction.ts#L48-L77)
- [dropIndex.ts](../../../../../../src/commands/index.dropIndex/dropIndex.ts#L29-L42)
- [indexViewRouter.ts](../../../../src/webviews/documentdb/indexView/indexViewRouter.ts#L313-L365)
- [package.json](../../../../../../package.json#L1300-L1319)

Copilot thread: [Delete confirmation bypasses the configured confirmation style](https://github.com/microsoft/vscode-documentdb/pull/732#discussion_r3658535066)

`documentDB.confirmations.confirmationStyle` explicitly controls operations that cannot be undone and defaults to word-entry confirmation. Before this PR, the tree-view drop-index command called `getConfirmationAsInSettings`. The new shared `confirmIndexAction` always uses a single warning button, and both the tree command and webview router now call it for deletion.

Scenario:

1. A user keeps the default word-entry confirmation, or deliberately selects challenge confirmation for irreversible operations.
2. The user deletes an index from either the tree or Indexes tab.
3. A one-click **Delete** modal appears instead of the configured confirmation gate.
4. The irreversible operation now has less protection than the user selected and than other destructive resource commands provide.

The feature overview documents this as a deliberate consistency tradeoff. That explains the implementation, but it does not remove the behavioral regression: a public preference whose description covers deletion is ignored, and the default safety level is reduced. This is **Medium** because it affects a destructive operation on the normal path, although a warning dialog still exists and the impact is limited to an index rather than collection data.

Suggested direction: retain the rich size/usage/effect text, but route `kind: 'delete'` through `getConfirmationAsInSettings`. Hide and unhide are reversible and can continue using the shared click modal if that consistency is preferred.

**Reviewer verification & recommended solution (2026-07-28):** Confirmed. `git show origin/main:src/commands/index.dropIndex/dropIndex.ts` used `getConfirmationAsInSettings(...)`; both the tree command and [indexViewRouter.ts](../../../../src/webviews/documentdb/indexView/indexViewRouter.ts#L342-L365) now call single-button `confirmIndexAction('delete', …)`. The setting default is `wordConfirmation` and its description explicitly covers "operations that cannot be undone, such as deleting resources". Severity **Medium** kept. One nuance: an index carries no data, so "cannot be undone" overstates harm relative to `deleteCollection`/`deleteDatabase`; the finding stands on the "silently overrides a public safety preference" basis rather than data loss.

Route only `kind: 'delete'` through the shared gate while keeping the rich detail text; leave reversible hide/unhide on the click modal:

```ts
// confirmIndexAction.ts
if (kind === 'delete') {
  // Reuse the tested gate used by deleteCollection/deleteDatabase (word / challenge / click).
  return getConfirmationAsInSettings(title, detail, details.indexName, { fallbackWord: l10n.t('delete') });
}
const result = await vscode.window.showWarningMessage(title, { modal: true, detail }, actionLabel);
return result === actionLabel;
```

- Why it works: restores the pre-PR contract and reuses the same helper every other destructive command uses; `fallbackWord` handles index names outside `[a-zA-Z]` or longer than the limit.
- Pros: consistent with sibling delete commands; respects the default word gate; keeps hide/unhide friction-free. Cons: word/challenge modes present the size/usage detail more plainly (input-box `prompt` vs modal `detail`); delete loses exact visual parity with hide/unhide.
- Alternatives: (a) add a separate opt-in setting for strict index-delete — extra config, doesn't fix the default regression; (b) always word-confirm delete regardless of setting — ignores users who chose click confirmation.
- **Best choice:** route `delete` through `getConfirmationAsInSettings`. It removes the regression, restores cross-command consistency, and the plainer presentation is an acceptable, well-precedented trade-off.

> **RESOLVED (2026-07-28)** — commit [`2eff210`](https://github.com/microsoft/vscode-documentdb/commit/2eff210468000b03089832d8584647507beac36b). `confirmIndexAction` now routes `kind: 'delete'` through `getConfirmationAsInSettings(title, detail, indexName, { fallbackWord: 'delete' })`, restoring the configured word/challenge/click gate used by `deleteCollection`/`deleteDatabase`. The rich size/usage/effect detail text is preserved and reversible hide/unhide keep the lighter single-click modal. `UserCancelledError` from the word-entry input box is caught and translated to `false` so the shared boolean contract holds for both the tree command and the webview router. Used the plain `'delete'` fallback word (matching the sibling delete commands) instead of a localized one, so no new l10n string was added.

### MEDIUM-2: Sustained background build-poll failures spam an error toast every 5 seconds

Added on independent re-review (2026-07-28). Not present in the original report.

Files:

- [IndexesTab.tsx](../../../../src/webviews/documentdb/indexView/IndexesTab.tsx#L243-L296)
- [IndexesTab.tsx](../../../../src/webviews/documentdb/indexView/IndexesTab.tsx#L374-L394)

While any row is `building` or `creating`, the poll re-arms every `BUILD_POLL_INTERVAL_MS` (5s). `refresh()`'s catch block calls `showError(...)` unconditionally (only gated by the generation guard) and does not distinguish `source === 'background'` from `manual`:

```ts
} catch (error) {
    if (generation === refreshGenerationRef.current) {
        setLoadFailed(true);
        showError(l10n.t('Failed to load indexes.'), error); // fires on EVERY background poll
        ...
```

Scenario: an index is building and the cluster becomes briefly unreachable (sleep / VPN drop / tier hiccup). The rows stay `building`, so `active` stays true and the poll re-arms indefinitely, stacking a "Failed to load indexes." notification every 5 seconds until the connection returns or the user hits refresh. VS Code does not de-dupe these. The original report lists "build polling re-arms after failed attempts" as a positive non-finding; it missed that the same re-arm turns a transient outage into notification spam.

This is **Medium**: no data harm, but a real, user-visible nuisance loop on the normal path.

Suggested direction: suppress the toast for background polls; keep the inline `loadFailed` banner. `shouldAnnounce` is already computed (`initial || source === 'manual'`) and is exactly the right gate:

```ts
} catch (error) {
    if (generation === refreshGenerationRef.current) {
        setLoadFailed(true);
        if (shouldAnnounce) {                 // initial or manual only
            showError(l10n.t('Failed to load indexes.'), error);
            announce(l10n.t('Could not load indexes.'), 'assertive');
        }
    }
}
```

- Why it works: background failures update the inline `loadFailed` state (banner) without stacking toasts; manual/initial loads still surface the error.
- Pros: minimal change, reuses an existing signal, preserves the visible banner. Cons: a purely-background failure becomes silent except for the banner — acceptable since the user did not initiate it.
- Alternative: latch the toast to fire only on the first background failure (false→true transition of `loadFailed`) — more code, marginal benefit.
- **Best choice:** gate the toast on `shouldAnnounce`. Smallest correct fix and consistent with the existing announce policy.

> **RESOLVED (2026-07-28)** — commit [`0204b97`](https://github.com/microsoft/vscode-documentdb/commit/0204b97d4dd6344835a49b449bee4a58103a883f). The `refresh()` catch block now gates both `showError(...)` and the assertive announcement on the existing `shouldAnnounce` signal (`initial || source === 'manual'`). Background poll failures update only the inline `loadFailed` banner, so a sustained outage while a row is building no longer stacks a toast every 5s; manual and initial loads still surface the error.

### LOW-1: Busy rows leave destructive and visibility actions enabled

Files:

- [IndexTable.tsx](../../../../src/webviews/documentdb/indexView/components/indexList/IndexTable.tsx#L258-L370)
- [IndexesTab.tsx](../../../../src/webviews/documentdb/indexView/IndexesTab.tsx#L471-L552)

`IndexTable` computes `isBusy` from `busyNames`, but uses it only to replace the status icon with a spinner. Delete and Hide/Unhide remain disabled only for the protected `_id_` row or an optimistic Creating row. They remain clickable while the first mutation is running and during the two-second minimum spinner window.

Scenario:

1. A user confirms deletion or a visibility change.
2. The row changes to a spinner while the request runs.
3. The same action buttons remain enabled; clicking again opens another confirmation and can dispatch a second mutation against the same index.
4. The duplicate request can race the first or fail after the first succeeds, producing an avoidable error dialog and extra refreshes.

This is **Low** because every request still has a confirmation, and the server should reject a duplicate operation rather than corrupt state. It is nevertheless a real concurrency bug in the row state machine.

Suggested direction: include `isBusy` in both buttons' `disabledFocusable` conditions. That keeps the disabled reason focusable while making the spinner state operationally inert.

**Reviewer verification & recommended solution (2026-07-28):** Confirmed. [IndexTable.tsx](../../../../src/webviews/documentdb/indexView/components/indexList/IndexTable.tsx#L340-L370) uses `disabledFocusable={isProtected || isPending}` on both action buttons — `isBusy` is omitted. `handleDelete`/`handleToggleHidden` call `addBusy(name)` before the mutation, but the host confirmation modal blocks the window, so the practical duplicate-dispatch window is after confirming, during the server op plus the `MIN_ACTION_VISIBLE_MS` tail. Severity **Low** kept.

```tsx
// IndexTable.tsx — both action buttons
disabledFocusable={isProtected || isPending || isBusy}
```

- Why it works: `isBusy` already derives from `busyNames`; adding it to `disabledFocusable` (not `disabled`) keeps the button focusable so the tooltip/disabled reason stays reachable while a second dispatch is impossible during the in-flight op and tail.
- Pros: one line, existing state, keyboard/AT friendly. Cons: brief "disabled" appearance during the success tail; negligible.
- Alternative: guard inside the handlers (`if (busyNames.has(name)) return;`) — belt-and-suspenders but gives no visible signal.
- **Best choice:** add `isBusy` to `disabledFocusable` on both buttons (optionally plus the handler guard as defense in depth). The UI-level fix gives the clearest feedback with the least code.

> **RESOLVED (2026-07-28)** — commit [`414b44e`](https://github.com/microsoft/vscode-documentdb/commit/414b44ee7a78b202a0a1955d27afc4472500636d). Both the Delete and Hide/Unhide action buttons now include the existing `isBusy` (derived from `busyNames`) in their `disabledFocusable` condition (`isProtected || isPending || isBusy`). Using `disabledFocusable` keeps the button focusable so its tooltip/disabled reason stays reachable, while a second mutation cannot be dispatched during the in-flight op and the minimum-spinner tail.

### LOW-2: Accepted comments in raw advanced options can break generated Shell/Playground commands

Disposition: **To be done (must fix).** Executable-code wrappers must serialize or isolate every embedded fragment safely, even when the current producer generates that fragment from trusted structured UI state.

Tracking issue: [#817 - Harden generated shell commands against embedded code fragments](https://github.com/microsoft/vscode-documentdb/issues/817)

Files:

- [CreateIndexDrawer.tsx](../../../../src/webviews/documentdb/indexView/components/CreateIndexDrawer.tsx#L665-L705)
- [indexCreation.ts](../../../../src/webviews/documentdb/indexView/indexCreation.ts#L263-L281), [indexCreation.ts](../../../../src/webviews/documentdb/indexView/indexCreation.ts#L381-L415)

Most of the create-index command is generated from structured form state, and the structured Wildcard projection cannot contain comments through the normal UI. Partial filter and collation are different: they are raw, user-authored text from the two advanced editors. The drawer forwards that text unchanged, and the host intentionally parses it using `@mongodb-js/shell-bson-parser` in `ParseMode.Loose`. That parser explicitly supports both line and block comments.

For example, this is accepted advanced-editor input:

```text
{ active: true } // only active documents
```

Direct creation parses it into `{ active: true }` and succeeds. `buildCreateIndexShellCommand`, however, embeds the raw text to preserve BSON constructors and appends the generated command's closing delimiters on the same physical line. The user comment therefore swallows those delimiters:

```text
db.getCollection("users").createIndex({"status":1}, {"partialFilterExpression":{ active: true } // only active documents})
```

The resulting handoff has unclosed delimiters and fails to parse. This is reproducible through the normal UI for partial filter and collation. A commented Wildcard projection would require a crafted RPC payload because that value is generated from structured fields.

This is **Low** because it affects the optional Shell/Playground handoff for a narrow but valid relaxed-input form; direct creation still works.

The generated command does not need to retain comments. Suggested direction: render the parsed value with a shell-BSON serializer that preserves BSON values but omits comments, or place generated closing delimiters on a new line outside a trailing line comment. Add parity tests so direct creation and the two handoffs accept the same advanced input.

**Reviewer verification & recommended solution (2026-07-28):** Confirmed, and the scope is exactly `partialFilterExpression` and `collation`: [CreateIndexDrawer.tsx](../../../../src/webviews/documentdb/indexView/components/CreateIndexDrawer.tsx#L665-L705) forwards those two as raw `.trim()` text, while `wildcardProjection` is sent as `JSON.stringify(wildcardProjectionObject)` (structured, comment-free through the UI). [indexCreation.ts](../../../../src/webviews/documentdb/indexView/indexCreation.ts#L398-L410) embeds the raw option text and appends `})` on the same physical line, so a `//` line comment swallows the delimiters. Severity **Low** kept; disposition remains must-fix (issue #817).

Two viable directions:

```ts
// (a) Re-serialize the already-parsed object (preserves BSON constructors, drops comments)
import { toJSString } from 'mongodb-query-parser';
optionEntries.push(`${JSON.stringify('partialFilterExpression')}:${toJSString(partialFilterExpression)}`);

// (b) Multi-line the options object so closing delimiters sit on their own line
return `db.getCollection(${collection}).createIndex(${keyJson}, {\n${optionEntries.join(',\n')}\n})`;
```

- (a) Pros: correct for any comment style and whitespace; keeps `ISODate(...)`/`NumberLong(...)`. Cons: adds/relies on `mongodb-query-parser` and needs a round-trip check against the loose parser's accepted input.
- (b) Pros: zero deps, tiny change. Cons: does not neutralize an unterminated block comment (`/* …`) and preserves the comment text in the handoff.
- **Best choice:** (a) re-serialize, because the stated requirement (#817) is to "serialize or isolate every embedded fragment safely"; (b) is an acceptable stopgap if adding a dependency is undesirable. Pair either with parity tests asserting direct-create and both handoffs accept the same commented advanced input.

> **RESOLVED (2026-07-28)** — commit [`4cc9dce`](https://github.com/microsoft/vscode-documentdb/commit/4cc9dce0469c3e7f923896c148fb4e507a8bcef4). Implemented the **isolate** variant of the requirement (a hardened form of option (b)) rather than adding the `mongodb-query-parser` dependency to the webview bundle. `@mongodb-js/shell-bson-parser` exposes only `parse` (no serializer), so option (a) would have required a new runtime dependency for a Low-severity edge case. Instead, `buildCreateIndexShellCommand` now places every option entry on its own physical line and separates entries with a **leading** comma (`join('\n,')`), so the separator and the closing `})` always start a fresh line and can never share a line with a trailing `//` comment. This preserves BSON constructors (raw text is kept verbatim) and fully isolates each fragment. Crucially, `buildCreateIndexShellCommand` already calls `buildIndexSpec`, which parses each option first, so unterminated block comments (`/* …`) are rejected on **both** the direct-create and handoff paths — the two paths are at exact parity. Added parity tests (`advanced-option comment handling in the shell/playground handoff`) that re-parse the generated options object and assert both paths accept the same commented input and reject the same invalid input. Tracking issue #817.

### LOW-3: The host schema can reinterpret malformed vector requests and accepts whitespace-only fields

File: [indexCreation.ts](../../../../src/webviews/documentdb/indexView/indexCreation.ts#L50-L64), [indexCreation.ts](../../../../src/webviews/documentdb/indexView/indexCreation.ts#L193-L200), [indexCreation.ts](../../../../src/webviews/documentdb/indexView/indexCreation.ts#L237-L242)

There are two related defense-in-depth gaps at the tRPC boundary:

1. `CreateIndexInputSchema` is a plain union. If an object carries `kind: 'vector'` but fails the vector member and also carries valid standard `fields`, the field member succeeds and strips the unknown `kind`. A malformed vector request can therefore become a standard index request instead of being rejected.
2. Both field schemas use `z.string().min(1)`, which accepts whitespace-only field paths. The current drawer trims and blocks these values, but a crafted or stale webview message can pass them to the server command.

The current UI constructs disjoint payloads and trims its fields, so these are not normal-path defects. They are **Low** because exploiting them requires a crafted/stale RPC request and the database server is expected to reject invalid field names.

Suggested direction: make each union member strict (or otherwise forbid `kind` on field-keyed payloads), and validate `field.trim().length > 0` at the host boundary. Tests should cover mixed-shape vector payloads and whitespace-only standard/vector fields.

**Reviewer verification & recommended solution (2026-07-28):** Confirmed. [indexCreation.ts](../../../../src/webviews/documentdb/indexView/indexCreation.ts#L242-L246) defines `CreateIndexInputSchema = z.union([VectorCreateIndexInputSchema, FieldCreateIndexInputSchema])`; the field member is a plain (non-strict) `z.object` that strips an unknown `kind`, and both field schemas use `z.string().min(1)` (accepts whitespace). Reachable only via a crafted/stale RPC (the drawer emits disjoint, trimmed payloads), so defense-in-depth **Low** kept.

```ts
const FieldCreateIndexInputSchema = z
  .object({
    fields: z
      .array(
        z.object({
          field: z.string().refine((s) => s.trim().length > 0, l10n.t('Field path is required.')),
          type: FieldIndexTypeSchema,
        }),
      )
      .min(1),
    // …
  })
  .strict(); // reject a stray `kind` so a malformed vector cannot degrade to a field index
```

- Why it works: `.strict()` makes a `kind:'vector'` payload fail both members instead of silently becoming a field index; the `trim` refine rejects whitespace-only paths at the boundary.
- Pros: closes both gaps with clear errors. Cons: a true `z.discriminatedUnion('kind', …)` would route deterministically but requires the field payload to carry a `kind` discriminator (a small shape change across the drawer).
- **Best choice:** keep `z.union` but make each member `.strict()` and add the `trim` refine — minimal change fixing both issues without reshaping the drawer payloads. Add tests for a mixed-shape vector payload and whitespace-only fields.

> **RESOLVED (2026-07-28)** — commit [`463089f`](https://github.com/microsoft/vscode-documentdb/commit/463089fb24c3fe25b9b60bfa4b74c63adecf011f). Both union members now end in `.strict()`, so a payload carrying `kind: 'vector'` (or any unknown top-level key) fails both members instead of silently stripping the discriminator and degrading into a field index. The field-path `z.string().min(1)` on both the standard and vector schemas is replaced with a `trim`-based refine that rejects whitespace-only paths at the boundary. The drawer's `buildFieldPayload`/`buildVectorPayload` emit only the allowed, trimmed keys, so normal usage is unaffected. Added tests for a mixed-shape vector payload, a stray top-level key, and whitespace-only standard/vector field paths.

### LOW-4: Index type badges risk duplicate screen-reader announcements

File: [IndexTypeBadgeView.tsx](../../../../src/webviews/documentdb/indexView/components/indexList/IndexTypeBadgeView.tsx#L27-L35)

Copilot thread: [Badge accessible text can be announced twice](https://github.com/microsoft/vscode-documentdb/pull/732#discussion_r3658534963)

The badge sets `aria-label={type}` and renders the same type as visible text. This is redundant and, for screen readers that include both sources, can announce a type such as “Single Field” twice. The repository's accessibility guidance uses an `aria-hidden` wrapper when an `aria-label` intentionally replaces visible badge text.

This is **Low**: it affects announcement quality rather than access to an operation, and behavior varies by assistive technology.

Suggested direction: remove the redundant `aria-label` and let the visible text provide the name. If a richer label is added later, wrap the visible text in `aria-hidden="true"` as used by the existing focusable-badge pattern.

**Reviewer verification & recommended solution (2026-07-28):** Confirmed. [IndexTypeBadgeView.tsx](../../../../src/webviews/documentdb/indexView/components/indexList/IndexTypeBadgeView.tsx#L30-L34) sets `aria-label={type}` and renders the same `type` (with NBSP) as visible text. NBSP is announced as a space, so the accessible name is identical and may be read twice. Best classified as a **nit** (AT-dependent, blocks no operation).

```tsx
<Badge appearance="tint" color={BADGE_COLOR} shape="rounded" size={size}>
  {type.replace(/ /g, '\u00A0')}
</Badge>
```

- Why it works: the visible text already supplies the accessible name; removing `aria-label` eliminates the double source.
- Pros/Cons: pure improvement, no downside. If a richer label is ever needed, wrap the visible text in `aria-hidden="true"` per the repo's focusable-badge pattern.
- **Best choice:** drop the `aria-label`.

> **RESOLVED (2026-07-28)** — commit [`760f4fd`](https://github.com/microsoft/vscode-documentdb/commit/760f4fd2b1c6b9e91298d94c460f5b80d8f327f1). Removed the redundant `aria-label={type}` from `IndexTypeBadgeView`; the visible text (with its non-breaking space, which is announced as a space) already supplies the accessible name, so the double announcement source is eliminated.

### LOW-5: The dev-only ResizeObserver detector installs duplicate listeners under hot reload

Files:

- [resizeObserverLoopDetector.ts](../../../../../../src/webviews/_integration/observability/resizeObserverLoopDetector.ts#L40-L80)
- [index.tsx](../../../../../../src/webviews/index.tsx#L20-L27)
- [webpack.config.views.js](../../../../../../webpack.config.views.js#L78-L112)

Copilot thread: [ResizeObserver detector installation is not idempotent](https://github.com/microsoft/vscode-documentdb/pull/732#discussion_r3658535023)

`render()` calls `installResizeObserverLoopDetector()` in development. Each call adds a new capture-phase `window.error` listener and provides no cleanup or persistent installation guard. The dev server enables HMR and React Refresh, so entry-module re-execution can leave old listeners on the same page and install another detector. Each detector has an independent rate counter and can emit the same warning.

This is **Low** because the code is dead-code-eliminated from production and affects only long-running development webviews. It still undermines the detector's purpose: duplicated warnings make its signal less trustworthy.

Suggested direction: make installation idempotent with a `globalThis`/`window` sentinel that survives module replacement, or register an HMR dispose callback that removes the exact listener.

**Reviewer verification & recommended solution (2026-07-28):** Confirmed. [resizeObserverLoopDetector.ts](../../../../../../src/webviews/_integration/observability/resizeObserverLoopDetector.ts#L44-L80) adds a `window` 'error' listener on every call with no guard, and [index.tsx](../../../../../../src/webviews/index.tsx#L23-L25) calls it from `render()` under a `NODE_ENV !== 'production'` guard, so HMR re-execution can stack listeners. Dev-only, dead-code-eliminated from production — **nit**.

```ts
export function installResizeObserverLoopDetector(): void {
  if (typeof window === 'undefined') return;
  const w = window as Window & { __rroLoopDetectorInstalled?: boolean };
  if (w.__rroLoopDetectorInstalled) return;
  w.__rroLoopDetectorInstalled = true;
  // …existing addEventListener…
}
```

- Why it works: a `window`-scoped sentinel survives HMR module replacement, so only one listener is ever attached.
- Pros: trivial, no HMR API coupling. Cons: sentinel persists for the session (fine for a dev-only diagnostic).
- Alternative: register `module.hot.dispose` to remove the exact listener — cleaner teardown but more code and bundler coupling.
- **Best choice:** the `window` sentinel — least code for a dev-only utility while restoring the "warn once per burst" guarantee.

> **RESOLVED (2026-07-28)** — commit [`5318241`](https://github.com/microsoft/vscode-documentdb/commit/5318241924f50bc04d6ea55d04f2f400693132f5). `installResizeObserverLoopDetector()` now guards on a `window`-scoped sentinel (`__documentDBResizeObserverLoopDetectorInstalled`) that survives HMR / React Refresh module replacement, so re-executing the entry module never stacks a second capture-phase listener. Dev-only utility, dead-code-eliminated from production.

## Unresolved Copilot comments

All unresolved Copilot reviewer threads were fetched from GitHub after the independent review. They are merged into the findings above rather than duplicated.

| Copilot comment                                                                                                                                  | Independent assessment                                                                                                                       | Merged finding |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| [Badge accessible text can be announced twice](https://github.com/microsoft/vscode-documentdb/pull/732#discussion_r3658534963)                   | Valid. Assistive-technology impact only; **Low**.                                                                                            | LOW-4          |
| [ResizeObserver detector installation is not idempotent](https://github.com/microsoft/vscode-documentdb/pull/732#discussion_r3658535023)         | Valid. Reproducible only in development/HMR; **Low**.                                                                                        | LOW-5          |
| [Delete confirmation bypasses the configured confirmation style](https://github.com/microsoft/vscode-documentdb/pull/732#discussion_r3658535066) | Valid despite being documented as an intentional tradeoff. It reduces the configured/default gate for an irreversible operation; **Medium**. | MEDIUM-1       |

No other unresolved Copilot reviewer threads were present when this report was prepared.

## Verified non-findings

- The earlier TTL truncation bug is fixed: the drawer accepts only canonical positive whole-number text, and the host independently requires a positive integer.
- Duplicate trimmed standard fields are rejected before object construction, so one configured key no longer silently overwrites another.
- Create/drop and hide/unhide inspect their normalized command documents and surface server failures instead of reporting unconditional success.
- Optional `collStats` and `$indexStats` failures are isolated. The main list still renders, and tree confirmation details fall back to a dash.
- The empty catches in `CreateIndexDrawer` are intentional: the parent displays the error and the drawer retains the form for retry. The empty catches in the tree confirmation-stat helper intentionally degrade optional metrics independently.
- Refresh responses use a generation guard, and build polling re-arms after failed attempts, preventing the stale-response and stopped-polling regressions from the earlier review. (Re-review caveat: the same unconditional re-arm surfaces a repeated error toast on sustained background failure — see MEDIUM-2.)
- Microsoft Learn currently documents vector-index maxima of 2,000 dimensions without compression, 4,000 with half precision, and 16,000 with product quantization. No documented backend command or capability response exposes those maxima: `hello`, `buildInfo`, and `listCommands` provide topology, version, wire limits, and command availability rather than per-feature parameter constraints. Hard-coding the Learn values, or mapping server versions to them, would make the extension track service evolution. The server remains the authority and its rejection is surfaced with the form preserved, so the absence of client-side maximum validation is not treated as a finding.
- Direct create and command handoff preserve BSON constructors in advanced options; LOW-2 is specifically about positioning or removing comments that the selected loose parser explicitly accepts, not the previously fixed BSON-fidelity issue.
- Vector definitions observed in the feature notes are normalized from `cosmosSearchOptions`, with a fallback for the alternate `cosmosSearch` container.
- The operator-registry scraper/generator changes preserve a structured generated source and have focused index-reference tests; no malformed generated index metadata was found.

## Validation

The repository's required checks were run against the reviewed branch after this report was added:

- `npm run prettier-fix` - passed; no tracked implementation files were changed.
- `npm run lint` - passed, with the existing ESLint v10 migration warning for the `/* eslint-env */` comment in `webpack.config.views.js`.
- `npx jest --no-coverage` - passed: 165 suites, 2,747 tests, and 4 snapshots.
- `npm run build` - passed for all workspace packages and the extension.
- `git diff --check` - passed.

A report-integrity check also confirmed that all 16 unique local Markdown targets exist and that all three unresolved Copilot comment permalinks are retained. Localization generation was not required because this review adds no extension user-facing strings.

## Recommended order

1. Restore configured confirmation behavior for deletion (MEDIUM-1) and stop the background build-poll error-toast spam (MEDIUM-2) — both affect the normal user path.
2. Disable busy-row actions and fix raw-comment command rendering (LOW-1, LOW-2).
3. Tighten the RPC schema and address the small Copilot implementation concerns (LOW-3 through LOW-5).
