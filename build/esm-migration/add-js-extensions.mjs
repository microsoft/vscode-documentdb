/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Codemod for modernization Stage 3 (and later the extension host in Stage 5): adds the `.js`
// extension that NodeNext requires to every relative module specifier in TypeScript sources.
//
//   node build/esm-migration/add-js-extensions.mjs [--check] <dir-or-file>...
//
// Rewrites static imports and exports, `import type`, `import('…')` expressions and types, and the
// first argument of `vi.mock` / `vi.doMock` / `vi.unmock` / `vi.doUnmock` / `vi.importActual` /
// `vi.importMock`. `./foo` becomes `./foo.js` when `foo.ts`, `foo.tsx`, `foo.d.ts` or `foo.js`
// exists, and `./foo/index.js` when `foo` is a directory with an index file. Specifiers that already
// carry an extension are left alone. Anything it cannot resolve is printed as MANUAL and left as is.
// With `--check` nothing is written and the exit code is 1 if any file would change.

import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';

const VI_CALLS = new Set(['mock', 'doMock', 'unmock', 'doUnmock', 'importActual', 'importMock']);
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.d.ts', '.js', '.mjs', '.cjs', '.jsx'];
const KEEP_EXTENSION = /\.(?:[cm]?js|jsx|json|css|scss|sass|svg|png|ttf|html|md|txt)$/i;

const args = process.argv.slice(2);
const check = args.includes('--check');
const roots = args.filter((arg) => arg !== '--check');
if (roots.length === 0) {
    console.error('usage: add-js-extensions.mjs [--check] <dir-or-file>...');
    process.exit(2);
}

function collectFiles(target, out) {
    const stat = fs.statSync(target);
    if (stat.isFile()) {
        if (/\.(?:ts|tsx|mts|cts)$/.test(target)) out.push(target);
        return out;
    }
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        collectFiles(path.join(target, entry.name), out);
    }
    return out;
}

function isFile(candidate) {
    try {
        return fs.statSync(candidate).isFile();
    } catch {
        return false;
    }
}

function resolveSpecifier(fromFile, specifier) {
    const base = path.resolve(path.dirname(fromFile), specifier);
    for (const extension of SOURCE_EXTENSIONS) {
        if (isFile(base + extension)) return `${specifier}.js`;
    }
    for (const extension of SOURCE_EXTENSIONS) {
        if (isFile(path.join(base, `index${extension}`))) return `${specifier.replace(/\/$/, '')}/index.js`;
    }
    return undefined;
}

function specifierNodes(sourceFile) {
    const found = [];
    const visit = (node) => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
            found.push(node.moduleSpecifier);
        } else if (ts.isImportTypeNode(node)) {
            const argument = node.argument;
            if (ts.isLiteralTypeNode(argument) && ts.isStringLiteral(argument.literal)) found.push(argument.literal);
        } else if (ts.isCallExpression(node) && node.arguments.length > 0) {
            const callee = node.expression;
            const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
            const isViCall =
                ts.isPropertyAccessExpression(callee) &&
                ts.isIdentifier(callee.expression) &&
                callee.expression.text === 'vi' &&
                VI_CALLS.has(callee.name.text);
            if (isDynamicImport || isViCall) found.push(node.arguments[0]);
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return found.filter((node) => ts.isStringLiteralLike(node));
}

let changedFiles = 0;
let changedSpecifiers = 0;
let manual = 0;
for (const root of roots) {
    for (const file of collectFiles(path.resolve(root), [])) {
        const text = fs.readFileSync(file, 'utf8');
        const kind = file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
        const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
        const edits = [];
        for (const node of specifierNodes(sourceFile)) {
            const specifier = node.text;
            if (
                !specifier.startsWith('./') &&
                !specifier.startsWith('../') &&
                specifier !== '.' &&
                specifier !== '..'
            ) {
                continue;
            }
            if (KEEP_EXTENSION.test(specifier)) continue;
            const replacement = resolveSpecifier(file, specifier);
            if (!replacement) {
                const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
                console.log(`MANUAL ${path.relative(process.cwd(), file)}:${line + 1} '${specifier}'`);
                manual++;
                continue;
            }
            // Keep the original quote character: replace only the characters inside the quotes.
            edits.push({ start: node.getStart() + 1, end: node.getEnd() - 1, replacement });
        }
        if (edits.length === 0) continue;
        edits.sort((a, b) => b.start - a.start);
        let next = text;
        for (const edit of edits) next = next.slice(0, edit.start) + edit.replacement + next.slice(edit.end);
        changedFiles++;
        changedSpecifiers += edits.length;
        if (check) {
            console.log(`WOULD CHANGE ${path.relative(process.cwd(), file)} (${edits.length})`);
        } else {
            fs.writeFileSync(file, next);
        }
    }
}

console.log(
    `${check ? 'would change' : 'changed'} ${changedSpecifiers} specifiers in ${changedFiles} files; ${manual} manual`,
);
process.exit(check && changedFiles > 0 ? 1 : 0);
