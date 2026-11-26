/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BSONTypes } from '@documentdb-js/schema-analyzer';
import { EJSON } from 'bson';
import { type Document } from 'mongodb';

export interface PageRowIdentity {
    readonly rowKey: string;
    readonly documentId?: string;
}

function isSafeIdentityValue(value: unknown): boolean {
    const type = BSONTypes.inferType(value);
    if (type === BSONTypes.Undefined || type === BSONTypes._UNKNOWN_) {
        return false;
    }
    if (type === BSONTypes.Date) {
        return Number.isFinite((value as Date).getTime());
    }
    if (type === BSONTypes.Object || type === BSONTypes.Array) {
        if (type === BSONTypes.Object) {
            const prototype: unknown = Object.getPrototypeOf(value);
            if (prototype !== null && prototype !== Object.prototype) {
                return false;
            }
        }
        return Object.entries(value as object).every(
            ([key, child]) => !key.startsWith('$') && isSafeIdentityValue(child),
        );
    }
    return true;
}

export function toDocumentId(document: Document): string | undefined {
    if (!Object.prototype.hasOwnProperty.call(document, '_id')) {
        return undefined;
    }

    const id: unknown = document._id;
    const type = BSONTypes.inferType(id);
    if (type === BSONTypes.Array || type === BSONTypes.RegExp || type === BSONTypes.DBRef || type === BSONTypes.Map) {
        return undefined;
    }

    try {
        const canonical = EJSON.stringify(id, { relaxed: false });
        if (typeof canonical !== 'string' || !isSafeIdentityValue(id)) {
            return undefined;
        }
        return EJSON.stringify(EJSON.parse(canonical), { relaxed: false }) === canonical ? canonical : undefined;
    } catch {
        // Serialization and the existing action parser must both preserve the ID exactly.
        return undefined;
    }
}

export function isIdentityTrustedForProjection(projection: Document | undefined): boolean {
    if (projection === undefined) {
        return true;
    }
    for (const key of Object.keys(projection)) {
        if (key.startsWith('_id.')) {
            return false;
        }
        if (key === '_id' && typeof projection[key] !== 'boolean' && typeof projection[key] !== 'number') {
            return false;
        }
    }
    return true;
}

export function assignRowIdentities(documents: readonly Document[], identityTrusted: boolean): PageRowIdentity[] {
    const ids = documents.map((document) => (identityTrusted ? toDocumentId(document) : undefined));
    const counts = new Map<string, number>();
    for (const id of ids) {
        if (id !== undefined) {
            counts.set(id, (counts.get(id) ?? 0) + 1);
        }
    }
    return ids.map((documentId, index) =>
        documentId !== undefined && counts.get(documentId) === 1
            ? { rowKey: `id:${documentId}`, documentId }
            : { rowKey: `pos:${index}` },
    );
}
