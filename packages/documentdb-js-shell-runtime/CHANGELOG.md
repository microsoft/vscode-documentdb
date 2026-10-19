# Changelog

## Unreleased

- The default `productName` is now `DocumentDB` (was `DocumentDB for VS Code`). It only appears on the OIDC browser sign-in page.

## 0.9.0

### Breaking changes

- **ESM-only.** The package declares `"type": "module"` and an `exports` map. The allowed entry points are `.` and `./package.json`. Deep imports into `dist/` are no longer allowed.
- **Node.js `>=22.18.0` required.** This is the `engines.node` floor. CommonJS consumers can still use `require()`: Node.js supports loading ESM from 20.19+ and 22.12+, and this package has no top-level `await`. That runtime support does not lower the package's Node.js requirement.
- **TypeScript (tested with 6.0.3).** Static imports from CommonJS-format `.ts` files fail with TS1479 under `module: node16` or `node18`. The same imports compile under `node20` and `nodenext`. Under `node16`, `await import()` inside an async function also compiles. Use that dynamic import or convert the consumer to ESM (`.mts` or `"type": "module"`).
