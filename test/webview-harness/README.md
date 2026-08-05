# Webview visual harness

Renders a webview in a plain browser so its states can be checked — by a human or by Playwright —
without running the extension, starting Docker, or reaching each state by hand.

The harness stands in for the extension host: it stubs `acquireVsCodeApi()` and answers the tRPC
wire protocol (`{id, op:{type, path, input}}` in, `{id, result}` back over the window message bus)
with canned data selected by a query parameter. Nothing talks to Docker or to a database.

## Automated: `npm run test:visual`

```sh
npm run webpack-dev-wv            # build dist/views.js — the suite does NOT do this for you
npm run test:visual               # Playwright; starts the harness server itself
npx playwright show-report testOutput/playwright-report
```

`localQuickStart.spec.ts` pins the defects found in the `0.10.0-bug-bash-1` bug bash that have a
webview surface, so a regression fails the build instead of waiting for the next bash to rediscover
it: the per-platform Docker install link and restart guidance (#855, #856), the reworked success
screen (#857), a Docker-assigned host port reaching the connection details (#854), and the localized
port error (#852). The two defects with no webview surface are pinned in Jest instead — #851 in
`src/commands/localQuickStart/contributions.test.ts`, #858 in
`src/commands/newLocalConnection/localEndpoint.test.ts`.

Each state is also captured to `testOutput/screenshots/` and attached to the Playwright report.

**These captures are artifacts, not baselines.** Text here is rendered by the OS, so a pixel
baseline recorded on one contributor's machine fails on another's for reasons that have nothing to
do with the UI. The behavioral assertions are the gate; the images are for a human to look at. If
runs are ever standardized on a single container image, they can become `toHaveScreenshot`
baselines.

## Manual

```sh
npm run webpack-dev-wv
node test/webview-harness/serve.js
```

Then open the printed URL. The server serves `dist/` as the site root (the harness imports
`./views.js` as an ES module, which needs an http origin) and serves its own `*.html` from this
folder.

## Local Quick Start (`quickstart-harness.html`)

| Parameter  | Values                                                                                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scenario` | `introduction`, `configure`, `provisioning`, `success`, `success-relocated-port`, `failed-port-in-use`, `failed-timeout`, `docker-missing-windows`, `docker-missing-mac`, `docker-missing-linux` |
| `theme`    | `dark` (default), `light`                                                                                                                                                                        |

Example: `http://127.0.0.1:18099/quickstart-harness.html?scenario=docker-missing-windows&theme=light`

The harness advances the wizard the way a user would — by clicking the footer's primary action —
because the phase is component state, not a prop. It sets `window.__harnessReady` once the requested
phase is reached, so tests wait on a signal rather than a sleep.

Actions that would leave the webview (`openUrl`, `copyConnectionString`, `openConnection`) are
recorded on `window.__harnessCalls` and logged to the console instead of being performed. That is how
the per-platform Docker install link is verified: open a `docker-missing-*` scenario, click the
install CTA, and read back the URL it would have opened.

### Adding a scenario

Add an entry to `READINESS_BY_SCENARIO` (what the Docker check returns) and/or `STAGE_STREAMS` (the
provisioning events). A stream is closed only when its last event is terminal — a stream that ends
without one makes the webview fall back to the settings page, which is correct behavior and would
silently undo a mid-provision scenario.

## Caveats

- The `--vscode-*` theme variables here are a representative slice of Dark Modern / Light Modern,
  not the live values from a VS Code window. Colors are close, not pixel-exact.
- Relative times render oddly because the canned readiness uses `checkedAtMs: 1`.
- Host-side behavior (the Docker probes, provisioning, storage) is not exercised at all — this shows
  what the panel renders for a given host response, nothing more.
