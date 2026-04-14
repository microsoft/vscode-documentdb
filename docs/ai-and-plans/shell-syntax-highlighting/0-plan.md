# Interactive Shell — Input Syntax Highlighting

## Goal

Add real-time syntax highlighting to the interactive shell's input line. As the user types a command like `db.users.find({ age: { $gt: 25 } })`, the terminal renders keywords, strings, numbers, operators, BSON constructors, and `$`-prefixed query operators in distinct colors — exactly like the output formatter already colorizes result values.

## Approach: Monarch Tokenizer Extraction

Reuse the same JavaScript Monarch tokenizer rules that the query editors already use (via `registerDocumentDBQueryLanguage` in `src/webviews/query-language-support/registerLanguage.ts`), but run them in the extension host (Node.js) instead of in a Monaco Editor. This requires:

1. **A vendored copy of the Monarch tokenizer rules** — the JS keyword lists, regex patterns, and state machine transitions extracted from `monaco-editor/esm/vs/basic-languages/typescript/typescript.js` + `javascript/javascript.js`. Extended with DocumentDB-specific token categories.
2. **A lightweight Monarch state-machine executor** — runs the tokenizer rules against a plain string and returns token spans with their types, without any Monaco or DOM dependency.
3. **A token-to-ANSI mapper** — converts Monarch token types (`keyword`, `string`, `number`, `comment`, `identifier`, etc.) plus custom DocumentDB types to ANSI 16-color escape sequences.
4. **A line re-rendering function in `ShellInputHandler`** — replaces the current per-character echo approach; on every buffer mutation, rewrites the full line with ANSI colors and repositions the cursor.

### Why This Approach

- **Zero new dependencies** — no `emphasize`, `lowlight`, or `highlight.js` added to the bundle.
- **Proven edge-case handling** — the Monarch JS tokenizer correctly handles regex literal disambiguation, template literal interpolation, numeric formats (hex/octal/binary), and escape sequences. The extension's query editors already rely on these exact rules.
- **Native DocumentDB awareness** — BSON constructors, `$`-prefixed operators, and shell commands are added as first-class token categories in the rule set, not bolted on via post-processing.
- **Architectural consistency** — the query editor surface and the shell surface share the same token classification rules, producing visually consistent highlighting.

---

## File Plan

All new files go under `src/documentdb/shell/highlighting/`:

```
src/documentdb/shell/highlighting/
├── monarchRules.ts           # WI-1: Vendored + extended tokenizer rules
├── monarchRunner.ts          # WI-2: State-machine executor
├── tokenColorizer.ts         # WI-3: Token-to-ANSI mapper
├── monarchRunner.test.ts     # WI-2 tests
├── tokenColorizer.test.ts    # WI-3 tests
└── shellHighlighter.test.ts  # WI-4 integrated tests
```

Modified files:

- `src/documentdb/shell/ShellInputHandler.ts` — WI-4: re-rendering infrastructure
- `src/documentdb/shell/ShellInputHandler.test.ts` — WI-4: updated tests

---

## Work Items

### WI-1: Vendored Monarch Rules (`monarchRules.ts`) — ✅ DONE

**Goal:** Create a standalone copy of the JavaScript Monarch tokenizer rules, extended with DocumentDB-specific token categories. No runtime dependency on `monaco-editor`.

**Source material:** The tokenizer rules live in two files in `node_modules/monaco-editor/esm/vs/basic-languages/`:

- `typescript/typescript.ts` — contains the actual `tokenizer` state machine (states: `root`, `common`, `whitespace`, `comment`, `jsdoc`, `regexp`, `regexrange`, `string_double`, `string_single`, `string_backtick`, `bracketCounting`), plus named regex patterns (`symbols`, `escapes`, `digits`, `octaldigits`, `binarydigits`, `hexdigits`, `regexpctl`, `regexpesc`), and the `operators` list.
- `javascript/javascript.ts` — overrides `keywords` (removes TypeScript-only keywords like `interface`, `enum`, `declare`, etc.) and `typeKeywords` (empty array). Everything else delegates to the TypeScript rules.

**What to extract:** The combined JavaScript variant of the rules — the JS `keywords` list + the TS tokenizer/patterns/operators. This produces the self-contained data structure the executor needs.

**DocumentDB extensions — add these custom token categories:**

