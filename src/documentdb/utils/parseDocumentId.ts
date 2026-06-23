/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { EJSON } from 'bson';
import { ext } from '../../extensionVariables';

/**
 * Upper bound on how many characters of an unparseable `_id` we echo into
 * diagnostics. Ids can be arbitrarily large (e.g. embedded-document ids), so we
 * cap the logged representation to keep the output channel readable and to
 * avoid dumping large payloads.
 */
const MAX_LOGGED_ID_LENGTH = 256;

/**
 * Convert a stringified document `_id` into the exact BSON value the driver understands.
 *
 * The id is expected to be Extended JSON (EJSON) produced by `EJSON.stringify`,
 * which is the BSON library's own canonical/relaxed serialization. `EJSON.parse`
 * is therefore the ground truth: it round-trips every `_id` type the driver
 * supports — `ObjectId` (as `{"$oid":"…"}`), string, number, `UUID`, `Date`,
 * `Decimal128`, **embedded documents** (e.g. `{ author: 'John', userId: 2343345 }`)
 * and arrays — preserving field order, which is significant when the driver
 * matches an embedded-document `_id`.
 *
 * If the id cannot be parsed, we **throw** rather than guess. Silently coercing
 * an unrecognized id into a raw string (or assuming it is an ObjectId) would
 * change which document the driver matches and could read or delete the wrong
 * record, so we fail loudly instead. The offending value (length-capped) is
 * written to the output channel for follow-up.
 *
 * @throws Error if the id cannot be interpreted as a BSON value the driver understands.
 */
export function parseDocumentId(id: string): unknown {
    try {
        return EJSON.parse(id);
    } catch {
        // Not Extended JSON — fall through to fail loudly below rather than guessing.
    }

    const preview = id.length > MAX_LOGGED_ID_LENGTH ? id.slice(0, MAX_LOGGED_ID_LENGTH) : id;
    const detail = `${JSON.stringify(preview)}${
        id.length > MAX_LOGGED_ID_LENGTH ? ` … (${id.length} chars total)` : ''
    }`;

    ext.outputChannel.error(
        'Unable to parse document _id. The value could not be interpreted as a BSON type understood ' +
            'by the driver (expected Extended JSON — e.g. {"$oid":"…"}, {"$numberInt":"…"}, or an ' +
            `embedded document). Received _id: ${detail}`,
    );

    throw new Error(l10n.t('Unable to parse the document _id. See the output channel for details.'));
}
