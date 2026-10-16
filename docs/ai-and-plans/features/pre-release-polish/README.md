---
feature: pre-release-polish
kind: overview
status: active
created: 2026-10-16
code:
  - README.md
  - resources/readme/**
  - docs/user-manual/copy-and-paste.md
  - docs/user-manual/data-migrations.md
  - src/services/survey/invitation/**
  - src/webviews/documentdb/atlasCredentials/AtlasCredentialsView.tsx
  - src/webviews/documentdb/clusterDashboard/ClusterDashboard.tsx
  - src/webviews/documentdb/collectionView/CollectionView.tsx
  - src/webviews/documentdb/localQuickStart/LocalQuickStart.tsx
---

# Pre-release polish

Small, cross-feature refinements prepared for the 1.0 release:

- theme-aware Marketplace README artwork;
- clearer data-migration discovery and documentation;
- consistent Fluent button appearances and a migration menu icon;
- stable wrapping of the survey title at narrow sidebar widths.

The migration feature is presented without an end-user experimental label, while its provider
API remains explicitly documented as experimental and restricted to registered extensions.

## Iterations

- [01-code-review.md](./iterations/01-code-review.md) - pre-review findings, decisions, and validation.
