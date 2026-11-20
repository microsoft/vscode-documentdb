---
feature: build-and-test-stack
kind: review
status: active
created: 2026-11-16
prs: [1087]
---

# November dependency security update: AI pre-review

Scope: the five dependency families in the
[operator-approved plan](../../../dependabot-remediation-2026-11-16.md), including
manifest/lockfile agreement, API compatibility, peer ranges, Node requirements,
all optional platform bindings and the seven-day publication gate. No application
code, test behavior, settings or exported formats changed.

## Initial review: claude-opus-5.5

**Result:** no significant defects. WI-5 compatibility approval: **88% confidence**.

The reviewer inspected the complete branch manifest and the changed FTP dependency
edge, including the actual installed `get-uri` and `basic-ftp` sources:

- The override is scoped under `get-uri`; its version and parents are unchanged.
- `Client`, `access`, `lastMod`, `list`, `downloadTo` and `close` remain compatible.
- `FTPError.code` remains numeric, preserving `get-uri`'s 550-to-`ENOTFOUND` path.
- Upstream rejects separate passive-mode transfer hosts by default, as the plan
  explicitly anticipates. The new listing-size limit does not establish a
  supported-workflow regression.
- The Vite, Rolldown, Identity/MSAL, wasm-util and source-map-js manifest entries
  match the accepted plan.

The loopback-only FTP smoke checked exact PAC bytes, `ENOTMODIFIED`, `ENOTFOUND`
and numeric error 550. The reviewer read that evidence and the 84-test result;
it did not independently rerun those tests.

## Different-vendor validation and independent sweep: gpt-6.1-sol

**Result:** no blocking or non-blocking defects. **90% confidence**, limited to the
reviewed dependency graph.

The validator reviewed the cumulative manifest and lockfile delta against `main`,
including WI-5. It confirmed the initial review and independently checked changed
dependency edges, peers, minimum Node compatibility, platform entries and affected
loading/bundling paths:

- All fifteen Rolldown bindings are `1.1.5`; wasm-runtime is `1.1.6` and wasm-util
  remains `0.10.4`. The hypothesized inert override did not occur.
- Unchanged MSAL Browser requires root `msal-common@16.5.1`; Node MSAL correctly
  uses nested `16.14.2`. Keeping both is not a defect.
- The exact `source-map-js@1.2.2` override is the plan's accepted fallback after
  targeted updates made no change.
- A repeated cumulative publication scan checked 36 introduced versions:
  zero fresh versions, unknown publication times or lookup failures.

## GitHub reviewer feedback and author decisions

GitHub PR reviews and inline review comments were both empty at the collection
snapshot on 2026-11-16, while the PR was a draft; no Copilot review is claimed here.
Any later reviewer feedback must be incorporated before human-review handoff.

No defects were proposed, so there are no finding-specific author decisions to
invent or record. Implementation follows the operator's instruction to implement
the attached plan. The advisor's technical resolutions and every item commit are
recorded inline in that plan.

## Validation boundaries

The review is not proof of interactive behavior in an installed workbench.
At 12:15 UTC on 2026-11-16, the operator reported that the listed manual
Entra sign-in, Azure discovery, Collection View and shell checks passed.
Packaged lazy Identity loading remains separately unverified; the extra
packaged fake-endpoint proof awaits an operator decision.

Both local verification cases passed, including strict package-test type checks,
the complete runtime suite and packaging. VSIX inspection and installed
activation passed, as did the unchanged L2-dev Collection View scenario and
full remote CI. Task-local GUI libraries recovered activation; a visible
headless browser avoided the integrated hidden tab's missing animation frames.
Final publication scans found no fresh versions; the four full-scan unknowns
were unchanged local workspaces. Detailed evidence is recorded in the source
plan rather than duplicated here.