1. **BSON constructors** — A `bsonConstructors` string array:

   ```
   ObjectId, ISODate, NumberLong, NumberInt, NumberDecimal,
   BinData, UUID, Timestamp, MinKey, MaxKey
   ```

   These names come from `packages/documentdb-constants/src/bsonConstructors.ts`.
   In the `common` state, the existing `[/[A-Z][\w\$]*/, "type.identifier"]` rule already matches these PascalCase names. Add a `cases` branch that checks `@bsonConstructors` and emits `"bson.constructor"` instead of `"type.identifier"`.

2. **Shell commands** — A `shellCommands` string array: `["show", "use", "it", "exit", "quit", "cls", "clear", "help"]`. Add a `cases` branch in the lowercase identifier rule (`/#?[a-z_$][\w$]*/`) so `@shellCommands -> "shell.command"` is checked before `@keywords`.

3. **`$`-prefixed operators** — Add a new rule before the general identifier rule:
   ```
   [/\$[a-zA-Z_]\w*/, "documentdb.operator"]
   ```
   This matches `$gt`, `$match`, `$lookup`, etc. It fires before the general identifier rule because Monarch rules are matched in order.

**Output shape:**

```typescript
export interface MonarchLanguageRules {
  keywords: string[];
  bsonConstructors: string[];
  shellCommands: string[];
  operators: string[];
  symbols: RegExp;
  escapes: RegExp;
  digits: RegExp;
  octaldigits: RegExp;
  binarydigits: RegExp;
  hexdigits: RegExp;
  regexpctl: RegExp;
  regexpesc: RegExp;
  tokenizer: Record<string, MonarchRule[]>;
}
```

Each `MonarchRule` is one of:

- `[RegExp, string]` — match regex, emit token type
- `[RegExp, { cases: Record<string, string> }]` — match regex, emit based on case lookup
- `[RegExp, string, string]` — match regex, emit token, push state
- `[RegExp, { token: string, next: string }]` — match regex, emit token, push/pop state
- `[RegExp, string[]]` — match regex, emit array of tokens (one per capture group)
- `{ include: string }` — include another state's rules

> **DEVIATION (WI-1 — Rule Types):** The `MonarchRule` type uses **named properties** (`{ regex, action }`, `{ regex, actionCases }`, `{ regex, actionByGroup }`, `{ include }`) instead of positional tuples (`[RegExp, string]`). This makes the executor's pattern-matching simpler and produces self-documenting code.
>
> **Alternatives analyzed:**
> 1. **Tuple arrays (as planned):** Pro: closer to Monaco's internal format. Con: requires index-based discrimination (`rule.length === 2` vs `3`) which is brittle. Con: `[RegExp, string | { cases } | string[]]` union is hard to narrow.
> 2. **Named properties (chosen):** Pro: explicit `'actionCases' in rule` checks. Pro: easier to read and maintain. Con: slightly more verbose than tuple literals.
> 3. **Tagged union with `kind` discriminant:** Pro: perfect type narrowing. Con: over-engineering; `'field' in obj` checks work fine for 4 variants.

**Important:** All regex patterns from the Monaco source use `@name` references (e.g., `@digits`, `@escapes`). The executor (WI-2) must resolve these at init time by replacing `@name` in the pattern source with the corresponding regex source string before compiling.

