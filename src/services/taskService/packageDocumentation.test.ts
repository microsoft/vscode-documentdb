/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { createTaskService, TaskState } from '@microsoft/vscode-ext-tasks';
import { ConflictResolutionStrategy, type DocumentDetails } from '@microsoft/vscode-ext-tasks-data-transfer';
import { describe, expect, it, vi } from 'vitest';
import { copyCollection } from '../../../packages/vscode-ext-tasks-data-transfer/type-tests/copy-task';
import {
    MemoryReader,
    MemoryWriter,
} from '../../../packages/vscode-ext-tasks-data-transfer/type-tests/memory-adapters';
import {
    PartialThrottleError,
    ThrottleAwareWriter,
    throttledOutcome,
} from '../../../packages/vscode-ext-tasks-data-transfer/type-tests/partial-writes';
import { ExampleTask } from '../../../packages/vscode-ext-tasks/type-tests/basic-task';
import { ResourceTask } from '../../../packages/vscode-ext-tasks/type-tests/initialized-resource-task';
import { runTask } from '../../../packages/vscode-ext-tasks/type-tests/registry';

const packagesDir = path.resolve(__dirname, '../../../packages');
const examples = [
    { packageName: 'vscode-ext-tasks', name: 'basic-task' },
    { packageName: 'vscode-ext-tasks', name: 'initialized-resource-task' },
    { packageName: 'vscode-ext-tasks', name: 'registry' },
    { packageName: 'vscode-ext-tasks-data-transfer', name: 'memory-adapters' },
    { packageName: 'vscode-ext-tasks-data-transfer', name: 'copy-task' },
    { packageName: 'vscode-ext-tasks-data-transfer', name: 'partial-writes' },
];

