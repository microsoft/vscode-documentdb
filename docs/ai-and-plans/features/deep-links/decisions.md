---
feature: deep-links
kind: decisions
status: active
prs: [898]
created: 2026-08-24
---

# Deep Links — Decisions

> The decisions that shaped the deep-link vocabulary, and what was rejected on the way.

| #    | Decision                                            | Status              | Changed from the proposal?                   | Date       | PR   |
| ---- | --------------------------------------------------- | ------------------- | -------------------------------------------- | ---------- | ---- |
| 0001 | The action goes in the path, not the query          | Accepted            | Accepted as proposed                         | 2026-08-24 | #898 |
| 0002 | An empty path means `connect`, forever              | Accepted            | Accepted as proposed                         | 2026-08-24 | #898 |
| 0003 | The action list is hand-written, never the registry | Accepted            | Raised from an implementation note to a rule | 2026-08-24 | #898 |
| 0004 | `local` names the product, not the internal command | Accepted            | Retained during maintainer review            | 2026-08-24 | #898 |
| 0005 | `local` opens the wizard without a confirmation     | Superseded by D0007 | Reversed after maintainer review             | 2026-08-24 | #898 |
| 0006 | Local links model the resource type                 | Accepted            | Added during maintainer review               | 2026-09-01 | #898 |
| 0007 | Local links show one lightweight confirmation       | Accepted            | Reversed 0005 during maintainer review       | 2026-09-01 | #898 |

> Entries below are **semantically** immutable: append new entries rather than rewriting old ones,
> and record reversals as a new entry plus a status change above. Heading text is frozen once
> written — a retitle means a new decision.

**Status vocabulary** (closed set of seven):

`Proposed` · `Open` · `Accepted` · `Accepted (modified)` · `Deferred` · `Superseded by D#` ·
`Rejected`

---

## 0001 — The action goes in the path, not the query

**Status:** Accepted · **Date:** 2026-08-24 · **Raised by:** maintainer request for "a command switch … with some good nomenclature"

### Question

The handler could only connect. To do anything else — open the DocumentDB Local wizard, later reach
a discovery plugin — a link needs to name an action. Where does that name live?

### Decision

In the path: `vscode://ms-azuretools.vscode-documentdb/<action>?<parameters>`.

### Reasoning

The query answers _how_ to perform an action. Putting _which_ action in the same bag means every
future reader has to know which keys are the verb and which are its arguments, and the distinction
is invisible in the URL itself.

The path also gives the discovery plugins somewhere to live. The handler's original JSDoc already
anticipated them — "other modes … will be handled by our discoverability plugins" — and there are
five. `/discovery/<provider>` is a natural sub-route; `?action=discovery&provider=…` is a flat
namespace pretending to be a hierarchical one.

It matches how other VS Code extensions route, too (`vscode://ms-vscode.remote-repositories/open?url=…`),
so it is the shape a contributor is likely to expect.

### Rejected alternatives

- **`?action=<verb>`** — one parsing path and no path handling, which is genuinely simpler. Rejected
  because it conflates the verb with its arguments and cannot namespace the plugins without
  inventing a convention inside the query (`provider` only meaningful when `action=discovery`),
  which is the ambiguity this decision exists to avoid.
- **A separate URI authority per action** — VS Code fixes the authority to the extension id.

---

## 0002 — An empty path means `connect`, forever

**Status:** Accepted · **Date:** 2026-08-24 · **Raised by:** backward-compatibility analysis

### Question

Adding a verb changes the shape of every link. What happens to links already published?

### Decision

An empty path is `connect`. Not deprecated, not warned about — a permanent, supported spelling.

### Reasoning

`globalUriHandler` dispatched on `uri.query` alone and never read `uri.path`, so **every link ever
published has an empty path.** That is what makes the change safe, and it also means the legacy form
must keep working indefinitely: a link in a blog post, a tutorial, or a customer's internal wiki
cannot be recalled or updated.

Treating this as a migration with a sunset would be a promise the extension cannot keep, because it
does not know where the links are.

### Consequence

`connect` is the one action that can never be renamed or removed, since it is what silence means.

---

## 0003 — The action list is hand-written, never the command registry

**Status:** Accepted · **Date:** 2026-08-24 · **Raised by:** review of what a "command switch" would expose

### Question

The extension already contributes a command for everything a link might plausibly want. Should the
switch map the URL's verb onto a command id?

### Decision

No. `DEEP_LINK_VERBS` is a hand-written array, and dispatch is an exhaustive `switch` over it.

### Reasoning

A URL arriving from outside VS Code is untrusted input — anyone who can get a user to click a link
supplies it. Among the extension's contributed commands are:

