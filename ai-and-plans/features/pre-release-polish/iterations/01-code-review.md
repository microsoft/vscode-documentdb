---
feature: pre-release-polish
kind: code-review
status: active
created: 2026-10-16
---

# Pre-release polish code review

## Scope

Reviewed the complete branch diff against `origin/main`, including the Marketplace README
artwork, migration documentation, Fluent UI appearance adjustments, migration menu icon, and
survey title wrapping.

The review checked behavior preservation, narrow-width layout, accessibility semantics,
documentation accuracy, localization safety, CSP compatibility, and packaged asset references.
No pull request existed during the review, so there were no GitHub Copilot comments to merge.

## Findings and author decisions

| ID  | Severity | Finding                                                                                                                                          | Decision and reasoning                                                                                                                                                                               |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Medium   | The migration manual removed the provider API preview and allowlist warning, but `getDocumentDBExtensionApi` still rejects unregistered clients. | Fixed. Keep the end-user feature title free of the experimental label, but explicitly document that the provider API remains experimental and restricted. This matches the implemented API boundary. |
| R2  | High     | The Marketplace README referenced an SVG, which causes `vsce package` to reject the extension.                                                   | Fixed. Use a theme-aware HTML `picture` with the existing light and dark PNG files, preserving theme switching in a VSIX-compatible form.                                                            |

No additional correctness or accessibility findings remained after validation.

The survey wrapping change is implemented in `cc1c8113`. Both review findings are fixed in
`c11f67d4`.

## Validation

- Survey title DOM test verifies that `for VS Code` is one non-wrapping span while the document
  title and accessible text remain unchanged.
- Browser layout checks at 448, 280, and 240 px verified that the suffix stays on one line, wraps
  after `DocumentDB` when needed, and does not overflow.
- The full Case 2 verification suite is recorded in the pull request description.
