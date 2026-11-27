---
feature: data-grid
kind: review
status: draft
prs: [1142]
created: 2026-11-27
---

# Object `_id` field order and document identity

A dedicated review of how an object `_id` keeps its identity from the server to a document action,
split out of the [RDG migration review](./03-rdg-migration-review.md) (R1 deep dive) at the
operator's request. It adds R6 and R7 to that review's numbering. Both are pre-existing; #1142 did
not introduce them.

## Question and method

**Operator question:** in the past, an object `_id` whose fields came back in a different order
than stored broke equality. Is that still possible, what role does the driver play, should we add
a comparator, and does it also affect View Document?

**Method:** an offline experiment with the installed `bson` 7.2.0 (driver `mongodb` 7.2.0), a
source trace of every `_id` consumer, local history, #217 and #719,
microsoft/vscode-cosmosdb#2405 and microsoft/vscode-cosmosdb#2512, and upstream references. No
server was available (Docker was not running). Server matching is therefore taken from MongoDB's
documentation and not reproduced; DocumentDB's behavior was not verified.

## Findings

**Finding 1: the reorder is real; it comes from JavaScript, not from EJSON or the driver.** A JS
object always lists integer-like keys (canonical array indexes, `"0"` to `"4294967294"`) first,
in ascending order, and other keys after them in insertion order. The bson deserializer builds
plain objects, so an embedded `_id` stored as `{ b: 1, "1": 2 }` is read as `{ "1": 2, b: 1 }`.
Every later step serializes the reordered object faithfully: canonical EJSON (`toDocumentId`),
`parseDocumentId`, and the driver filter. The experiment serializes a stored document in exact key
order (via `Map`), deserializes it as the driver does, builds the action ID, and compares the
filter bytes with the stored `_id` bytes:

| Stored `_id` key order                    | Read back as                  | `toDocumentId` guard | Filter matches stored bytes |
| ----------------------------------------- | ----------------------------- | -------------------- | --------------------------- |
| `b, a`                                    | `b, a`                        | passes               | yes                         |
| `b, "1"`                                  | `"1", b`                      | passes               | **no**                      |
| `x: { b, "2" }` (nested)                  | `x: { "2", b }`               | passes               | **no**                      |
| `region, "2024"`                          | `"2024", region`              | passes               | **no**                      |
| `b, "01", "-1", "1.5", "4294967295"`      | unchanged                     | passes               | yes                         |
| `b, "4294967294"`                         | `"4294967294", b`             | passes               | **no**                      |

The round-trip guard (`documentIdentity.ts:49–54`) passes in every case, because the order is
already lost before it runs. js-bson has no option that preserves the order: `fieldsAsRaw` applies
only to arrays (`node_modules/bson/lib/bson.cjs:3317`), and `raw` returns every embedded document
as bytes. Upstream NODE-4508 (backlog) asks for `Map` deserialization: "array like keys are always
in numeric order".

**Finding 2: server matching is sensitive to field order but not to numeric type.** MongoDB's
documentation requires an exact match for embedded-document equality, "including the field order",
and compares numbers by value across numeric types. `{ b: 1, "1": 2 }` and `{ "1": 2, b: 1 }` are
therefore two distinct, valid `_id`s, and a filter built from the reordered object targets the
second. Numeric types are not a problem: the driver returns Int32, Double and safe Long values as
JS numbers, which still match by value. Longs above 2^53 change under relaxed parsing, so the
round-trip guard already withholds them (`documentIdentity.test.ts:34–43`).

**Finding 3: impact per action (R6).** It applies when an object `_id`, at any depth, has an
integer-like key that is not stored in JS order. This is pre-existing: `x-objectid` used the same
canonical stringify of the deserialized object since microsoft/vscode-cosmosdb#2405 (2024). This
PR does not introduce it, but its identity layer does not catch it either.

