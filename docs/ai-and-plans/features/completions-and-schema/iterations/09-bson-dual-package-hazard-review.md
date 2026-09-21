---
feature: completions-and-schema
kind: review
status: active
prs: [933]
created: 2026-09-21
---

# PR #933 — Review and Resolutions

PR: https://github.com/microsoft/vscode-documentdb/pull/933
Branch: `dev/tnaum/schema-analyzer-bson-fix`
Iteration under review: [09-bson-dual-package-hazard.md](./09-bson-dual-package-hazard.md)
Focus: the `_bsontype` fallback added to `BSONTypes.inferType()`, and the timing change that came
with dropping `await import('bson')`.

Covers the GitHub Copilot reviewer's four comments plus an independent sweep. Severities are the
post-validation view — every finding was checked against the code, and every empirical claim
against the installed packages rather than taken on trust.

## Severity scale

- **Critical**: data loss or corruption on a broad supported path, with no practical recovery.
- **High**: user-visible wrong answers on a supported path, or a silent failure with no signal.
- **Medium**: correctness risk or a latent inconsistency that will produce wrong answers later.
- **Low**: maintainability, documentation, or an edge case with limited user impact.

## Verified before reviewing

The fix rests on empirical claims about packaging, so those were checked first:

| Claim                                         | Result                                                                                               |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `bson` ships split export conditions          | Confirmed — `bson@7.2.0` maps `import` → `bson.node.mjs`, `require` → `bson.cjs`                     |
| Static import resolves one copy               | Confirmed — one `bson` in `node_modules`; `require('mongodb').ObjectId === require('bson').ObjectId` |
| The 13 tag-map keys match reality             | Confirmed — every key equals the real `_bsontype` of a `bson@7.2.0` instance                         |
| `_bsontype` is inherited, not an own property | Confirmed — so the `foreign()` test helper models real instances faithfully                          |
| No dynamic `bson` import remains              | Confirmed — all three call sites are static                                                          |

Diagnosis and fix are sound. Everything below is refinement.

---

## Findings from the Copilot reviewer

### Low — `bsonTypeTagMap` accepted inherited `Object.prototype` members

