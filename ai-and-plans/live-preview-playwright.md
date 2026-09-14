---
kind: practice
status: active
created: 2026-08-04
verified: 2026-08-19
---

# Live webview preview + Playwright checks (future work)

> How to render a **production** webview in a plain browser, drive it with Playwright, and assert
> layout / accessibility / overflow without launching an extension host. Written up after the Local
> Quick Start redesign (PR branch `dev/tnaum/quickstart-ui-redesign`), where the technique caught
> real defects — a misaligned info icon, a grey code block punching through an error tint, and a
> footer note that was capped 48 px narrower than the content column it was supposed to align with.

**Status:** working technique, not yet a skill. This document is the recipe. Iterate here.

---

## Why this exists

The webview bundle served by `watch:views` is the same bundle the extension loads. Point a browser
at it with a small HTML shim and you get the real component tree — real Fluent styling, real
`makeStyles` output, real DOM — in a few seconds, with a full DevTools/Playwright surface and no F5
cycle.

That makes it cheap to answer questions that are otherwise guesswork:

- Does anything overflow horizontally at 312 px of content width?
- Does the breadcrumb collapse into its overflow menu while keeping the current step visible?
- Does focus land on the new step's `h2` after navigation?
- Is that icon _actually_ aligned with its text, or does it just look close?

---

## Prerequisites

The `watch:views` task must be running. Probe it:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:18080/views.js   # expect 200
```

The dev server emits the **bundled** asset name, so `/views.js` is 200 and `/index.js` is 404 —
requesting the wrong one is the usual cause of a blank preview. Note also that `webpack serve` reads
`webpack.config.views.js` only at startup: editing it (or a `git checkout` that reverts it) requires
a full restart of `watch:views`.

Anything dropped in `src/webviews/static/` is served at `/static/<name>.html`.

---

## The harness

A minimal page that mounts one registered webview. The view name is the key from
[`src/webviews/_integration/WebviewRegistry.ts`](../../src/webviews/_integration/WebviewRegistry.ts) —
`localQuickStart`, `collectionView`, `atlasCredentials`, and so on.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <style>
      /* Load-bearing — see "The theme variables are not decoration" below. */
      :root {
        --vscode-button-background: #0e639c;
        --vscode-editor-background: #ffffff;
        --vscode-editor-foreground: #1f1f1f;
        --vscode-foreground: #3b3b3b;
        --vscode-sideBar-background: #f8f8f8;
        --vscode-editorWidget-background: #f3f3f3;
        --vscode-editorWidget-border: #d4d4d4;
        --vscode-panel-border: #d4d4d4;
        --vscode-widget-border: #d4d4d4;
      }
      html,
      body,
      #root {
        height: 100%;
        margin: 0;
      }
    </style>
  </head>
  <body data-vscode-theme-kind="vscode-light">
    <div id="root"></div>
    <script type="module">
      import { render } from '/views.js';
      globalThis.l10n_bundle = {};
      const state = {};
      render('localQuickStart', {
        postMessage: () => Promise.resolve(true),
        getState: () => state,
        setState: (n) => Object.assign(state, n),
      });
    </script>
  </body>
</html>
```

### The theme variables are not decoration

Omit the `--vscode-*` block and the app dies before it renders:

```
TypeError: Cannot read properties of undefined (reading '0')
    at snappingPointsForKeyColor
    at paletteShadesFromCurvePoints
    at getBrandTokensFromPalette
    at generateAdaptiveLightTheme
    at WithTheme
```

The adaptive theme generator derives a brand palette from the VS Code button colour. No variables,
no palette, blank page. If you see that stack, it is the harness, not the component.

---

## Faking the extension host

The stub above is enough for pages that do not need data, but any view that issues a tRPC call will
hang on it. To drive real states — a failed Docker check, a populated grid — answer the wire
protocol directly. The shapes are in
[`packages/vscode-ext-webview/src/shared/wireProtocol.ts`](../../packages/vscode-ext-webview/src/shared/wireProtocol.ts);
the host side that produces them is
[`packages/vscode-ext-webview/src/host/attachTrpc.ts`](../../packages/vscode-ext-webview/src/host/attachTrpc.ts).

The webview sends `{ id, op }` where `op` carries `type`, `path` and `input`. Reply on the `window`
message bus:

- query / mutation result: `{ id, result }` then `{ id, complete: true }`
- subscription: one `{ id, result: <event> }` per emission, then `{ id, complete: true }`
- ignore `op.type === 'subscription.stop'` and `'abort'`

