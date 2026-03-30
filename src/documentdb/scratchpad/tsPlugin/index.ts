/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * TypeScript Server Plugin for DocumentDB Scratchpad files.
 *
 * This plugin is loaded by VS Code's TypeScript language service when a file
 * with language ID `documentdb-scratchpad` is opened. It injects the DocumentDB
 * shell API type definitions into scratchpad files by prepending the `.d.ts`
 * content to each file's script snapshot (Approach F: Inline Snapshot Injection).
 *
 * This enables:
 *   - `db.` method chain completions with correct return types
 *   - Cursor method completions (`.limit()`, `.sort()`, etc.)
 *   - BSON constructor completions (`ObjectId()`, `ISODate()`, etc.)
 *   - JSDoc-powered hover documentation
 *   - Signature help for method parameters
 *   - Variable type tracking across assignments
 *
 * The plugin runs in the TypeScript server process (NOT the extension host),
 * so it cannot import `vscode` or any extension code.
 *
 * Architecture:
 *   1. At load time, reads the `.d.ts` file from disk (same `__dirname`-based
 *      resolution used by the scratchpad worker — proven cross-platform).
 *   2. In `create()`, proxies `languageServiceHost.getScriptSnapshot()` to
 *      prepend the `.d.ts` content to scratchpad files.
 *   3. Proxies position-based `LanguageService` methods to adjust character
 *      offsets by the prefix length (add on input, subtract on output).
 *
 * See docs/analysis/ts-plugin-diagnostic.md for the full investigation that
 * led to this approach.
 */

import * as path from 'path';
import type ts from 'typescript';

// --- Module-level initialization (runs once when TS server loads the plugin) ---

const dtsPath = path.join(__dirname, 'typeDefs', 'documentdb-shell-api.d.ts');

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
const fs: { readFileSync(path: string, encoding: 'utf8'): string } = require('fs');

let dtsContent = '';
let prefixLength = 0;
try {
    dtsContent = fs.readFileSync(dtsPath, 'utf8');
    prefixLength = dtsContent.length + 1; // +1 for '\n' separator
} catch {
    // Plugin still loads but won't inject types.
}

// --- Helpers ---

function isScratchpadFile(fileName: string): boolean {
    return fileName.includes('.documentdb.js');
}

function adjustSpan(span: ts.TextSpan): ts.TextSpan | undefined {
    const start = span.start - prefixLength;
    return start < 0 ? undefined : { start, length: span.length };
}

function adjustPosition(fileName: string, position: number): number {
    return isScratchpadFile(fileName) ? position + prefixLength : position;
}

function adjustDiagnostics<T extends ts.Diagnostic>(diagnostics: readonly T[], fileName: string): readonly T[] {
    if (!isScratchpadFile(fileName)) {
        return diagnostics;
    }
    return diagnostics.filter((d) => {
        if (d.start === undefined) {
            return true;
        }
        const adjusted = d.start - prefixLength;
        if (adjusted < 0) {
            return false;
        }
        (d as { start: number }).start = adjusted;
        return true;
    });
}

// --- Plugin factory ---