_Reviewer comment on `packages/documentdb-js-schema-analyzer/src/BSONTypes.ts`:_
[comment](https://github.com/microsoft/vscode-documentdb/pull/933#discussion_r4050878049) ·
[reply](https://github.com/microsoft/vscode-documentdb/pull/933#discussion_r4060932309)

Valid, and mechanically exact. The tag comes from user data. With an object literal,
`_bsontype: '__proto__'` returned `Object.prototype` and `'constructor'` returned a function; both
survived the `=== undefined` guard, were emitted as `x-bsonType`, and then matched neither `Object`
nor `Array` in the `SchemaAnalyzer` switch, so that subtree stopped being traversed.

Reachability is very low — it needs a document field literally named `_bsontype` holding one of
about twelve specific strings — but this is a published package at 1.0.0 and the fix is one line.

Options considered:

| Option                 | Trade-off                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `Map`                  | Own-key-only by construction; `get()` returns `BSONTypes \| undefined`, fixing the type too |
| `Object.create(null)`  | Smallest visual change, but the protection is invisible at the lookup site and easy to undo |
| `hasOwnProperty` guard | One line, but leaves the map a footgun for the next lookup someone adds                     |
| `switch` on the tag    | Structurally immune, but loses the map's value as documentation of what is supported        |

**Decision — `Map`.** [`9e86696e`](https://github.com/microsoft/vscode-documentdb/pull/933/commits/9e86696e9e6a7dfd5003b802220ab2c3165dd508)

It is the only option that fixes the bug _and_ the dishonest type: `Record<string, BSONTypes>` told
the compiler the lookup could never be `undefined`, which made the existing guard look like dead
code. A `Map` also cannot be silently undone by a later edit the way a null prototype can.

### Low — synchronous schema feeding now precedes the prompt

_Reviewer comment on `src/documentdb/shell/DocumentDBShellPty.ts`:_
[comment](https://github.com/microsoft/vscode-documentdb/pull/933#discussion_r4050878111) ·
[reply](https://github.com/microsoft/vscode-documentdb/pull/933#discussion_r4060933341)

The ordering claim is valid. `deserializeResultForSchema()` became synchronous, so it runs before
`handleLineInput()`'s `finally` re-enables input and draws the next prompt, where previously the
dynamic import deferred it past that point.

The impact assessment in the reviewer comment is overstated. `OutputFormatter.formatResult()`
already walks the same payload synchronously one line above, so the marginal cost is a second pass
over work already paid for once — not new exposure to large results.

The comment did, however, surface two things that were genuinely wrong:

- the call site still claimed the work "runs asynchronously after output is displayed" and is
  "non-blocking";
- iteration 09 justified the change with "`EJSON.parse` of at most 100 sampled documents". The
  100-document cap is applied by `feedResultToSchemaStore` **after** parsing; `EJSON.parse` walks
  the whole printable.

Options considered:

| Option                            | Trade-off                                                                                       |
| --------------------------------- | ----------------------------------------------------------------------------------------------- |
| Leave synchronous, fix the claims | Honest about the real cost; leaves the non-blocking contract weakened                           |
| `setTimeout(…, 0)`                | Restores the original ordering in one line, but needs a disposal guard and only moves the stall |
| `queueMicrotask`                  | **Does not work** — it runs before the promise-resolution continuation that reaches the prompt  |
| Cap the input by payload size     | Targets the real risk, but silently drops schema data for exactly the richest result sets       |
| Parse in the worker               | Removes the main-thread cost entirely; needs a schema-delta IPC message and its own design pass |

**Decision — keep it synchronous, correct both claims.**
[`a6d957b6`](https://github.com/microsoft/vscode-documentdb/pull/933/commits/a6d957b638a9d9df8c4b260e1bca7c5f13207e5d)

Deferring would buy a few milliseconds of perceived latency in exchange for a disposal guard and a
timing dependency that is awkward to test, while the formatter on the line above keeps the same
cost profile regardless. Moving the parse into the worker is the change that would actually matter;
it is recorded as future work rather than bolted on here.

### Low — the README claimed the fallback "degrades loudly"

_Reviewer comment on `docs/ai-and-plans/features/completions-and-schema/README.md`:_
[comment](https://github.com/microsoft/vscode-documentdb/pull/933#discussion_r4050878152) ·
[reply](https://github.com/microsoft/vscode-documentdb/pull/933#discussion_r4060934388)

Valid. Nothing is loud: the fallback classifies foreign wrappers correctly and emits no warning and
no telemetry. The wording implied an operational signal that does not exist, in an active design
document.

Options considered:

| Option                           | Trade-off                                                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Reword to match behavior         | One line, honest                                                                                                |
| Emit telemetry from the fallback | A real alarm, but inverts the package's dependency direction and the path is far too hot to instrument per call |
| Expose a counter, sample it      | Real signal at near-zero cost, but adds public API exactly at the stability commitment                          |

**Decision — reword.**
[`ee8abbb7`](https://github.com/microsoft/vscode-documentdb/pull/933/commits/ee8abbb738d8bc5e4fb08eea157e2816dff4ca55)

The bullet now also says what the fallback does _not_ cover: only `SchemaAnalyzer` is protected,
every other `instanceof` check in the extension still breaks, and the post-build chunk check is the
only real detector. The counter is recorded as future work — it is the cheapest version of the
alarm worth having, but it does not belong in the release that freezes the API.

### Low–Medium — the fallback was tested for six of thirteen tags

_Reviewer comment on `packages/documentdb-js-schema-analyzer/test/SchemaAnalyzer.foreignBson.test.ts`:_
[comment](https://github.com/microsoft/vscode-documentdb/pull/933#discussion_r4050878199) ·
[reply](https://github.com/microsoft/vscode-documentdb/pull/933#discussion_r4060935690)

Valid as regression protection. Worth noting that no key was actually wrong — every one was
verified against `bson@7.2.0` — so this is not a latent bug, but the map is the entire claim of the
1.0.0 release and a typo in an untested key would have shipped unnoticed.

**Decision — table-driven, both directions.**
[`78cdecfc`](https://github.com/microsoft/vscode-documentdb/pull/933/commits/78cdecfc4c3b25ce7a84a43de9040d4c8d3f93df)

New `test/BSONTypes.foreignTags.test.ts` covers every tag, both UUID subtypes, `Code` with and
without a scope, unsupported tags, and the prototype-member tags from the first finding. A second
table builds a foreign twin of each _real_ `bson` instance and asserts both inference paths return
the same type — which also fails if a future `bson` release renames a tag, something no
hand-written table can catch.

`MinKey`/`MaxKey` were added at the `getKnownFields()` level rather than only as unit cases: with
no own enumerable properties, misclassifying them made the fields _disappear_, and that is only
observable end to end.

A genuine cross-copy test — loading `bson.node.mjs` and `bson.cjs` side by side — was considered
and rejected: it needs ESM support in Jest and couples the suite to `bson`'s internal file layout.
That reproduction was run manually and is recorded in iteration 09.

---

## Additional findings (independent sweep)

### Low–Medium — binaries were classified by class in one path and by subtype in the other

Not raised by the reviewer. `UUID` extends `Binary` and carries `_bsontype: 'Binary'`, so the
subtype is the only discriminator the fallback has. The `instanceof` path classified by class
instead. The two therefore disagreed for a plain `new Binary(bytes, 4)`: `binary` locally, `uuid`
through the fallback — the same value getting two answers depending on which copy of `bson` created
it, which is precisely the failure mode this branch exists to remove. The new regression test
asserted the fallback's answer, which would have pinned the divergence in place as if intentional.

Options considered:

| Option                 | Trade-off                                                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Align on subtype       | One rule, one answer; changes `binary` → `uuid` for a plain `Binary` with subtype 3 or 4                                               |
| Align on class         | No local behavior change, but foreign UUIDs degrade to `binary` — a coarser answer caused by a bundler condition the caller cannot see |
| Document the asymmetry | Zero risk; ships a known case where one value has two type answers                                                                     |

**Decision — align on subtype.**
[`a20f2d81`](https://github.com/microsoft/vscode-documentdb/pull/933/commits/a20f2d819c1aca53419178c1978f4123c240d818)

Both paths route through `binaryTypeForSubType()`, so they cannot drift apart again. Subtype 4 _is_
a UUID per the BSON spec, so this is also the more correct reading. `UUID` instances always carry
subtype 4, so nothing that already reported `uuid` changes; only a plain `Binary` with subtype 3 or
4 moves. Recorded in the 1.0.0 changelog under `### Changed`, since `getKnownFields()` output
changes for those values.

### Low — `await import('mongodb')` is still present in the playground worker

`playgroundWorker.ts` lazy-imports the driver, and the driver re-exports the bson classes. Safe
today purely by accident of packaging: `mongodb@7.2.0` publishes no `exports` field, so every
resolution lands on `lib/index.js`. One `exports` map away from reintroducing the identical hazard
through the driver instead of through `bson`.

Options considered: document it; make it static (changes worker startup cost, deserves its own
measurement); or enforce it in the build.

**Decision — document it now, enforce it later.**
[`66b7b1ea`](https://github.com/microsoft/vscode-documentdb/pull/933/commits/66b7b1ea231e465f6c5072315e2220e5694918d6)

Written down at the call site and in the constraint section of iteration 09, with re-check points
on driver major upgrades and the ESM migration (#687). Build-time enforcement is recorded as future
work — and it is worth noting that a doc would _not_ have caught the original regression, which is
exactly why the enforcement item exists.

---

## Deferred to future work

Recorded in [future-work-schema-and-infrastructure.md](../future-work-schema-and-infrastructure.md):

- **Parse shell results in the worker** — removes the redundant stringify/parse round trip and the
  main-thread cost entirely. The real answer to the blocking question above.
- **A fallback counter for the dual-package hazard** — the cheapest honest alarm, deliberately held
  back from the release that commits to API stability.
- **Build-time assertion that no second `bson` copy is bundled** — promotes the manual `grep` from
  iteration 09 into something that cannot be forgotten. Note that `grep -c` exits non-zero on zero
  matches, so the check must be written as `! grep -q`.

## Verification

- `packages/documentdb-js-schema-analyzer`: `npm run build` clean; 125 tests across 5 suites pass.
- Extension: `npm run build` clean; shell and schema suites pass.
- `npx prettier --check` clean on every touched file.
