# Webview visual harness

Renders a webview in a plain browser so its states can be looked at without running the extension,
starting Docker, or reaching the states by hand.

The harness stands in for the extension host: it stubs `acquireVsCodeApi()` and answers the tRPC
wire protocol (`{id, op:{type, path, input}}` in, `{id, result}` back over the window message bus)
with canned data selected by a query parameter. Nothing talks to Docker or to a database.

## Running it

```sh
npm run webpack-dev-wv            # build dist/views.js
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
because the phase is component state, not a prop.

Actions that would leave the webview (`openUrl`, `copyConnectionString`, `openConnection`) are
logged to the console instead of being performed, so the destination can be checked. That is how the
per-platform Docker install link is verified: open a `docker-missing-*` scenario, click the install
CTA, and read the logged URL.

## Caveats

- The `--vscode-*` theme variables here are a representative slice of Dark Modern / Light Modern,
  not the live values from a VS Code window. Colors are close, not pixel-exact.
- Relative times render oddly because the canned readiness uses `checkedAtMs: 1`.
- Host-side behavior (the Docker probes, provisioning, storage) is not exercised at all — this shows
  what the panel renders for a given host response, nothing more.