const pluginModuleFactory: ts.server.PluginModuleFactory = (mod: { typescript: typeof ts }) => ({
    create(info: ts.server.PluginCreateInfo): ts.LanguageService {
        const logger = info.project.projectService.logger;
        logger.info(`[documentdb-ts-plugin] create() called, prefixLength=${prefixLength}`);

        if (prefixLength === 0) {
            logger.info(`[documentdb-ts-plugin] No .d.ts content loaded, passing through`);
            return info.languageService;
        }

        const tsModule = mod.typescript;
        const prefix = dtsContent + '\n';

        // --- Proxy the LanguageServiceHost to inject .d.ts content ---

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const origGetSnapshot: (fileName: string) => ts.IScriptSnapshot | undefined =
            info.languageServiceHost.getScriptSnapshot.bind(info.languageServiceHost);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const origGetVersion: (fileName: string) => string = info.languageServiceHost.getScriptVersion.bind(
            info.languageServiceHost,
        );

        info.languageServiceHost.getScriptSnapshot = (fileName: string): ts.IScriptSnapshot | undefined => {
            const snapshot = origGetSnapshot(fileName);
            if (!snapshot || !isScratchpadFile(fileName)) {
                return snapshot;
            }
            const originalText = snapshot.getText(0, snapshot.getLength());
            return tsModule.ScriptSnapshot.fromString(prefix + originalText);
        };

        info.languageServiceHost.getScriptVersion = (fileName: string): string => {
            const version = origGetVersion(fileName);
            return isScratchpadFile(fileName) ? version + '-ddb-injected' : version;
        };

        // --- Create proxy LanguageService ---

        const ls = info.languageService;
        const proxy = Object.create(null) as ts.LanguageService;

        // Pass-through all methods first
        for (const k of Object.keys(ls)) {
            const val = (ls as unknown as Record<string, unknown>)[k];
            if (typeof val === 'function') {
                const fn = val as (...a: unknown[]) => unknown;
                (proxy as unknown as Record<string, unknown>)[k] = (...args: unknown[]): unknown =>
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
                    fn.apply(ls, args);
            }
        }

        // --- Override position-sensitive methods ---

        proxy.getQuickInfoAtPosition = (fileName: string, position: number): ts.QuickInfo | undefined => {
            const result = ls.getQuickInfoAtPosition(fileName, adjustPosition(fileName, position));
            if (!result || !isScratchpadFile(fileName)) {
                return result;
            }
            const adj = adjustSpan(result.textSpan);
            return adj ? { ...result, textSpan: adj } : undefined;
        };

        proxy.getCompletionsAtPosition = (
            fileName: string,
            position: number,
            options: ts.GetCompletionsAtPositionOptions | undefined,
            formattingSettings?: ts.FormatCodeSettings,
        ): ts.WithMetadata<ts.CompletionInfo> | undefined => {
            const result = ls.getCompletionsAtPosition(
                fileName,
                adjustPosition(fileName, position),
                options,
                formattingSettings,
            );
            if (!result || !isScratchpadFile(fileName)) {
                return result;
            }
            if (result.optionalReplacementSpan) {
                const adj = adjustSpan(result.optionalReplacementSpan);
                if (adj) {
                    return { ...result, optionalReplacementSpan: adj };
                }
            }
            return result;
        };

        proxy.getCompletionEntryDetails = (
            fileName: string,
            position: number,
            entryName: string,
            formatOptions: ts.FormatCodeOptions | ts.FormatCodeSettings | undefined,
            source: string | undefined,
            preferences: ts.UserPreferences | undefined,
            data: ts.CompletionEntryData | undefined,
        ): ts.CompletionEntryDetails | undefined => {
            return ls.getCompletionEntryDetails(
                fileName,
                adjustPosition(fileName, position),
                entryName,
                formatOptions,
                source,
                preferences,
                data,
            );
        };

        proxy.getSignatureHelpItems = (
            fileName: string,
            position: number,
            options: ts.SignatureHelpItemsOptions | undefined,
        ): ts.SignatureHelpItems | undefined => {
            const result = ls.getSignatureHelpItems(fileName, adjustPosition(fileName, position), options);
            if (!result || !isScratchpadFile(fileName)) {
                return result;
            }
            const adj = adjustSpan(result.applicableSpan);
            return adj ? { ...result, applicableSpan: adj } : undefined;
        };

        proxy.getDefinitionAtPosition = (
            fileName: string,
            position: number,
        ): readonly ts.DefinitionInfo[] | undefined => {
            const result = ls.getDefinitionAtPosition(fileName, adjustPosition(fileName, position));
            if (!result || !isScratchpadFile(fileName)) {
                return result;
            }
            return result.filter((d) => {
                if (d.fileName !== fileName) {
                    return true;
                }
                const adj = adjustSpan(d.textSpan);
                if (!adj) {
                    return false;
                }
                (d as { textSpan: ts.TextSpan }).textSpan = adj;
                return true;
            });
        };

        proxy.getDefinitionAndBoundSpan = (
            fileName: string,
            position: number,
        ): ts.DefinitionInfoAndBoundSpan | undefined => {
            const result = ls.getDefinitionAndBoundSpan(fileName, adjustPosition(fileName, position));
            if (!result || !isScratchpadFile(fileName)) {
                return result;
            }
            const adj = adjustSpan(result.textSpan);
            return adj ? { ...result, textSpan: adj } : undefined;
        };

        proxy.getDocumentHighlights = (
            fileName: string,
            position: number,
            filesToSearch: string[],
        ): ts.DocumentHighlights[] | undefined => {
            const result = ls.getDocumentHighlights(fileName, adjustPosition(fileName, position), filesToSearch);
            if (!result) {
                return result;
            }
            return result.map((dh) => {
                if (!isScratchpadFile(dh.fileName)) {
                    return dh;
                }
                return {
                    ...dh,
                    highlightSpans: dh.highlightSpans.filter((span) => {
                        const adj = adjustSpan(span.textSpan);
                        if (!adj) {
                            return false;
                        }
                        (span as { textSpan: ts.TextSpan }).textSpan = adj;
                        return true;
                    }),
                };
            });
        };

        proxy.getReferencesAtPosition = (fileName: string, position: number): ts.ReferenceEntry[] | undefined => {
            const result = ls.getReferencesAtPosition(fileName, adjustPosition(fileName, position));
            if (!result) {
                return result;
            }
            return result.filter((ref) => {
                if (!isScratchpadFile(ref.fileName)) {
                    return true;
                }
                const adj = adjustSpan(ref.textSpan);
                if (!adj) {
                    return false;
                }
                (ref as { textSpan: ts.TextSpan }).textSpan = adj;
                return true;
            });
        };

        proxy.findReferences = (fileName: string, position: number): ts.ReferencedSymbol[] | undefined => {
            const result = ls.findReferences(fileName, adjustPosition(fileName, position));
            if (!result) {
                return result;
            }
            return result.map((group) => ({
                ...group,
                references: group.references.filter((ref) => {
                    if (!isScratchpadFile(ref.fileName)) {
                        return true;
                    }
                    const adj = adjustSpan(ref.textSpan);
                    if (!adj) {
                        return false;
                    }
                    (ref as { textSpan: ts.TextSpan }).textSpan = adj;
                    return true;
                }),
            }));
        };

        proxy.getRenameInfo = (fileName: string, position: number, preferences?: ts.UserPreferences): ts.RenameInfo => {
            const result = ls.getRenameInfo(fileName, adjustPosition(fileName, position), preferences);
            if (!isScratchpadFile(fileName) || !result.canRename) {
                return result;
            }
            const adj = adjustSpan(result.triggerSpan);
            if (!adj) {
                return { canRename: false, localizedErrorMessage: 'Cannot rename injected type definitions' };
            }
            return { ...result, triggerSpan: adj };
        };

        // --- Output-only adjustment methods ---

        proxy.getSyntacticDiagnostics = (fileName: string): ts.DiagnosticWithLocation[] =>
            adjustDiagnostics(ls.getSyntacticDiagnostics(fileName), fileName) as ts.DiagnosticWithLocation[];

        proxy.getSemanticDiagnostics = (fileName: string): ts.Diagnostic[] =>
            adjustDiagnostics(ls.getSemanticDiagnostics(fileName), fileName) as ts.Diagnostic[];

        proxy.getSuggestionDiagnostics = (fileName: string): ts.DiagnosticWithLocation[] =>
            adjustDiagnostics(ls.getSuggestionDiagnostics(fileName), fileName) as ts.DiagnosticWithLocation[];

        proxy.getEncodedSemanticClassifications = (
            fileName: string,
            span: ts.TextSpan,
            format?: ts.SemanticClassificationFormat,
        ): ts.Classifications => {
            const result = ls.getEncodedSemanticClassifications(fileName, span, format);
            if (!isScratchpadFile(fileName)) {
                return result;
            }
            const adjusted: number[] = [];
            for (let i = 0; i < result.spans.length; i += 3) {
                const start = result.spans[i] - prefixLength;
                if (start >= 0) {
                    adjusted.push(start, result.spans[i + 1], result.spans[i + 2]);
                }
            }
            return { spans: adjusted, endOfLineState: result.endOfLineState };
        };

        proxy.getEncodedSyntacticClassifications = (fileName: string, span: ts.TextSpan): ts.Classifications => {
            const result = ls.getEncodedSyntacticClassifications(fileName, span);
            if (!isScratchpadFile(fileName)) {
                return result;
            }
            const adjusted: number[] = [];
            for (let i = 0; i < result.spans.length; i += 3) {
                const start = result.spans[i] - prefixLength;
                if (start >= 0) {
                    adjusted.push(start, result.spans[i + 1], result.spans[i + 2]);
                }
            }
            return { spans: adjusted, endOfLineState: result.endOfLineState };
        };

        proxy.getOutliningSpans = (fileName: string): ts.OutliningSpan[] => {
            const result = ls.getOutliningSpans(fileName);
            if (!isScratchpadFile(fileName)) {
                return result;
            }
            return result.filter((span) => {
                const adjText = adjustSpan(span.textSpan);
                const adjHint = adjustSpan(span.hintSpan);
                if (!adjText || !adjHint) {
                    return false;
                }
                (span as { textSpan: ts.TextSpan }).textSpan = adjText;
                (span as { hintSpan: ts.TextSpan }).hintSpan = adjHint;
                return true;
            });
        };

        proxy.getNavigationTree = (fileName: string): ts.NavigationTree => {
            const result = ls.getNavigationTree(fileName);
            if (!isScratchpadFile(fileName)) {
                return result;
            }
            function adjustTree(node: ts.NavigationTree): ts.NavigationTree {
                return {
                    ...node,
                    spans: node.spans.map(adjustSpan).filter((s): s is ts.TextSpan => s !== undefined),
                    nameSpan: node.nameSpan ? adjustSpan(node.nameSpan) : undefined,
                    childItems: node.childItems?.map(adjustTree),
                };
            }
            return adjustTree(result);
        };

        // --- Methods needing both input and output adjustment ---

        proxy.getFormattingEditsForRange = (
            fileName: string,
            start: number,
            end: number,
            options: ts.FormatCodeOptions | ts.FormatCodeSettings,
        ): ts.TextChange[] => {
            const isSP = isScratchpadFile(fileName);
            const result = ls.getFormattingEditsForRange(
                fileName,
                isSP ? start + prefixLength : start,
                isSP ? end + prefixLength : end,
                options,
            );
            if (!isSP) {
                return result;
            }
            return result.filter((edit) => {
                const adj = adjustSpan(edit.span);
                if (!adj) {
                    return false;
                }
                (edit as { span: ts.TextSpan }).span = adj;
                return true;
            });
        };

        proxy.getFormattingEditsAfterKeystroke = (
            fileName: string,
            position: number,
            key: string,
            options: ts.FormatCodeOptions | ts.FormatCodeSettings,
        ): ts.TextChange[] => {
            const result = ls.getFormattingEditsAfterKeystroke(
                fileName,
                adjustPosition(fileName, position),
                key,
                options,
            );
            if (!isScratchpadFile(fileName)) {
                return result;
            }
            return result.filter((edit) => {
                const adj = adjustSpan(edit.span);
                if (!adj) {
                    return false;
                }
                (edit as { span: ts.TextSpan }).span = adj;
                return true;
            });
        };

        proxy.getBraceMatchingAtPosition = (fileName: string, position: number): ts.TextSpan[] => {
            const result = ls.getBraceMatchingAtPosition(fileName, adjustPosition(fileName, position));
            if (!isScratchpadFile(fileName)) {
                return result;
            }
            return result.map(adjustSpan).filter((s): s is ts.TextSpan => s !== undefined);
        };

        logger.info(`[documentdb-ts-plugin] Proxy LanguageService created with ${prefixLength}-char offset`);
        return proxy;
    },

    getExternalFiles(): string[] {
        return [dtsPath];
    },
});

export = pluginModuleFactory;
