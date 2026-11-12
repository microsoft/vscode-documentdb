# Parked images

Framed screenshots that are ready to use but are not referenced by documentation, release notes,
walkthroughs or blog posts yet. This folder is excluded from the documentation site.

## Rules

- Store only finished framed images. Keep raw captures and jobs files in a gitignored scratch folder
  such as `docs/plan/`.
- Name parked images in snake_case without a version, for example `feature_name.png`. Keep the
  matching dark-site image beside it as `feature_name_dark.png`.
- When an image is used, move it to its destination and remove its row from this table. For release
  notes, rename it to `{version}_{feature_name}.png` in `docs/release-notes/images/`.
- Don't reference files from this folder in published content.

## Images

| Image                                                                                                                                        | Shows                                                                       | Intended use                                         | Parked     |
| -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------- | ---------- |
| [`local_quick_start_container_engine.png`](./local_quick_start_container_engine.png) ([dark](./local_quick_start_container_engine_dark.png)) | Local Quick Start Configure step with the preferred Docker or Podman choice | Release notes for Docker and Podman engine selection | 2026-11-12 |