| Action           | Effect (source-traced; not reproduced against a server)                                                                                                                                                                                                                                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| View / Edit      | `findOne` (`ClustersClient.ts:1202–1211`) misses, and Document View receives `null`. If a sibling document whose `_id` has the JS order exists, the wrong document opens.                                                                                                                                                                    |
| Delete           | `deleteMany` matches nothing but returns `acknowledged` (`ClustersClient.ts:1190–1200`). `ClusterSession.deleteDocuments` removes the row from the cache, because it compares strings built from the same JS object (`ClusterSession.ts:337–344`), and the user sees "1 document has been deleted." (`collectionViewRouter.ts:375–381`): a wrong answer. If a sibling exists, the wrong document is deleted. |
| Save (Doc. View) | `EJSON.parse` of the editor text reorders the keys again, and `replaceOne(..., { upsert: true })` inserts a duplicate document with the reordered `_id`.                                                                                                                                                                                       |

**Finding 4: history.** No issue, PR or commit describes this bug. The closest match is a comment
removed in `017abf6a` (#719): "deep equality for _id is tricky as we'd have to consider embedded
objects, arrays, etc. For now, we'll just stringify the _id and compare the strings." That is
probably the unfinished comparator; its string compare is still at `ClusterSession.ts:337–344`.
In #719 a maintainer wrote that embedded-document keys "already round-tripped correctly", which
holds only for non-integer keys. `parseDocumentId.ts:26–28` claims that field order is preserved;
that is true of the EJSON text, but not of what the driver deserialized.

**Finding 5: a comparator would not help.** Every client-side comparison compares canonical
strings derived from the same deserialized objects, so they are consistent with each other. This
covers row keys and page-duplicate counting (`assignRowIdentities`), selection, and cache
subtraction. The order is lost before any comparison runs, and no comparator can recover it. An
order-insensitive comparator would be wrong: it would merge `_id`s that the server keeps
distinct, turning "not found" into a wrong-target risk. It would also never touch the server
filter, which is where the mismatch happens. Only bypassing plain-object deserialization (raw
bytes plus `Map`) preserves the order.

**Finding 6: Document View type fidelity (R7; adjacent, pre-existing, independent of `_id`
order).** Document View reads with relaxed `EJSON.stringify` (`documentsViewRouter.ts:67`) and
saves with relaxed `EJSON.parse` (`:81`). Combined with the driver's default promotion, it shows
a Long above 2^53 with a wrong value and changes types on save. In the offline round trip,
`small` Long 5 → Int32 5, `big` Long 9007199254740993 → Double 9007199254740992, and `dbl`
Double 1 → Int32 1; Int32 is unchanged. No tracked issue was found.

## R6 — Medium, pre-existing: object `_id` with integer-like keys targets the wrong bytes

**Options:**

- (a) Withhold actions: in `isSafeIdentityValue`, treat an object (at any depth) with more than
  one key, any of which matches `/^(0|[1-9]\d*)$/`, as unsafe. About 4 lines, plus tests: two
  withheld cases (`{ b: 1, "1": 2 }`, and one nested) and two that stay actionable (single key
  `{ "1": 2 }`, and `{ "01": 1, b: 2 }`). Pro: follows O3 fail-closed; rows stay browsable and
  selectable; removes both the wrong-target and the false "deleted" paths from the grid; tiny.
  Con: such documents cannot be viewed, edited or deleted from the grid (they were never reliable).
  It over-withholds when the stored order happens to equal the JS order, which cannot be detected
  after deserialization, and the regex also covers keys above the array-index limit for simplicity.
- (b) Exact identity from raw bytes: carry the `_id` as BSON bytes and rebuild filters with
  `Map`. Pro: exact for every shape. Con: touches the read path, `ClusterSession`,
  `parseDocumentId`, router contracts and Document View, whose own save path reorders again.
  Large for a rare shape; over-engineering.
- (c) An order-insensitive comparator. Con: semantically wrong (Finding 5) and never reaches the
  server filter. Rejected.
- (d) Won't fix. Con: a rare but possible wrong-document delete, and a false "deleted" message.

**Recommendation:** (a). Reporting `deletedCount` instead of `acknowledged` would make Delete
honest about any mismatch, but once (a) lands nothing in the grid reaches that path. Leave it as
a won't fix for this PR.

**Author decision and rationale:** **Approved (operator): (a), in #1142.** The grid withholds
View, Edit and Delete for these IDs. The operator wants users told why, with a link to a
manual page that explains the limitation; that is the follow-up
[#1144](https://github.com/microsoft/vscode-documentdb/issues/1144), not part of #1142.

## R7 — High, pre-existing, outside #1142: Document View changes numeric types on save

**Options:**

- (a) File a separate issue now and fix it outside this PR. The likely fix reads with
  `promoteValues: false` and keeps the type wrappers only where relaxed output would lose
  information (Long, Double with an integral value), so ordinary numbers stay readable.
- (b) Switch Document View to canonical EJSON in both directions. Pro: exact, about two lines
  plus the promote option. Con: every number becomes `{"$numberInt": "7"}` in the editor, a large
  UX change.
- (c) Won't fix. Con: silent type changes and a wrong displayed value for large Longs.

**Recommendation:** (a). The bug is real data corruption, but it predates the migration, does not
touch the grid, and should not grow #1142.

**Author decision and rationale:** **Approved (operator): (a).** Filed as
[#1145](https://github.com/microsoft/vscode-documentdb/issues/1145); no change in #1142.

## Effect on R1

R1 (a) is unchanged. The own-property check also avoids the `''` sentinel for `""`,
because `EJSON.stringify("")` is `'""'`. For `null`, `parseDocumentId("null")` yields `null`, and
the `replaceOne` filter `{ _id: null }` targets that document. A canonical stringify in
`saveDocument` would not add anything, because type loss there happens earlier, in the relaxed
`EJSON.parse` of the editor text (R7).

## Decisions

| Item       | Decision                                                                    | Where                                                                   |
| ---------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| R6         | (a) withhold View, Edit and Delete for these IDs                            | #1142                                                                   |
| R6 follow-up | Tell the user why actions are unavailable; link to a new manual page      | [#1144](https://github.com/microsoft/vscode-documentdb/issues/1144)     |
| R7         | (a) separate issue                                                          | [#1145](https://github.com/microsoft/vscode-documentdb/issues/1145)     |
| Comparator | Rejected: an order-insensitive comparator would merge distinct server IDs   | —                                                                       |
| `deletedCount` | Won't fix in #1142; nothing in the grid reaches that path once R6 lands | —                                                                       |

The operator approved these on 2026-11-27. They are also recorded in
[decisions.md](../decisions.md).

## Appendix A: experiment script and output

Run from the repository root (so `require('bson')` resolves to the installed `bson` 7.2.0) with
`node idorder.cjs`. It serializes a stored document in exact key order (via `Map`), deserializes it
as the driver does, builds the canonical ID that `toDocumentId` produces, applies the
`toDocumentId` round-trip guard, parses the ID as `parseDocumentId` does, and compares the
resulting filter bytes with the stored `_id` bytes.

```js
const { BSON, EJSON, Long, Double } = require('bson');

// Build stored BSON with an exact key order using Map (as another client/shell could store it).
function stored(idMap) { return BSON.serialize(new Map([['_id', idMap], ['v', 1]])); }
function keysOf(buf) { // walk top-level _id sub-document key order straight from the bytes
  const raw = BSON.deserialize(buf, { raw: false });
  return Object.keys(raw._id);
}
function bytesOfId(value) { return Buffer.from(BSON.serialize({ _id: value })).toString('hex'); }

function check(label, idMap) {
  const buf = stored(idMap);
  const storedIdHex = Buffer.from(BSON.serialize(new Map([['_id', idMap]]))).toString('hex');
  const doc = BSON.deserialize(buf);                       // what the driver hands us
  const canonical = EJSON.stringify(doc._id, { relaxed: false });   // what toDocumentId/x-objectid send
  const roundTrip = EJSON.stringify(EJSON.parse(canonical), { relaxed: false }) === canonical; // toDocumentId guard
  const parsed = EJSON.parse(canonical);                   // what parseDocumentId sends to the server
  console.log(`[${label}]`);
  console.log('  stored key order :', [...idMap.keys()].join(','));
  console.log('  driver JS order  :', Object.keys(doc._id).join(','));
  console.log('  canonical id     :', canonical);
  console.log('  toDocumentId round-trip guard passes:', roundTrip);
  console.log('  filter bytes == stored _id bytes   :', bytesOfId(parsed) === storedIdHex);
}

check('A non-integer keys', new Map([['b', 1], ['a', 2]]));
check('B integer-like key', new Map([['b', 1], ['1', 2]]));
check('C nested integer-like key', new Map([['x', new Map([['b', 1], ['2', 2]])]]));
check('D year-like key', new Map([['region', 'eu'], ['2024', 'q1']]));
check('E not array-index keys', new Map([['b', 1], ['01', 2], ['-1', 3], ['1.5', 4], ['4294967295', 5]]));
check('F max array-index key', new Map([['b', 1], ['4294967294', 2]]));

console.log('[G relaxed parse of canonical numerics]');
for (const v of [Long.fromNumber(5), new Double(1), Long.fromString('9007199254740993')]) {
  const c = EJSON.stringify(v, { relaxed: false });
  const p = EJSON.parse(c);
  console.log('  ', c, '-> relaxed parse ->', typeof p === 'object' ? p.constructor.name + ' ' + p.toString() : typeof p + ' ' + p,
    '| canonical again:', EJSON.stringify(p, { relaxed: false }));
}
```

Output:

```text
[A non-integer keys]
  stored key order : b,a
  driver JS order  : b,a
  canonical id     : {"b":{"$numberInt":"1"},"a":{"$numberInt":"2"}}
  toDocumentId round-trip guard passes: true
  filter bytes == stored _id bytes   : true
[B integer-like key]
  stored key order : b,1
  driver JS order  : 1,b
  canonical id     : {"1":{"$numberInt":"2"},"b":{"$numberInt":"1"}}
  toDocumentId round-trip guard passes: true
  filter bytes == stored _id bytes   : false
[C nested integer-like key]
  stored key order : x
  driver JS order  : x
  canonical id     : {"x":{"2":{"$numberInt":"2"},"b":{"$numberInt":"1"}}}
  toDocumentId round-trip guard passes: true
  filter bytes == stored _id bytes   : false
[D year-like key]
  stored key order : region,2024
  driver JS order  : 2024,region
  canonical id     : {"2024":"q1","region":"eu"}
  toDocumentId round-trip guard passes: true
  filter bytes == stored _id bytes   : false
[E not array-index keys]
  stored key order : b,01,-1,1.5,4294967295
  driver JS order  : b,01,-1,1.5,4294967295
  canonical id     : {"b":{"$numberInt":"1"},"01":{"$numberInt":"2"},"-1":{"$numberInt":"3"},"1.5":{"$numberInt":"4"},"4294967295":{"$numberInt":"5"}}
  toDocumentId round-trip guard passes: true
  filter bytes == stored _id bytes   : true
[F max array-index key]
  stored key order : b,4294967294
  driver JS order  : 4294967294,b
  canonical id     : {"4294967294":{"$numberInt":"2"},"b":{"$numberInt":"1"}}
  toDocumentId round-trip guard passes: true
  filter bytes == stored _id bytes   : false
[G relaxed parse of canonical numerics]
   {"$numberLong":"5"} -> relaxed parse -> number 5 | canonical again: {"$numberInt":"5"}
   {"$numberDouble":"1.0"} -> relaxed parse -> number 1 | canonical again: {"$numberInt":"1"}
   {"$numberLong":"9007199254740993"} -> relaxed parse -> number 9007199254740992 | canonical again: {"$numberLong":"9007199254740992"}
```

Case C prints only the top-level key `x`; the reorder is inside it, as the canonical ID shows.
