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

## Copilot's second review

Four more comments, on `f2d11bf2`.

| Item | Copilot | Reassessed | Finding                                                                                                                                                                                                                           | Decision and reason                                                                                                                                                                   |
| ---- | ------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C5   | High    | Medium     | [The pre-removal check fell back to the tag](https://github.com/microsoft/vscode-documentdb/pull/1083#discussion_r4580131976) when the old container's image had no digest or the inspect failed, and that inspect was unbounded. | Fixed: the inspect is bounded and cancellable; an unpinnable image is run by the container's own image ID; a failed inspect stops before removal unless the record is already pinned. |
| C6   | High    | Low        | [A volume that appeared while a tag-only record pulled](https://github.com/microsoft/vscode-documentdb/pull/1083#discussion_r4580131989) passed the creating-stage check because the run was reusing.                             | Fixed: a tag pulled because no volume existed now refuses a volume found at creation, with the existing message. Low: something outside VS Code has to create the volume mid-pull.    |
| C7   | High    | Medium     | [The running image was saved only after readiness](https://github.com/microsoft/vscode-documentdb/pull/1083#discussion_r4580132004), so a failed recreate left the tag for its retry to follow.                                   | Fixed: a reused volume's pin is saved as soon as the started container is inspected.                                                                                                  |
| C8   | Low     | Low        | [Image refusals and disposition are not in telemetry](https://github.com/microsoft/vscode-documentdb/pull/1083#discussion_r4580132016).                                                                                           | Deferred to an issue: new telemetry properties are outside this fix.                                                                                                                  |

## Validation gate: Gemini 4 Carbon (§6.1 steps 3 and 4)

One round at high effort over the whole branch. G1 was confirmed live on Podman 6.1.4.

| Item | Severity | Finding                                                                                                                                                                                      | Decision and reason                                                                                                          |
| ---- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| G1   | High     | Podman empties `RepoDigests` once the tag moves, so an older image was never pinned. This supersedes S1's "only development images lack one".                                                | Fixed: `inspectImage` falls back to Podman's `Digest` when `NamesHistory` shows the image came from the official repository. |
| G2   | High     | A refusal on a run that replaced an earlier attempt's `provisioning` record deleted that record, and with it the only credentials for the volume. Pull failures did the same before this PR. | Fixed: a failed reusing attempt puts the replaced record back instead of deleting it.                                        |
| G3   | Medium   | A container run by image ID, adopted with no record, saved the bare ID as its image, which no pull can fetch.                                                                                | Fixed: adoption ignores an image name that is a bare ID.                                                                     |
| G4   | Medium   | Podman can't inspect a pinned `repo@digest` once the tag has moved, so recreate pulls by digest, and fails offline.                                                                          | Deferred to an issue: the pull fetches the exact image, so the data is safe.                                                 |
| G5   | Medium   | After a readiness timeout, reopening the panel and choosing **Wait longer** shows fresh-setup wording instead of recreate wording.                                                           | Deferred to an issue: wording only.                                                                                          |
| G6   | Low      | **Preparing image** says "Kept from existing data" when the volume and image were both gone.                                                                                                 | Deferred to an issue: same as before this PR.                                                                                |
| G7   | Low      | Tests stub `repoDigests`, and §6.1 step 3 had not run.                                                                                                                                       | Addressed: G1 and G2 have tests now, and this section is step 3.                                                             |

## Not yet done

- No recreate has been run against real containers. The live engine checks cover `run` by ID, `RepoDigests` and the Podman `Digest` fallback.
