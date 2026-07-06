# testing

Shared test helpers. Ships no runtime code and is not part of any public entry
point.

Contents:

- `vscodeStub.ts`: a minimal stand-in for the `vscode` module so host-side units
  can run under the test environment without the real VS Code API.
