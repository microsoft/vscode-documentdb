---
feature: welcome
kind: notes
status: active
created: 2026-10-15
code:
  - src/services/welcomeScreen.ts
  - src/services/welcomeScreen.test.ts
  - src/documentdb/ClustersExtension.ts
  - package.json
---

# Welcome walkthrough

The 1.0 walkthrough introduces connections, DocumentDB Local, service discovery, the Cluster
Dashboard and collection copy/paste. VS Code renders its content from `contributes.walkthroughs`
in the extension manifest. Extension activation requests that VS Code open the registered guide;
it does not load or render the manifest itself.

## Upgrade deferral

Updating the extension in a running window can load the new extension code while leaving the
workbench's old manifest contributions registered. Restarting the extension host does not
necessarily refresh them; reloading the window does. Related upstream reports:
[microsoft/vscode#283457](https://github.com/microsoft/vscode/issues/283457) and
[microsoft/vscode#287872](https://github.com/microsoft/vscode/issues/287872).

For 1.0, existing users quietly wait for a later window session instead of seeing stale onboarding
or receiving an additional reload prompt:

- A previously shown legacy welcome (`welcomeScreenShown_v0_4_0`) identifies an existing user.
- On the first upgraded activation in a workspace, record `vscode.env.sessionId` in workspace
  state under `welcomeScreenDeferredSession_v1_0_0`, without opening or consuming the new guide.
- Further extension-host activations with that same session identifier continue to defer.
- Once the workspace observes a different window-session identifier, request the updated guide.
- A fresh install has no legacy welcome flag and keeps automatic onboarding after activation.
- The global `welcomeScreenShown_v1_0_0` flag prevents repeated onboarding across workspaces and
  patch updates. Existing preview installations that already consumed this flag are not reset.

Pending state is workspace-scoped so a different workspace's first upgraded activation does not
consume another workspace's deferral. This is conservative: a user whose first 1.0 activation
already follows a full reload waits one more session. A session change is not a public API for
inspecting the currently registered manifest, and simultaneously open windows for the same
workspace share workspace state; the policy does not prove manifest freshness in that case.

The shown flag is written after the open command resolves. Explicit command/storage failures are
logged without failing extension activation, and an unsuccessful shown-state write remains
retryable. Command completion acknowledges the request, not successful rendering: VS Code does
not expose a supported walkthrough-rendered callback or registered-manifest revision.

No timers approximate a reload, no window is forcibly reloaded, and the existing release-notes
notification remains unchanged.

## Code map

- [welcomeScreen.ts](../../../../src/services/welcomeScreen.ts): session policy, opening and state.
- [welcomeScreen.test.ts](../../../../src/services/welcomeScreen.test.ts): lifecycle and failure tests.
- [ClustersExtension.ts](../../../../src/documentdb/ClustersExtension.ts): nonblocking activation hook.

## Installed-window verification

Before requesting review, exercise both desktop and Remote windows:

1. Install and activate 0.11.1, then install 1.0 in the running window and restart extensions.
   The updated welcome must not open.
2. Restart only the extension host again. The guide must remain deferred.
3. Reload the window. The five-step 1.0 guide must open, and not reopen on another reload.
4. With clean extension state, install 1.0. Fresh-install onboarding must still open.
5. Check separate workspaces and simultaneously open windows of the same workspace; the latter
   has the shared-state limitation described above.