```js
const reply = (id, result) => window.postMessage({ id, result }, '*');
const complete = (id) => window.postMessage({ id, complete: true }, '*');

const fakeHost = {
  postMessage(message) {
    const { id, op } = message ?? {};
    if (!id || !op) return;
    if (op.type === 'subscription.stop' || op.type === 'abort') return;
    setTimeout(() => {
      if (op.path === 'localQuickStart.getDockerStatus') {
        reply(id, { readiness, status: { state: 'NotProvisioned' }, busy: false, willReuse: false });
        complete(id);
      } else if (op.path === 'localQuickStart.startQuickStart') {
        reply(id, { stage: 'checking', status: 'active' });
        setTimeout(() => {
          reply(id, { stage: 'checking', status: 'error', error: 'Daemon not reachable.' });
          complete(id);
        }, 400);
      } else {
        reply(id, null);
        complete(id);
      }
    }, 60);
  },
  getState: () => state,
  setState: (n) => Object.assign(state, n),
};
```

Build the payloads from the real types (here `DockerStatusResult` / `StageEvent`) so the fake cannot
drift into shapes the component never actually receives.

---

## The check loop

1. `open_browser_page` on a cache-busted URL.
2. `read_page` for the accessibility tree — this is usually more informative than a screenshot,
   because it shows roles, names and disabled state.
3. `run_playwright_code` to resize, click through states, and measure.
4. `screenshot_page` only for questions the tree cannot answer: colour, spacing, weight.

Steps 3 and 4 do not compose. Resizing is for measuring; a screenshot taken after a resize is of a
layout that no longer matches what the DOM reports. See Gotchas.

### Assertions worth running

```js
// No horizontal overflow at any width.
document.documentElement.scrollWidth <= window.innerWidth;

// Focus moved to the new step heading, not <body>.
document.activeElement.tagName === 'H2';

// Breadcrumb collapsed but kept the current step.
Array.from(document.querySelectorAll('nav[aria-label] button')).map((b) => b.textContent);

// Optical alignment, measured rather than eyeballed.
const ir = icon.getBoundingClientRect();
const tr = text.getBoundingClientRect();
// aligned when ir.top === tr.top and ir.bottom === tr.bottom

// What is that background actually painting?
getComputedStyle(code).backgroundColor;
```

Run at a normal width and at roughly 312 px of content width.

---

## Gotchas

**The integrated browser's default viewport is ~548 px.** Wide enough to trip `max-width: 560px`
media queries, so a "desktop" measurement may silently be the narrow layout. Call `setViewportSize`
explicitly and assert `window.innerWidth` before trusting **a measurement**.

Do **not** carry that advice over to a screenshot. See the next entry: for a screenshot it is not
merely useless, it is the cause.

**`setViewportSize` moves the DOM but not the compositor, and screenshots come from the compositor.**
This one cost most of a session, so it is worth stating exactly.

After `setViewportSize` (or CDP `Emulation.setDeviceMetricsOverride`), `window.innerWidth`,
`getBoundingClientRect()` and `getComputedStyle()` all report the **emulated** viewport, and media
queries evaluate against it. The surface that is actually rasterised keeps the **real** window size
and scale. So the page can report `innerWidth: 880` and `grid-template-columns: 176px 176px 176px
176px` while the captured image contains a two-column layout.

Two things follow, and the second is the trap:

- Every DOM-side check agrees with itself. `window.innerWidth` is the emulated number, so asserting
  it proves the emulation took, not that the capture matches.
- `locator.screenshot()` computes its clip rect from DOM pixels and the surface paints at a
  different scale, so content silently falls **outside** the rect. A four-card row loses its fourth
  card, with no error and no visible seam.

The recipe that works:

1. **Do not set a viewport at all** before capturing. Let the DOM and the compositor agree on the
   real window. Fix the layout by giving the harness element a hardcoded CSS `width` instead, which
   is a property of the page rather than of the emulation.
2. **Capture the whole viewport** with `page.screenshot()`, never a clip or a locator, because a
   full-viewport capture cannot exclude something that is on screen.
3. **Crop afterwards** by finding the content's bounds in the image itself, for example the
   bounding box of every pixel that is not the background colour.
4. **Verify the image, not the DOM.** Decode the PNG onto a `<canvas>` and count the ink clusters,
   or whatever the shot is supposed to contain. This is the only check that can fail when the
   capture is wrong.

Viewport-driven media queries are the case with no clean answer: the breakpoint reads the viewport,
and the viewport is the thing you must not touch. Either arrange for the real window to already sit
in the band you want, or accept the band it gives you and say so in the caption.