| Command                                | What a link could do            |
| -------------------------------------- | ------------------------------- |
| `localQuickStart.delete`               | delete the user's container     |
| `localQuickStart.copyPassword`         | put a password on the clipboard |
| `localQuickStart.copyConnectionString` | exfiltrate a connection string  |

A registry-backed switch reaches all of them, and would keep reaching every command added later —
the vulnerability would be introduced by someone contributing an unrelated feature, months after
this code was reviewed. An allow-list fails the other way: a new action does nothing until someone
adds it deliberately.

Recording this as a decision rather than a comment is the point. "Look up the command id" is the
obvious simplification of this code, and the reason not to is not visible from the code itself.

### How it is enforced

`src/vscodeUriHandler.test.ts` asserts that `/delete`, `/copyPassword`,
`/localQuickStart.delete`, `/vscode-documentdb.command.localQuickStart.delete` and `/../local` are
all refused and reach nothing.

---

## 0004 — `local` names the product, not the internal command

**Status:** Accepted · **Date:** 2026-08-24 · **Raised by:** the maintainer's emphasis on nomenclature

### Question

The wizard's command id is `vscode-documentdb.command.localQuickStart.open`, its title is "Set up
DocumentDB Local", and the product is "DocumentDB Local". Should the public verb be `local`,
`localQuickStart`, or `quickstart`?

### Decision

`local`.

### Reasoning

Internal ids are implementation detail and get refactored; "DocumentDB Local" is the product name a
user has already seen on the website that sent them. A public URL vocabulary that tracks internal
naming inherits every future rename as a broken link.

`quickstart` describes the wizard rather than the destination, and would read oddly once the same
verb is wanted for an instance that already exists.

### Open

**This is the decision the maintainer asked for and has not yet given.** The alternative worth his
opinion is whether public verbs should deliberately mirror internal command ids for
discoverability, which would make this `localquickstart`. Recorded as Accepted rather than Proposed
because a shipping default is needed and this one is reversible while the action is new — but it is
the first thing to raise.

### Resolution

Maintainer review retained `/local` as the public verb and placed the local resource type in the
next path segment. `/local` remains shorthand for the default resource type.

---

## 0005 — `local` opens the wizard without a confirmation

**Status:** Superseded by D0007 · **Date:** 2026-08-24 · **Raised by:** implementation

### Question

`connect` shows a modal before adding a connection, gated on `showUrlHandlingConfirmations`. Should
`local` show one too?

### Decision

No. `/local` opens the wizard directly.

### Reasoning

The `connect` confirmations exist because that path stores a connection and its secret **before the
user sees any UI** — the modal is the only place to decline. The wizard is itself that place: it
opens on an introduction step, provisions nothing until the user walks it, and can be closed.

A modal in front of it would put two consecutive prompts between a website's "Open in VS Code"
button and the thing it promised, which is precisely the friction this link exists to remove.

### Revisit if

An action is added that changes state before showing UI. That action needs a confirmation, and the
reasoning above is the test to apply — not "does `connect` have one".

---

## 0006 — Local links model the resource type

**Status:** Accepted · **Date:** 2026-09-01 · **Raised by:** maintainer review

### Question

Should `/local` identify only an action, or should it also leave room to identify which local
product the user wants to set up?

### Decision

The first qualifier identifies the local resource type. `/local/documentdb` explicitly names
DocumentDB Local, while `/local` remains equivalent shorthand that defaults to `documentdb`.

Only allow-listed resource types are accepted. Unknown types and additional qualifiers are rejected.

### Reasoning

`local` describes a family of setup actions rather than one implementation forever. Keeping the
resource type in the path leaves room for a future local offering without introducing another
top-level verb or changing links that already use `/local`.

The qualifier was previously parsed but ignored, which meant `/local/anything` silently opened the
DocumentDB Local wizard. Validation makes the public URL describe the action it will actually take.

### Consequence

Resource type keywords are matched case-insensitively, like verbs, because both are public URL
vocabulary rather than user data.

---

## 0007 — Local links show one lightweight confirmation

**Status:** Accepted · **Date:** 2026-09-01 · **Raised by:** maintainer review

### Question

Should an external link open the DocumentDB Local setup webview without confirmation because the
wizard begins on a non-mutating introduction page?

### Decision

Show one concise modal confirmation before opening the wizard when
`documentDB.confirmations.showUrlHandlingConfirmations` is enabled. Dismissing it cancels the
request. When the setting is disabled, the wizard opens directly.

### Reasoning

Opening a webview from an external link can still be surprising even when it does not immediately
change state. One confirmation gives the user control without copying the connection flow's
multiple-step confirmation sequence.

### Revisit if

User testing shows that the confirmation adds friction without helping users understand or control
the transition into VS Code.
