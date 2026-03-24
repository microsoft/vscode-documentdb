/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EventEmitter } from 'events';
import * as vm from 'vm';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { ClustersClient } from '../ClustersClient';
import { type ExecutionResult, type ScratchpadConnection } from './types';

/**
 * Evaluates scratchpad code in-process using the `@mongosh` pipeline,
 * reusing the existing authenticated `MongoClient` from `ClustersClient`.
 *
 * A fresh `ShellInstanceState` + `ShellEvaluator` is created per execution
 * to avoid variable leakage between runs. Only the `MongoClient` is reused.
 *
 * Dependencies (`@mongosh/*`) are lazy-imported to avoid loading ~2-4 MB
 * of Babel + async-rewriter at extension activation time.
 */
export class ScratchpadEvaluator {
    /**
     * Evaluate user code against the connected database.
     *
     * @param connection - Active scratchpad connection (clusterId + databaseName).
     * @param code - JavaScript code string to evaluate.
     * @returns Formatted execution result with type, printable value, and timing.
     */
    async evaluate(connection: ScratchpadConnection, code: string): Promise<ExecutionResult> {
        // Lazy-import @mongosh packages to avoid loading at activation time
        const { NodeDriverServiceProvider } = await import('@mongosh/service-provider-node-driver');
        const { ShellInstanceState } = await import('@mongosh/shell-api');
        const { ShellEvaluator } = await import('@mongosh/shell-evaluator');

        // Reuse the existing authenticated MongoClient
        const client = await ClustersClient.getClient(connection.clusterId);
        const mongoClient = client.getMongoClient();

        // Create fresh shell context per execution (no variable leakage)
        const bus = new EventEmitter();
        const serviceProvider = new NodeDriverServiceProvider(mongoClient, bus, {
            productDocsLink: 'https://github.com/microsoft/vscode-documentdb',
            productName: 'DocumentDB for VS Code Scratchpad',
        });
        const instanceState = new ShellInstanceState(serviceProvider, bus);
        const evaluator = new ShellEvaluator(instanceState);

        // Set up eval context with shell globals (db, ObjectId, ISODate, etc.)
        const context = {};
        instanceState.setCtx(context);

        // Pre-select the target database
        await evaluator.customEval(
            customEvalFn,
            `use(${JSON.stringify(connection.databaseName)})`,
            context,
            'scratchpad',
        );

        // Execute with timeout
        const timeoutMs = (vscode.workspace.getConfiguration().get<number>(ext.settingsKeys.shellTimeout) ?? 30) * 1000;

        const startTime = Date.now();

        // Intercept scratchpad-specific commands before they reach @mongosh
        const trimmed = code.trim();
        const helpResult = this.tryHandleHelp(trimmed);
        if (helpResult) {
            return { ...helpResult, durationMs: Date.now() - startTime };
        }

        const evalPromise = evaluator.customEval(customEvalFn, code, context, 'scratchpad');
        const timeoutPromise = new Promise<never>((_resolve, reject) => {
            setTimeout(() => reject(new Error(l10n.t('Execution timed out'))), timeoutMs);
        });

        const result = await Promise.race([evalPromise, timeoutPromise]);
        const durationMs = Date.now() - startTime;

        // customEval already runs toShellResult() internally via resultHandler,
        // so `result` is already a ShellResult { type, printable, rawValue }.
        const shellResult = result as { type: string | null; printable: unknown };

        return {
            type: shellResult.type,
            printable: shellResult.printable,
            durationMs,
        };
    }

    /**
     * Handle `help` command with scratchpad-specific output.
     * Returns undefined if the input is not a help command.
     */
    private tryHandleHelp(input: string): Omit<ExecutionResult, 'durationMs'> | undefined {
        if (input !== 'help' && input !== 'help()') {
            return undefined;
        }

        const helpText = [
            'DocumentDB Scratchpad — Quick Reference',
            '════════════════════════════════════════',
            '',
            'Collection Access:',
            '  db.getCollection("name")                       Explicit (recommended)',
            '  db.name                                        Shorthand (also works)',
            '',
            'Query Commands:',
            '  db.getCollection("name").find({})              Find documents',
            '  db.getCollection("name").findOne({})           Find one document',
            '  db.getCollection("name").countDocuments({})     Count documents',
            '  db.getCollection("name").estimatedDocumentCount()  Fast count',
            '  db.getCollection("name").distinct("field")     Distinct values',
            '  db.getCollection("name").aggregate([...])      Aggregation pipeline',
            '',
            'Write Commands:',
            '  db.getCollection("name").insertOne({...})      Insert a document',
            '  db.getCollection("name").insertMany([...])     Insert multiple documents',
            '  db.getCollection("name").updateOne({}, {$set:{}})  Update one',
            '  db.getCollection("name").replaceOne({}, {...})  Replace one',
            '  db.getCollection("name").deleteOne({})         Delete one',
            '  db.getCollection("name").bulkWrite([...])      Batch operations',
            '',
            'Index Commands:',
            '  db.getCollection("name").createIndex({field:1})  Create index',
            '  db.getCollection("name").getIndexes()          List indexes',
            '  db.getCollection("name").dropIndex("name")     Drop index',
            '',
            'Cursor Modifiers:',
            '  .limit(n)                                      Limit results',
            '  .skip(n)                                       Skip results',
            '  .sort({field: 1})                              Sort results',
            '  .project({field: 1})                           Field projection',
            '  .toArray()                                     Get all results',
            '  .count()                                       Count matching',
            '  .explain()                                     Query plan',
            '',
            'Database Commands:',
            '  show dbs                                       List databases',
            '  show collections                               List collections',
            '  db.getCollectionNames()                        List collection names',
            '  db.getCollectionInfos()                        Collection metadata',
            '  db.createCollection("name")                    Create collection',
            '  db.getCollection("name").drop()                Drop collection',
            '  db.runCommand({...})                           Run database command',
            '  db.adminCommand({...})                         Run admin command',
            '',
            'BSON Constructors:',
            '  ObjectId("...")                                Create ObjectId',
            '  ISODate("...")                                 Create Date',
            '  NumberDecimal("...")                           Create Decimal128',
            '',
            'Keyboard Shortcuts:',
            `  ${process.platform === 'darwin' ? '⌘' : 'Ctrl'}+Enter             Run current block`,
            `  ${process.platform === 'darwin' ? '⌘' : 'Ctrl'}+Shift+Enter       Run entire file`,
            '',
            'Tips:',
            '  • Separate code blocks with blank lines',
            '  • Variables persist within a block but not between separate runs',
            '  • Use .toArray() to get all results (default: first 20 documents)',
        ].join('\n');

        return { type: 'Help', printable: helpText };
    }
}

/**
 * The eval function passed to `ShellEvaluator.customEval()`.
 * Called by @mongosh with (rewrittenCode, context, filename).
 *
 * Uses `vm.runInContext` so that all properties on the context object
 * (including getters like `db`) are accessible as globals in the code.
 */
// eslint-disable-next-line @typescript-eslint/require-await
async function customEvalFn(code: string, context: object): Promise<unknown> {
    const vmContext = vm.isContext(context) ? context : vm.createContext(context);
    return vm.runInContext(code, vmContext) as unknown;
}