describe('Task package documentation', () => {
    it.each(['vscode-ext-tasks', 'vscode-ext-tasks-data-transfer'])(
        'tracks every TypeScript snippet in %s',
        (packageName) => {
            const packageDir = path.join(packagesDir, packageName);
            const readme = readFileSync(path.join(packageDir, 'README.md'), 'utf8');
            const names = examples
                .filter((example) => example.packageName === packageName)
                .map((example) => example.name)
                .sort();
            const markers = [...readme.matchAll(/<!-- example:([\w-]+) -->/g)].map((match) => match[1]).sort();
            const files = readdirSync(path.join(packageDir, 'type-tests'))
                .filter((file) => file.endsWith('.ts'))
                .map((file) => file.slice(0, -3))
                .sort();
            const fences = [...readme.matchAll(/^[ \t]*```(?:typescript|tsx|ts)[ \t]*$/gm)];

            expect(markers).toEqual(names);
            expect(files).toEqual(names);
            expect(fences).toHaveLength(names.length);
        },
    );

    it.each(examples)('keeps $packageName/$name in sync with its README', ({ packageName, name }) => {
        const packageDir = path.join(packagesDir, packageName);
        const readme = readFileSync(path.join(packageDir, 'README.md'), 'utf8').replace(/\r\n/g, '\n');
        const source = readFileSync(path.join(packageDir, 'type-tests', `${name}.ts`), 'utf8').replace(/\r\n/g, '\n');
        const marker = new RegExp(
            `<!-- example:${name} -->\\s*\`\`\`typescript\\n([\\s\\S]*?)\\n\`\`\`\\s*<!-- endexample -->`,
            'g',
        );
        const snippets = [...readme.matchAll(marker)];
        const sourceParts = source.split('// Example starts here.\n');

        expect(snippets).toHaveLength(1);
        expect(sourceParts).toHaveLength(2);
        expect(snippets[0]?.[1]).toBe(sourceParts[1]?.trimEnd());
    });

    it('runs the basic task and waits for completion', async () => {
        const processed: string[] = [];
        const task = new ExampleTask(['one', 'two'], async (item) => {
            processed.push(item);
        });

        const status = await runTask(createTaskService(), task);

        expect(processed).toEqual(['one', 'two']);
        expect(status.state).toBe(TaskState.Completed);
    });

    it('tracks a resource and stops after initialization fails', async () => {
        const service = createTaskService();
        let worked = false;
        const resource = { clusterId: 'stable-id', databaseName: 'db', collectionName: 'items' };
        const task = new ResourceTask(
            resource,
            async () => {
                throw new Error('Source unavailable');
            },
            async () => {
                worked = true;
            },
        );
        service.registerTask(task);
        expect(service.getConflictingTasks(resource)).toHaveLength(1);

        await task.start();

        expect(task.getStatus().state).toBe(TaskState.Failed);
        expect(task.getStatus().error).toMatchObject({ message: 'Source unavailable' });
        expect(worked).toBe(false);
    });

    it('copies documents with the in-memory adapters and reports a conflict', async () => {
        const documents = [{ id: 'one', documentContent: { value: 1 } }];
        const target = new Map<string, unknown>();
        const service = createTaskService();

        const first = await copyCollection(service, new MemoryReader(documents), new MemoryWriter(target));
        const second = await copyCollection(service, new MemoryReader(documents), new MemoryWriter(target));

        expect(first.state).toBe(TaskState.Completed);
        expect(target.get('one')).toEqual({ value: 1 });
        expect(second.state).toBe(TaskState.Failed);
    });

    it('does not mutate the target when a later ID in the batch is invalid', async () => {
        const target = new Map<string, unknown>([['existing', 'unchanged']]);
        const documents: DocumentDetails[] = [
            { id: 'one', documentContent: 1 },
            { id: 2, documentContent: 2 },
        ];
        const writer = new MemoryWriter(target);

        await expect(
            writer.streamDocuments(new MemoryReader(documents).streamDocuments(), {
                conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
            }),
        ).rejects.toMatchObject({
            name: 'StreamingWriterError',
            cause: { message: 'Expected a string document ID' },
            partialStats: { totalProcessed: 0, insertedCount: undefined },
        });
        expect([...target]).toEqual([['existing', 'unchanged']]);
    });

    it('reports previous batches without inserting part of an invalid batch', async () => {
        const target = new Map<string, unknown>();
        const documents: DocumentDetails[] = [
            { id: 'one', documentContent: 1 },
            { id: 'two', documentContent: 2 },
            { id: 'three', documentContent: 3 },
            { id: 4, documentContent: 4 },
        ];
        const writer = new MemoryWriter(target, {
            batching: { ruLimited: { initialBatchSize: 2, maxBatchSize: 2 } },
        });

        await expect(
            writer.streamDocuments(new MemoryReader(documents).streamDocuments(), {
                conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
            }),
        ).rejects.toMatchObject({
            name: 'StreamingWriterError',
            cause: { message: 'Expected a string document ID' },
            partialStats: { totalProcessed: 2, insertedCount: 2, flushCount: 1 },
        });
        expect([...target]).toEqual([
            ['one', 1],
            ['two', 2],
        ]);
    });

    it.each(['returned', 'thrown'] as const)('retries %s partial writes and honors server waits', async (route) => {
        const documents: DocumentDetails[] = [
            { id: 'one', documentContent: 1 },
            { id: 'two', documentContent: 2 },
            { id: 'three', documentContent: 3 },
        ];
        const attempts: unknown[][] = [];
        const retryAfterMs = 250;
        const writer = new ThrottleAwareWriter(
            async (batch) => {
                attempts.push(batch.map((document) => document.id));
                if (attempts.length === 1) {
                    if (route === 'returned') {
                        return throttledOutcome(batch, new Set([1]), retryAfterMs);
                    }
                    throw new PartialThrottleError(1, [batch[0], batch[2]], retryAfterMs);
                }
                return { processedCount: batch.length, insertedCount: batch.length, abortedCount: 0 };
            },
            { retry: { baseDelayMs: 0, jitterFraction: 0 } },
        );

        vi.useFakeTimers();
        try {
            const resultPromise = writer.streamDocuments(new MemoryReader(documents).streamDocuments(), {
                conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
            });
            await vi.advanceTimersByTimeAsync(retryAfterMs - 1);
            expect(attempts).toEqual([['one', 'two', 'three']]);
            await vi.advanceTimersByTimeAsync(1);
            const result = await resultPromise;

            expect(attempts).toEqual([
                ['one', 'two', 'three'],
                ['one', 'three'],
            ]);
            expect(result.totalProcessed).toBe(3);
            expect(result.insertedCount).toBe(3);
        } finally {
            vi.useRealTimers();
        }
    });
});
