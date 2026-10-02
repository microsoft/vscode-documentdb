/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// TEMPORARY (modernization Stage 2): mechanical Jest -> Vitest rewrite for unit-test files.
//
//   node build/test-migration/jest-to-vitest.mjs <test files...>
//
// Rewrites the files in place and prints, per file, every `jest.` reference it could not rewrite.
// Those (requireActual, requireMock, factories that read outer variables eagerly, ...) need the
// manual steps in the Stage 2 recipe. Adding the `import ... from 'vitest'` line is what moves a
// file from Jest to Vitest (see build/test-migration/runnerRouting.cjs). Delete this script when
// Jest is removed.

import { readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';

/** `jest.<name>` calls that have a same-named `vi.<name>` equivalent. */
const SAME_NAME_CALLS = [
    'advanceTimersByTime',
    'advanceTimersByTimeAsync',
    'advanceTimersToNextTimer',
    'advanceTimersToNextTimerAsync',
    'clearAllMocks',
    'clearAllTimers',
    'doMock',
    'dontMock',
    'fn',
    'getTimerCount',
    'isMockFunction',
    'mock',
    'mocked',
    'resetAllMocks',
    'resetModules',
    'restoreAllMocks',
    'runAllTicks',
    'runAllTimers',
    'runAllTimersAsync',
    'runOnlyPendingTimers',
    'runOnlyPendingTimersAsync',
    'setSystemTime',
    'spyOn',
    'unmock',
    'useFakeTimers',
    'useRealTimers',
];

/** `jest.<Type>` type references and their Vitest type exports. */
const TYPE_RENAMES = {
    Mock: 'Mock',
    Mocked: 'Mocked',
    MockedClass: 'MockedClass',
    MockedFunction: 'MockedFunction',
    MockedObject: 'MockedObject',
    MockInstance: 'MockInstance',
    SpyInstance: 'MockInstance',
};

const RUNTIME_GLOBALS = ['describe', 'it', 'test', 'expect', 'beforeAll', 'beforeEach', 'afterAll', 'afterEach'];

const LICENSE_HEADER = /^\/\*-{5,}[\s\S]*?-{5,}\*\/\r?\n/;

/**
 * @param {string} file
 * @param {string} source
 * @returns {{ output: string, leftovers: string[] }}
 */
export function convert(file, source) {
    let code = source;

    // Explicit `@jest/globals` imports are replaced by the computed `vitest` import below.
    code = code.replace(/^import\s*\{[^}]*\}\s*from\s*['"]@jest\/globals['"];?[ \t]*\r?\n/gm, '');

    // A bare `jest.mock('vscode')` only selected the manual mock; Vitest aliases `vscode` to it.
    code = code.replace(/^[ \t]*jest\.mock\((['"])vscode\1\);?[ \t]*\r?\n/gm, '');

    for (const name of SAME_NAME_CALLS) {
        // `\s*` around the dot also matches Prettier-wrapped chains such as `jest\n    .fn()`.
        code = code.replace(new RegExp(`\\bjest(\\s*)\\.(\\s*)${name}\\b(?=\\s*[(<])`, 'g'), `vi$1.$2${name}`);
    }

    const usedTypes = new Set();
    for (const [jestType, vitestType] of Object.entries(TYPE_RENAMES)) {
        const pattern = new RegExp(`\\bjest\\.${jestType}\\b(?!\\s*\\()`, 'g');
        if (pattern.test(code)) {
            code = code.replace(pattern, vitestType);
            usedTypes.add(vitestType);
        }
    }

    const free = freeIdentifiers(file, code);
    const runtime = [...RUNTIME_GLOBALS, 'vi'].filter((name) => free.has(name));
    const specifiers = [...runtime, ...[...usedTypes].map((name) => `type ${name}`)];

    if (!/\bfrom\s+['"]vitest['"]/.test(code)) {
        const importLine = `import { ${specifiers.join(', ')} } from 'vitest';\n`;
        const header = LICENSE_HEADER.exec(code);
        const insertAt = header ? header[0].length : 0;
        const docblock = needsJsdom(file, code) ? '\n// @vitest-environment jsdom\n' : '';
        code = `${code.slice(0, insertAt)}${docblock}\n${importLine}${code.slice(insertAt).replace(/^\r?\n/, '\n')}`;
    }

    const leftovers = [];
    code.split(/\r?\n/).forEach((line, index) => {
        // Jest honours `@jest-environment` only in the file's first comment; Vitest honours it anywhere.
        if (/(^|[^@\w$-])jest\b(?![-\w])/.test(line) || /@jest-environment\b/.test(line)) {
            leftovers.push(`${file}:${index + 1}: ${line.trim()}`);
        }
    });
    return { output: code, leftovers };
}

/**
 * Names used as free identifiers (not property names, declarations or type positions).
 *
 * @returns {Set<string>}
 */
function freeIdentifiers(file, code) {
    const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, kind);
    const names = new Set();
    const visit = (node) => {
        if (ts.isIdentifier(node)) {
            const parent = node.parent;
            const isPropertyName =
                (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
                (ts.isPropertyAssignment(parent) && parent.name === node) ||
                (ts.isMethodDeclaration(parent) && parent.name === node) ||
                (ts.isPropertyDeclaration(parent) && parent.name === node) ||
                (ts.isQualifiedName(parent) && parent.right === node);
            if (!isPropertyName) {
                names.add(node.text);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return names;
}

/** The former Jest `extension-webview` project (jsdom) matched `src/webviews/**\/*.test.tsx`. */
function needsJsdom(file, code) {
    const normalized = file.split('\\').join('/');
    return (
        /(^|\/)src\/webviews\/.*\.test\.tsx$/.test(normalized) &&
        !/@vitest-environment\s/.test(code) &&
        !normalized.includes('packages/')
    );
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const files = process.argv.slice(2);
    if (files.length === 0) {
        console.error('usage: node build/test-migration/jest-to-vitest.mjs <test files...>');
        process.exit(2);
    }
    let pending = 0;
    for (const file of files) {
        const { output, leftovers } = convert(file, readFileSync(file, 'utf8'));
        writeFileSync(file, output);
        for (const leftover of leftovers) {
            console.log(`MANUAL ${leftover}`);
            pending++;
        }
    }
    console.log(`converted ${files.length} file(s); ${pending} jest reference(s) need manual conversion`);
}