**`box-sizing` is `content-box`.** A `maxWidth: '760px'` element with `padding: '24px'` measures
808 px. Match a footer or banner to the content column by giving it the same `maxWidth`, not the
measured width.

**HMR will lie to you after a hook change.** Adding a `useRef` and letting the page hot-patch
produces `Should have a queue. You are likely calling Hooks conditionally` with a hook-order diff.
It is a stale-module artefact, not a bug in the change. Hard-navigate to a fresh URL.

**`page.goto(..., { waitUntil: 'load' })` can time out** when a stubbed tRPC request never settles.
The page renders fine; only the load event is pending. Catch the timeout and continue, or wait on a
selector instead.

**A remote workspace mangles query strings, and it fails silently.** `open_browser_page` rewrites
the URL when the port is forwarded: `?view=localQuickStart&t=2` arrives as
`?view%3DlocalQuickStart%26t%3D2` — one escaped parameter, not two. `searchParams.get('view')`
returns `null`, the harness falls through to its default, and **every page renders the same view**.
A comparison set up this way compares something against itself and agrees perfectly.

Use **one static page per view**, with the name hardcoded, and no query string. If two pages render
suspiciously identical measurements, check this before believing them.

**Never invent a reply shape for a path the stub does not know.** A blanket
`else { reply(id, null); complete(id); }` looks harmless and is not: a subscription handler that
reads the payload throws (`Cannot read properties of null`), which is a crash in the view under
test caused entirely by the harness. Reply only to paths you have built a real payload for, and
**leave everything else pending** — an unanswered query is inert, a wrong answer is not.

**The dev-server error overlay silently corrupts measurements.** It mounts as an `<iframe>` inside
the page, so it changes layout: in one round the footer reported an elevation border and shadow
while `scrollHeight === clientHeight`, which reads exactly like a real bug in overflow detection. It
was the overlay adding height. Assert `!document.querySelector('iframe')` — or whatever the page
should not contain — alongside the numbers, and re-measure after clearing it.

This is also the argument for measuring rather than screenshotting: the screenshot showed a shadow
and offered no way to tell defect from artefact. The pair of numbers that disagreed is what pointed
at a third element.

---

## What this does _not_ prove

Be explicit about this when reporting results — the renders are real enough to be persuasive well
beyond what they actually verify.

- **Light theme only.** Dark and high-contrast are untested. The harness hardcodes one palette.
- **Not the VS Code webview host.** No real theme variables, no CSP, no host messaging, no panel
  chrome or sizing behaviour.
- **Fake backend.** Nothing about service behaviour, cancellation, timeouts or telemetry is
  exercised.
- **No real user input devices.** Screen-reader behaviour is inferred from the accessibility tree,
  not observed.

Layout, overflow, focus order, roles and names are genuinely verified. Everything else is not.

---

## Future work

**Ship a committed harness instead of a throwaway.** Each round so far has created and deleted a
temporary page. A permanent `src/webviews/static/preview.html` would remove the
recreate-and-delete cycle. Needs a decision on whether it is dev-only or excluded from the packaged
extension — and note that the obvious design, `?view=localQuickStart`, is the one thing that cannot
work: see the query-string gotcha above. Select the view from `location.pathname`, a hash, or a
generated page per registry key.

**Theme switching.** Drive `data-vscode-theme-kind` and the `--vscode-*` block from a query string
so dark and high-contrast get the same coverage. This is the largest current gap.

**A fixture library for host responses.** Fake payloads are hand-written per session and typed only
by eye. Exported fixtures built from the real types — one per interesting state — would make the
states reproducible and keep them honest as the types evolve.

**Promote to a skill.** Once the harness is committed and theme switching works, this document is a
`SKILL.md` with a reference harness. It is deliberately not one yet: the recipe should stabilise
across a few more features first.

**Consider screenshot regression.** Tempting, and probably premature — Fluent version bumps would
churn baselines constantly. Revisit only if visual regressions actually start slipping through.

---

## History

The technique was first written down in the Local Quick Start design lab handoff, which was deleted
along with the lab once the redesign shipped. Those files were never committed, so this document is
the only surviving copy. Do not delete it without moving the recipe somewhere else first.

Exercised again on 2026-08-19 for the wizard-surface extraction
([webview-fluentui-package increment 2](./features/webview-fluentui-package/iterations/02-wizard-shell-and-components.md)),
where it was used to compare a mock built from the new components against the un-migrated view, and
then the migrated views against the recorded baseline. The measurement half carried that work — the
chrome was verified by comparing `getBoundingClientRect()` and `getComputedStyle()` element by
element, with screenshots used only for colour and weight. Three gotchas above came from that round.