> **DEVIATION (WI-1):** Instead of keeping `@name` references in regex source strings and resolving them in the executor, all regex patterns were **inlined directly** in `monarchRules.ts`. For example, `/(@digits)[eE]([\-+]?(@digits))?/` became `/(\d+(_+\d+)*)[eE]([\-+]?(\d+(_+\d+)*))?/`. Patterns like `escapes`, `regexpctl`, `regexpesc` are used as standalone `RegExp` objects directly in string/regexp state rules.
>
> **Reasoning:** Eliminates the need for regex source string manipulation in the executor — the most error-prone step.
>
> **Alternatives analyzed:**
> 1. **Keep `@name` references (as planned):**
>    - Pro: Faithful to Monaco Monarch format; easier to diff against upstream.
>    - Pro: Single source of truth for named patterns.
>    - Con: Requires non-trivial regex-source-string replacement at init time (string→RegExp→string round-trip is fragile).
> 2. **Inline patterns (chosen):**
>    - Pro: Simpler executor — no resolution step, fewer moving parts.
>    - Pro: Direct `RegExp` objects avoid regex compilation bugs from malformed source splicing.
>    - Con: Patterns are duplicated (but they're constants that never change).
> 3. **Build a pre-compilation step that resolves at build time:**
>    - Pro: Best of both worlds — faithful source and no runtime cost.
>    - Con: Adds a build-time dependency and makes the code harder to understand.
>    - Con: Over-engineering for a set of fixed patterns.

**Licensing:** The Monaco Editor source is MIT-licensed. Include the Monaco license header in the file comment.

---

### WI-2: Monarch State-Machine Executor (`monarchRunner.ts`)

**Goal:** A function that takes a string and the `MonarchLanguageRules`, runs the tokenizer state machine, and returns an array of `(startOffset, endOffset, tokenType)` spans.

**API:**

```typescript
export interface TokenSpan {
  start: number;
  end: number;
  type: string; // e.g., "keyword", "string", "number", "bson.constructor", etc.
}

export function tokenize(input: string, rules: MonarchLanguageRules): TokenSpan[];
```

**How Monarch tokenizer rules work (simplified for our needs):**

The tokenizer is a set of named **states** (e.g., `"root"`, `"common"`, `"string_double"`). Each state is an ordered array of rules. Processing starts in state `"root"`.

At each position in the input:

1. Try each rule in the current state, in order.
2. If a rule's regex matches at the current position (anchored via `lastIndex`), consume the matched text and emit the token type.
3. If the rule has a `next` action:
   - `"@pop"` — pop the state stack (return to parent state).
   - `"@stateName"` — push `stateName` onto the state stack and transition.
   - Just a state name string — same as `@stateName`.
4. If the rule is `{ include: "@stateName" }`, splice that state's rules into the current position (or just recurse).
5. If no rule matches, consume one character with the `defaultToken` type (`"invalid"`) and stay in the current state. This prevents infinite loops.

**`@name` regex resolution:**

Before running, preprocess all regex patterns in the tokenizer rules. For any `@name` reference in a regex source (e.g., `(@digits)` in `/(@digits)[eE]/`), replace `@name` with the source of the corresponding named pattern from the rules object. Then compile the final regex. Cache the compiled regexes — they don't change between calls.

**`cases` resolution:**

When a rule has `cases: { "@keywords": "keyword", "@default": "identifier" }`, the executor must:

1. Look up the matched text in the array named by the `@`-prefixed key (e.g., check if the matched text is in `rules.keywords`).
2. If found, use that token type.
3. Otherwise, use `@default`.

**State stack:** Use a simple array. Max depth: 32 (guard against infinite recursion from malformed rules or adversarial input).

**Performance requirements:**

- The function is called on every keystroke for the current line buffer (typically 1–200 characters).
- Target: < 0.5ms for a 200-character line. The Monarch rules are pre-compiled regexes, so this is straightforward — no allocation-heavy parsing.
- Memoize the previous (input, result) pair. If the input hasn't changed (cursor-only movements), return the cached result.

**Edge cases to handle:**

- Empty input → return empty array.
- Input that is entirely inside a string or comment (e.g., an unterminated `"hello`) → the tokenizer state stack will be non-empty at the end, but that is expected and correct.
- The executor does NOT need to persist state across lines. Each call is stateless (the shell is a single-line input; multi-line mode is accumulated in `_multiLineBuffer` and each line is highlighted independently).

**Tests (`monarchRunner.test.ts`):**

Write tests for these categories, using a `describe('MonarchRunner', ...)` block:

| Category                 | Example Input                      | Expected Tokens                                                                       |
| ------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------- |
| Keywords                 | `const x = 1`                      | `keyword("const"), identifier("x"), delimiter("="), number("1")`                      |
| Strings                  | `"hello world"`                    | `string('"hello world"')`                                                             |
| Single-quoted strings    | `'hello'`                          | `string("'hello'")`                                                                   |
| Template literals        | `` `hello ${name}` ``              | `string, delimiter.bracket, identifier, delimiter.bracket, string`                    |
| Numbers (int)            | `42`                               | `number("42")`                                                                        |
| Numbers (float)          | `3.14`                             | `number.float("3.14")`                                                                |
| Numbers (hex)            | `0xFF`                             | `number.hex("0xFF")`                                                                  |
| Comments (line)          | `// a comment`                     | `comment("// a comment")`                                                             |
| Comments (block)         | `/* block */`                      | `comment("/* block */")`                                                              |
| Regex literals           | `/^hello/i`                        | `regexp("/^hello/"), keyword.other("i")`                                              |
| BSON constructors        | `ObjectId("abc")`                  | `bson.constructor("ObjectId"), ...`                                                   |
| DocumentDB API operators | `{ $gt: 5 }`                       | `delimiter.bracket, documentdb.operator("$gt"), delimiter, number, delimiter.bracket` |
| Shell commands           | `show dbs`                         | `shell.command("show"), identifier("dbs")`                                            |
| Mixed                    | `db.users.find({ name: "alice" })` | Each token classified correctly                                                       |
| Empty input              | `""`                               | `[]`                                                                                  |

---

### WI-3: Token-to-ANSI Mapper (`tokenColorizer.ts`)

**Goal:** Convert an array of `TokenSpan` and the original input string into an ANSI-colorized string suitable for writing to the terminal via `Pseudoterminal.onDidWrite`.

**API:**

```typescript
export function colorizeInput(input: string, tokens: TokenSpan[]): string;
```

**Color mapping:**

Use the same ANSI 16-color palette already established by `ShellOutputFormatter` (see `src/documentdb/shell/ShellOutputFormatter.ts`). These colors respect the user's terminal theme via VS Code's `terminal.ansi*` theme colors.

| Token Type                                                                  | ANSI Code  | Color   | Rationale                               |
| --------------------------------------------------------------------------- | ---------- | ------- | --------------------------------------- |
| `keyword`                                                                   | `\x1b[36m` | Cyan    | Matches JS keyword convention           |
| `string`                                                                    | `\x1b[32m` | Green   | Matches output formatter's string color |
| `string.escape`                                                             | `\x1b[33m` | Yellow  | Escape sequences stand out              |
| `string.invalid`                                                            | `\x1b[31m` | Red     | Unterminated strings                    |
| `number` / `number.float` / `number.hex` / `number.octal` / `number.binary` | `\x1b[33m` | Yellow  | Matches output formatter's number color |
| `comment` / `comment.doc`                                                   | `\x1b[90m` | Gray    | Subdued                                 |
| `regexp`                                                                    | `\x1b[31m` | Red     | Distinct from strings                   |
| `bson.constructor`                                                          | `\x1b[36m` | Cyan    | Highlighted as built-in constructors    |
| `documentdb.operator`                                                       | `\x1b[33m` | Yellow  | Stand out within query objects          |
| `shell.command`                                                             | `\x1b[35m` | Magenta | Visually distinct from JS keywords      |
| `type.identifier`                                                           | (no color) | Default | PascalCase identifiers (non-BSON)       |
| `identifier`                                                                | (no color) | Default | Regular identifiers                     |
| `delimiter` / `delimiter.bracket`                                           | (no color) | Default | Punctuation                             |
| (all others / `invalid`)                                                    | (no color) | Default | Don't colorize unknown tokens           |

The function builds the output string by iterating tokens in order:

1. For each token, if the token type has a color, emit `{colorCode}{text}\x1b[0m`.
2. If the token type has no color, emit the raw text.
3. If there are gaps between tokens (shouldn't happen with a correct tokenizer, but guard defensively), emit the gap text uncolored.

**ANSI reset:** Every colored span must be followed by `\x1b[0m` (reset) so colors don't bleed into adjacent tokens. This is cheap (4 bytes per colored token) and prevents visual corruption.

**Tests (`tokenColorizer.test.ts`):**

| Test                                | Input                          | Assertion                                 |
| ----------------------------------- | ------------------------------ | ----------------------------------------- |
| Keywords get cyan                   | `const` as keyword token       | Output contains `\x1b[36mconst\x1b[0m`    |
| Strings get green                   | `"hello"` as string token      | Output contains `\x1b[32m"hello"\x1b[0m`  |
| Numbers get yellow                  | `42` as number token           | Output contains `\x1b[33m42\x1b[0m`       |
| Identifiers uncolored               | `foo` as identifier token      | Output is `foo` (no ANSI)                 |
| BSON constructors get cyan          | `ObjectId` as bson.constructor | Output contains `\x1b[36mObjectId\x1b[0m` |
| Shell commands get magenta          | `show` as shell.command        | Output contains `\x1b[35mshow\x1b[0m`     |
| DocumentDB API operators get yellow | `$gt` as documentdb.operator   | Output contains `\x1b[33m$gt\x1b[0m`      |
| Empty input                         | `""`                           | Output is `""`                            |
| Full line integration               | `db.users.find({ $gt: 1 })`    | Correct colors for each token             |

---

### WI-4: ShellInputHandler Re-Rendering (`ShellInputHandler.ts` modifications)

**Goal:** Replace the current per-character echo approach with full-line re-rendering so syntax highlighting applies on every buffer mutation.

#### 4a. Add highlighting dependency

Add an optional `colorize` callback to `ShellInputHandlerCallbacks`:

```typescript
export interface ShellInputHandlerCallbacks {
  write: (data: string) => void;
  onLine: (line: string) => void;
  onInterrupt: () => void;
  onContinuation: () => void;
  /** Optional: colorize the input buffer for syntax highlighting. */
  colorize?: (input: string) => string;
}
```

When `colorize` is not provided (or returns the input unchanged), behavior is identical to today — no highlighting. This preserves backward compatibility and makes testing easier.

#### 4b. Add `reRenderLine()` method

This is the core rendering function. It replaces the current approach where each editing method (`insertCharacter`, `handleBackspace`, `clearBeforeCursor`, `deleteWordBeforeCursor`, `handleDelete`, `clearAfterCursor`, `replaceLineWith`) independently writes ANSI sequences to echo its specific change.

```
reRenderLine():
  1. Move cursor to column 0 of the input area (column = prompt width).
     → write `\r` + `\x1b[{promptWidth}C` (or just `\r` + prompt-width spaces)
     Actually, since we don't re-render the prompt, the simplest approach is:
     → Move cursor left by `_cursor` positions to reach input start: `\x1b[{_cursor}D`
     But _cursor may be 0 (e.g., after clearBeforeCursor). Instead:
     → Use `\r` (carriage return to column 0) + `\x1b[{promptWidth}C` (move right past prompt).
  2. Write the colorized buffer:
     → if `colorize` callback exists: `colorize(_buffer)`
     → else: `_buffer`
  3. Erase any leftover characters from the previous (longer) buffer:
     → write `\x1b[K` (erase from cursor to end of line)
  4. Reposition cursor to the correct position:
     → The colorized string contains ANSI escape codes (zero-width), so the
        visual cursor is now at `_buffer.length` (the end of the input text).
     → Move it back by `(_buffer.length - _cursor)` positions if cursor is
        not at the end.
     → `\x1b[{_buffer.length - _cursor}D`
```

**`_promptWidth` field:** Add a `_promptWidth: number` field to `ShellInputHandler`. The existing `setPromptWidth(width)` method (currently a no-op reserved for future use) stores this value. `DocumentDBShellPty` must call `setPromptWidth()` with the visual width of the prompt string (e.g., `"mydb> ".length`) before showing each prompt.

#### 4c. Rewire all buffer mutation methods

Replace the manual ANSI echo logic in each method with a call to `reRenderLine()`:

| Method                     | Current behavior                                   | New behavior                                          |
| -------------------------- | -------------------------------------------------- | ----------------------------------------------------- |
| `insertCharacter(ch)`      | Writes `ch + after + backspaces`                   | Update `_buffer` and `_cursor`, then `reRenderLine()` |
| `handleBackspace()`        | Writes `\b + after + space + backspaces`           | Update `_buffer` and `_cursor`, then `reRenderLine()` |
| `handleDelete()`           | Writes `after + space + backspaces`                | Update `_buffer` and `_cursor`, then `reRenderLine()` |
| `clearBeforeCursor()`      | Writes cursor-left + after + spaces + backspaces   | Update `_buffer` and `_cursor`, then `reRenderLine()` |
| `clearAfterCursor()`       | Writes `ERASE_TO_EOL`                              | Update `_buffer`, then `reRenderLine()`               |
| `deleteWordBeforeCursor()` | Writes cursor-left + after + spaces + backspaces   | Update `_buffer` and `_cursor`, then `reRenderLine()` |
| `replaceLineWith(newText)` | Writes cursor-left + newText + spaces + backspaces | Update `_buffer` and `_cursor`, then `reRenderLine()` |

Each method becomes simpler: just do the buffer/cursor mutation logic, then call `reRenderLine()`. All ANSI complexity is centralized in one place.

**Cursor-only movement (`moveCursorLeft`, `moveCursorRight`, `moveCursorTo`, `wordLeft`, `wordRight`):** These do NOT call `reRenderLine()`. They update `_cursor` and write cursor-movement ANSI sequences directly, as they do today. No buffer content changes → no re-tokenization needed.

#### 4d. Wire up in `DocumentDBShellPty`

In `DocumentDBShellPty`'s constructor (where the `ShellInputHandler` is created), provide the `colorize` callback:

```typescript
import { tokenize } from './highlighting/monarchRunner';
import { colorizeInput } from './highlighting/tokenColorizer';
import { shellLanguageRules } from './highlighting/monarchRules';

// In constructor:
this._inputHandler = new ShellInputHandler({
  write: (data: string) => this._writeEmitter.fire(data),
  onLine: (line: string) => void this.handleLineInput(line),
  onInterrupt: () => this.handleInterrupt(),
  onContinuation: () => this.showContinuationPrompt(),
  colorize: (input: string) => {
    if (!this.isColorEnabled()) {
      return input;
    }
    const tokens = tokenize(input, shellLanguageRules);
    return colorizeInput(input, tokens);
  },
});
```

Also wire up `setPromptWidth()`:

In the `showPrompt()` method (and `showContinuationPrompt()`), after writing the prompt string, call:

```typescript
this._inputHandler.setPromptWidth(promptString.length);
```

The prompt string is currently something like `"mydb> "` — its visual width (without ANSI codes) must be measured.

#### 4e. Update existing tests

The `ShellInputHandler.test.ts` tests assert on exact `write()` output. With the re-rendering approach, the output format changes from incremental character echoes to full-line rewrites.

**Strategy:** Add the `colorize` callback in a subset of tests to verify highlighting works. For existing tests that don't care about highlighting, pass no `colorize` callback — they should continue passing with updated output assertions that match the `reRenderLine()` sequence instead of the old per-character echo.

**New integrated test file (`shellHighlighter.test.ts`):**

End-to-end tests that create a `ShellInputHandler` with the real highlighting pipeline and verify that typing sequences produce correctly colorized output:

| Test                      | Action                               | Assertion                                                                                                                  |
| ------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Typing a keyword          | Type `c`, `o`, `n`, `s`, `t`         | After each keystroke, the re-rendered line shows the partial input. After `t`, "const" is highlighted as a keyword (cyan). |
| Typing a string           | Type `"`, `h`, `i`, `"`              | After `"`, the `"` is in string color. After `"hi"` is complete, the entire string is green.                               |
| Typing a BSON constructor | Type `O`, `b`, `j`, ... `d`          | After completing "ObjectId", the word shows as a BSON constructor (cyan).                                                  |
| Backspace mid-word        | Type `const`, backspace 2, type `le` | Result: `conle`, no keyword highlighting (it's not a keyword).                                                             |
| History recall            | Type `db.find()`, Enter, Up arrow    | The recalled line is re-rendered with highlighting.                                                                        |
| Clear line (Ctrl+U)       | Type `db.find()`, Ctrl+U             | Line is empty, no highlighting output.                                                                                     |

---

## Implementation Sequence

```
WI-1 (monarchRules.ts)
  ↓
WI-2 (monarchRunner.ts + tests) — depends on WI-1
  ↓
WI-3 (tokenColorizer.ts + tests) — depends on WI-2 interface only
  ↓
WI-4 (ShellInputHandler changes + integration tests) — depends on WI-2 + WI-3
```

WI-1 and WI-3 can be developed in parallel since WI-3 only depends on the `TokenSpan` interface, not the actual rules.

---

## Completion Checklist

Before marking this feature complete:

- [ ] `npm run build` succeeds
- [ ] `npm run lint` passes
- [ ] `npm run prettier-fix` has been run
- [ ] All new files have the Microsoft copyright header
- [ ] All new tests pass
- [ ] Existing `ShellInputHandler.test.ts` tests pass (with updated assertions)
- [ ] Existing `DocumentDBShellPty.test.ts` tests pass
- [ ] No new `any` types
- [ ] No references to product names other than "DocumentDB" and "DocumentDB API" in code, comments, and test descriptions
- [ ] The `documentDB.shell.display.colorOutput` setting (already exists) gates highlighting — when `false`, the `colorize` callback returns the input unchanged
- [ ] Bundle size has not increased (no new dependencies)
