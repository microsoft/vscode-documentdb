/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared utility for feeding query execution results to {@link SchemaStore}.
 *
 * Used by both the Query Playground and the Interactive Shell to accumulate
 * schema data from user query results. The schema data enables field name
 * completions across all surfaces (Collection View, Playground, Shell).
 *
 * @see {@link SchemaStore} for the underlying cache architecture.
 */

import { type Document, type WithId } from 'mongodb';
import { SchemaStore } from './SchemaStore';

/**
 * A deserialized execution result with raw printable value (not EJSON string).
 * Both {@link ExecutionResult} (playground) and deserialized shell results
 * conform to this shape.
 */
export interface SchemaFeedableResult {
    /** The mongosh result type string (e.g. 'Cursor', 'Document', 'string'). */
    readonly type: string | null;
    /** The printable result value — already deserialized from EJSON. */
    readonly printable: unknown;
    /** Source namespace from the `@mongosh` ShellResult, if available. */
    readonly source?: {
        readonly namespace?: {
            readonly db: string;
            readonly collection: string;
        };
    };
}

/**
 * Maximum number of documents to feed to SchemaStore per execution.
 * If the result set is larger, a random sample of this size is used.
 */
const SCHEMA_DOC_CAP = 100;

/**
 * Feed query result documents to {@link SchemaStore} for schema accumulation.
 *
 * Very conservative: only feeds 'Cursor' and 'Document' result types that have
 * a known namespace. Extracts documents from the printable result, filtering to
 * actual documents with `_id` (rejects primitives, arrays, and projections
 * without `_id`). Caps at {@link SCHEMA_DOC_CAP} documents per call.
 *
 * @param result - A deserialized execution result (printable must be raw objects, not EJSON strings).
 * @param clusterId - Stable cluster ID for SchemaStore key construction.
 */
export function feedResultToSchemaStore(result: SchemaFeedableResult, clusterId: string): void {
    // Only feed known document-producing result types
    if (result.type !== 'Cursor' && result.type !== 'Document') {
        return;
    }

    const ns = result.source?.namespace;
    if (!ns?.collection) {
        return;
    }

    const printable = result.printable;
    if (printable === null || printable === undefined) {
        return;
    }

    // CursorIterationResult from @mongosh wraps documents in { cursorHasMore, documents }.
    // Only unwrap when the full wrapper shape is present to avoid false positives
    // on user documents that happen to have a `documents` field.
    let items: unknown[];
    if (
        typeof printable === 'object' &&
        !Array.isArray(printable) &&
        'cursorHasMore' in printable &&
        typeof (printable as Record<string, unknown>).cursorHasMore === 'boolean' &&
        'documents' in printable &&
        Array.isArray((printable as { documents: unknown }).documents)
    ) {
        items = (printable as { documents: unknown[] }).documents;
    } else if (Array.isArray(printable)) {
        items = printable;
    } else {
        items = [printable];
    }

    // Filter to actual document objects with _id (not primitives, not nested arrays,
    // not projection results with _id: 0 which have artificial shapes)
    let docs = items.filter(
        (d): d is WithId<Document> =>
            d !== null && d !== undefined && typeof d === 'object' && !Array.isArray(d) && '_id' in d,
    );

    if (docs.length === 0) {
        return;
    }

    // Cap at SCHEMA_DOC_CAP documents — randomly sample if more
    if (docs.length > SCHEMA_DOC_CAP) {
        docs = randomSample(docs, SCHEMA_DOC_CAP);
    }

    SchemaStore.getInstance().addDocuments(clusterId, ns.db, ns.collection, docs);
}

/**
 * Deserialize a {@link SerializableExecutionResult} from EJSON string back to
 * raw objects. Canonical EJSON (`relaxed: false`) preserves all BSON types
 * (ObjectId, Date, Decimal128, etc.) so that SchemaAnalyzer correctly identifies
 * field types.
 *
 * @param serResult - The serialized result with EJSON printable string.
 * @returns A deserialized result suitable for {@link feedResultToSchemaStore}.
 */
export async function deserializeResultForSchema(serResult: {
    readonly type: string | null;
    readonly printable: string;
    readonly source?: {
        readonly namespace?: {
            readonly db: string;
            readonly collection: string;
        };
    };
}): Promise<SchemaFeedableResult> {
    let printable: unknown;
    try {
        const { EJSON } = await import('bson');
        printable = EJSON.parse(serResult.printable, { relaxed: false });
    } catch {
        // Fallback to JSON.parse if EJSON fails, then raw string
        try {
            printable = JSON.parse(serResult.printable) as unknown;
        } catch {
            printable = serResult.printable;
        }
    }

    return {
        type: serResult.type,
        printable,
        source: serResult.source,
    };
}

/**
 * Partial Fisher–Yates random sample of `count` items from `array`.
 * Only performs `count` swaps instead of shuffling the entire array.
 */
function randomSample<T>(array: T[], count: number): T[] {
    const n = Math.min(count, array.length);
    const copy = [...array];
    for (let i = 0; i < n; i++) {
        const j = i + Math.floor(Math.random() * (copy.length - i));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, n);
}
