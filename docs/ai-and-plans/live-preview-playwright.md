---
kind: practice
status: active
created: 2026-08-04
verified: 2026-10-05
---

# Live webview preview + Playwright checks

## Current way: L2-dev

Use the committed **L2-dev scenario page**, not a hand-made HTML shim or an untyped host stub.
Start `npm run watch:views`, then open `http://localhost:18080/scenarios/` (127.0.0.1 also works).
The index lists every `/<view>/<scenario>/<theme>` route with dark, light and high-contrast palettes.
The webviews come directly from Vite sources, including the React-refresh preamble at `/views.js`;
there is no stale `dist/views.js` to rebuild and no `src/webviews/static/` preview page to create.

See [build/verification/README.md](../../build/verification/README.md#l2-dev-source-scenarios)
for the runner recipe. Fetch `/scenarios/run-all.js` from a page on the dev-server origin and
execute it **outside the page**, passing the Playwright `page`. Subsets use path segments:
`/scenarios/run-all/localQuickStart.js` or `/scenarios/run-all/localQuickStart/dark.js`.
No new browser test framework or repository dependency is required.

[Typed scenarios](../../build/verification/browser/scenarios.ts) import the five settled L2 defaults
and add nine Local Quick Start states. Each has initial configuration, router-inferred fixtures,
readiness, optional click/fill steps and assertions. Direct routes with steps start at their entry
state; inspect `window.__scenario.data.steps` and drive them, or let the helper do so.
The helper starts each route from `about:blank`, performs those steps, then polls `data-ready`
through `page.evaluate`. Do not use `load`, `networkidle` or CSP-blocked `page.waitForFunction`.

`data-ready="true"` means the scenario's visible content/selectors have settled, without a visible
progressbar where appropriate. `data-ready="failed"` means a console error/warning, page error,
unhandled rejection, CSP violation or unknown RPC occurred. Reasons are in `window.__harnessErrors`;
the monitor stays active after readiness. Never filter a genuine app diagnostic to make a route pass.
The helper returns readiness, errors, per-assertion results and `window.__harnessCalls` for every route.
Escaping actions are recorded, not performed: the Docker install scenarios assert one
`common.openUrl` call with the expected Windows/macOS Desktop or Linux Engine URL.

L2-dev is the fast development loop. [L2](../../build/verification/README.md#l2-production-webviews-in-the-integrated-browser)
remains the packaged-VSIX gate: production assets, host template/CSP, styles and rendered-editor
worker round-trips. Screenshots in either mode are artifacts, **never pixel baselines**.

## The check loop

1. Open a scenario route; run its typed steps or the helper.
2. Read the accessibility tree for roles, names, disabled state and focus.
3. Use Playwright for clicks, viewport measurements and computed styles.
4. Capture a screenshot only for questions the tree cannot answer: colour, spacing and weight.

Useful checks at a normal width and roughly 312 px of content width:

```javascript
// Horizontal overflow.
document.documentElement.scrollWidth <= window.innerWidth;
// Focus after step navigation.
document.activeElement.tagName === 'H2';
// Is the footer inside the scroll region?
scroll.scrollHeight > scroll.clientHeight;
// What is an element actually painting?
getComputedStyle(element).backgroundColor;
```

## Gotchas retained from the manual preview

**Theme variables are not decoration.** The Fluent adaptive palette derives from the VS Code
button colour, and Monaco reads editor tokens. L2-dev supplies representative palettes on `<html>`
and matching VS Code classes / `data-vscode-theme-kind` on `<body>`. Do not replace them with
application-style overrides. They are not live values from a user's installed theme.

**The integrated browser's default viewport is about 548 px.** It can silently hit narrow-layout
media queries. For **measurements**, set an explicit viewport and assert `window.innerWidth`.
Do not assume this advice applies to screenshots.

**Integrated-browser emulation can move the DOM but not the compositor.** After `setViewportSize`
(or CDP `Emulation.setDeviceMetricsOverride`), DOM geometry can report an emulated viewport while
the rasterized surface retains the real window size/scale. A locator screenshot can then exclude
content despite correct DOM-side checks. This was observed in the integrated browser; do not
assume every headless Chromium runner has that behavior.

For affected screenshot tools:

1. Leave the viewport alone and give the measured harness element a fixed CSS width instead.
2. Capture the whole viewport, not a clipped or locator screenshot.
3. Crop afterwards using the image's content bounds.
4. Verify the image itself, not just the DOM.

Viewport-driven media queries still need the real window in the desired band, or an honest caption
describing the band that was captured.

**`box-sizing` may be `content-box`.** A 760 px maximum width plus 24 px padding measures 808 px.
Match a footer to its content column with the same maximum width, not the measured outer width.

**HMR can mislead after hook changes.** A stale hot-patch can report
`Should have a queue. You are likely calling Hooks conditionally` with a hook-order diff.
Navigate through `about:blank` to reload before diagnosing. Keep the original failure in the report;
do not suppress it.

**Remote port forwarding mangles query strings silently.** A query like
`?view=localQuickStart&t=2` can arrive as one escaped parameter and select a fallback state.
Use L2-dev's path-only routes and helper subsets. Unknown routes are 404, never a default scenario.

**Unknown RPCs must fail explicitly.** The old manual stub's blanket null/undefined replies and
unanswered queries hid fixture drift. The shared core now records the path, sends an error and
fails the page; add a router-typed fixture rather than inventing a success-shaped fallback.

**The dev-server error overlay can corrupt layout measurements.** It can add an iframe or shadow
and mimic overflow. Assert the absence of unexpected overlay elements; fix and report the underlying
diagnostic, then rerun. Do not clear/filter app errors just to obtain a green measurement.

**Vite configuration changes need a restart.** Source edits use HMR, but when changing plugins or
server behavior, verify the server restarted and `/views.js` and `/scenarios/` are responsive.
Stop the server after the check.

## What this does not prove

- Not a real `vscode-webview://` origin, extension host, panel chrome or host sizing.
- Fixtures do not exercise Docker probes, storage, backend behavior, cancellation or telemetry.
- All three representative palettes are covered, not arbitrary installed VS Code themes.
- Screen-reader behavior is inferred from roles/names, not observed on real assistive devices.
- Dev-server worker behavior is not production worker bundling; use L2 for that.

## Future work

CI/browser-image integration and promotion to a dedicated skill remain separate decisions.
Do not add a second runner or screenshot baselines as part of ordinary scenario work.

## History

The original manual technique was written after the Local Quick Start redesign
(`dev/tnaum/quickstart-ui-redesign`). It caught layout defects including a misaligned info icon,
a grey code block on an error tint and a footer note 48 px narrower than its content column.
The design lab pages were temporary and never committed.

It was exercised again on 2026-08-19 for the wizard-surface extraction
([webview-fluentui-package increment 2](./features/webview-fluentui-package/iterations/02-wizard-shell-and-components.md)).
Geometry comparisons, rather than pixel baselines, carried that work and produced several gotchas
above. L2-dev replaces the hand-made page/stub technique while retaining those lessons.
