---
feature: atlas-discovery
kind: notes
status: active
prs: [733, 765, 834]
verified: 2026-08-14
code:
    - src/plugins/service-atlas-mongodb/**
    - src/webviews/documentdb/atlasCredentials/**
---

# Atlas Discovery

**Status:** shipped · **Verified:** 2026-08-14

> Why Atlas discovery is a plugin with its own auth model, and what the three UX review rounds
> changed.

The MongoDB Atlas discovery provider lets a user browse their Atlas organizations, projects, and
clusters from the Discovery view and connect to them. It authenticates against the Atlas Admin API,
which is a **different** credential domain from the MongoDB wire protocol used to talk to the
cluster itself.

Its sibling is [kubernetes-discovery](../kubernetes-discovery/README.md); the two were deliberately
aligned during UX review iteration 1.

## Code map

- `src/plugins/service-atlas-mongodb/**` — the provider, Atlas Admin API client, digest auth,
  session manager, discovery tree, and discovery wizard
- `src/webviews/documentdb/atlasCredentials/**` — the credentials webview

## User docs

- [docs/user-manual/service-discovery-mongodb-atlas.md](../../../user-manual/service-discovery-mongodb-atlas.md)
- [docs/user-manual/service-discovery-mongodb-atlas-credentials.md](../../../user-manual/service-discovery-mongodb-atlas-credentials.md)
- [docs/user-manual/service-discovery-mongodb-atlas-browse.md](../../../user-manual/service-discovery-mongodb-atlas-browse.md)
- [docs/user-manual/service-discovery-mongodb-atlas-troubleshooting.md](../../../user-manual/service-discovery-mongodb-atlas-troubleshooting.md)
- Data flow: [docs/atlas-mongodb-discovery-flow.md](../../../atlas-mongodb-discovery-flow.md)

## Related skills

- [.github/skills/tree-cluster-architecture](../../../../.github/skills/tree-cluster-architecture/SKILL.md)
  — cluster identity and the dual-ID rule this provider must follow
- [.github/skills/error-translation](../../../../.github/skills/error-translation/SKILL.md)

## Architecture (intent — code is authoritative for behavior)

- **A plugin, not a service.** It lives under `src/plugins/` because it is an optional discovery
  source with its own lifecycle, not extension-wide infrastructure.
- **Two auth layers that must not be confused.** The Atlas Admin API credential (API key or Service
  Account) discovers clusters. Connecting to a cluster still needs database-user credentials over
  the wire protocol. Every error message has to say which one failed.
- **Two authentication methods behind one entry point.** API key and Service Account are offered
  from a single QuickPick. Interactive browser OAuth was rejected: Atlas has no officially supported
  third-party path today.
- **`clusterId` is a stable, slash-free composite key.** Discovery-view identities sanitize slashes;
  the original Atlas resource identity is kept separately for API calls.
- **401 and 403 are not the same failure.** A 401 triggers a silent Service Account token refresh
  before giving up; a 403 must clear the cached session so "Manage Credentials" re-prompts.

## Timeline

| Date       | PR   | What changed                                                | Docs                                                                                   |
| ---------- | ---- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 2026-06-15 | #733 | Plugin scaffold, Atlas tree, decisions and work items       | [decisions.md](./decisions.md)                                                         |
| —          | #733 | UX review 1: alignment with Kubernetes discovery            | [iterations/01-ux-review-k8s-alignment.md](./iterations/01-ux-review-k8s-alignment.md) |
| —          | #733 | UX review 2: the cluster item                               | [iterations/02-ux-review-cluster-item.md](./iterations/02-ux-review-cluster-item.md)   |
| —          | #733 | UX review 3, plus the multi-credential feasibility question | [iterations/03-ux-review.md](./iterations/03-ux-review.md)                             |
| 2026-07-30 | #765 | Code review (tracked in a folder later numbered #834)       | [iterations/04-code-review-2026-07-30.md](./iterations/04-code-review-2026-07-30.md)   |

> **Provenance note:** the folder this last document came from was named for PR #834 while the
> document itself reviews PR #765. Both numbers are recorded in its frontmatter; the PR number is no
> longer the navigation key precisely because of mismatches like this one.

## Decisions

[decisions.md](./decisions.md) carries seventeen numbered design decisions and the bugs that forced
some of them, in the format they were originally written. It predates the decision template used by
[local-quickstart](../local-quickstart/decisions.md); convert it opportunistically rather than in
bulk.

## Open gaps

- [multi-credential-research.md](./multi-credential-research.md) — the multi-credential feasibility
  study: credential scoping, aggregation semantics, error attribution with per-credential blame,
  rate-limit headroom, and the experiments that still need a live Atlas account.

## Reading order for newcomers

1. This README
2. [decisions.md](./decisions.md)
3. [iterations/03-ux-review.md](./iterations/03-ux-review.md) for the most recent UX state
