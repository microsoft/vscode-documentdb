---
feature: local-quickstart
kind: review
status: active
prs: [1083]
created: 2026-11-13
code:
    - src/services/localQuickStart/QuickStartService.ts
    - src/services/localQuickStart/ContainerRuntime.ts
---

# Recreate keeps its image — review

PR #1083 records the digest of the image a Quick Start instance runs, so Recreate container
no longer pulls `:latest` (now DocumentDB 1.2) onto data created by 1.0. The DocumentDB 1.2
release updates the extensions on an existing volume at startup, and 1.0 then fails on some
queries, so the upgrade can't be undone.

## Findings and decisions

The GitHub Copilot reviewer's four comments on `5caea70c`, each checked against the code.
The author asked for all four to be addressed; severity is reassessed after tracing them.

| Item | Copilot | Reassessed | Finding                                                                                                                                                                                                         | Decision and reason                                                                                                                                                                                                                             | Evidence   |
| ---- | ------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| C1   | High    | Medium     | [Adoption kept a recorded pin](https://github.com/microsoft/vscode-documentdb/pull/1083#discussion_r4562510964) without checking the container. A replacement that ran a newer image left the older pin behind. | Fixed: every deep reconcile pins from the adopted container, which outranks the record. Reconcile runs only at startup and on an explicit refresh, so the extra image inspect is cheap. An image that can't be pinned keeps the recorded value. | `09f231aa` |
| C2   | High    | Medium     | [Provision removed an existing container](https://github.com/microsoft/vscode-documentdb/pull/1083#discussion_r4562510925) before anything recorded its image, so a tag-only record could then run a newer tag. | Fixed: a reusing provision pins the existing container's image and saves it to the record and metadata before removing it, then uses it.                                                                                                        | `0caa0082` |
| C3   | High    | Low        | [Creation still ran the mutable tag](https://github.com/microsoft/vscode-documentdb/pull/1083#discussion_r4562510789), which could move after the check or be pulled implicitly if it vanished.                 | Fixed: a reused local image is run by the image ID just inspected. Low, because the window is the gap between inspect and `run`. Checked on Docker and Podman: both run a `sha256:` ID, and a missing ID fails with exit 125 without pulling.   | `7b10ce25` |
| C4   | High    | Medium     | [A failed image check read as absence](https://github.com/microsoft/vscode-documentdb/pull/1083#discussion_r4562510854), so setup said the image was gone and advised a pull that could upgrade the data.       | Fixed: an unknown result now stops with "couldn't check", without pull advice. Pull advice stays for confirmed absence.                                                                                                                         | `6e881cd5` |

## Independent sweep

| Item | Severity | Finding                                                                                                                                                | Decision and reason                                                                                                                       |
| ---- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| S1   | Low      | An image with no digest for the official repository (built or retagged locally) is never pinned; its record keeps the tag.                             | Accepted: only development images lack one. Podman behind the Docker CLI lists `ghcr.io/documentdb/documentdb/documentdb-local@sha256:…`. |
| S2   | Low      | A tag-only record whose container is already gone runs the local tag, which a later pull may have moved to a newer image.                              | Accepted: nothing left records the original. Configure already says the original image identity is not recorded.                          |
| S3   | Low      | A user who pulls the tag and retries upgrades the data at startup, which counts against the 180-second readiness wait; a large volume could exceed it. | Accepted: the timeout offers **Wait longer**, and this path needs a deliberate pull.                                                      |

## Not yet done

- Validation gate by a second vendor's model (§6.1 step 3) has not run.
- No recreate has been run against real containers; the engine checks above cover `run` by ID and `RepoDigests` only.
