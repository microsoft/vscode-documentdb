/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ParseMode, parse as parseShellBSON } from '@mongodb-js/shell-bson-parser';
import { EJSON } from 'bson';

/**
 * Parses projection and sort strings with strict EJSON compatibility first,
 * then falls back to loose shell BSON syntax.
 */
export function parseProjectionOrSortQuery(query: string): unknown {
    try {
        return EJSON.parse(query);
    } catch (strictError) {
        try {
            return parseShellBSON(query, { mode: ParseMode.Loose });
        } catch (looseError) {
            const strictMessage = strictError instanceof Error ? strictError.message : String(strictError);
            const looseMessage = looseError instanceof Error ? looseError.message : String(looseError);
            throw new Error(
                `Unable to parse projection or sort query. Strict EJSON parse failed: ${strictMessage}. Loose shell BSON parse failed: ${looseMessage}.`,
                { cause: looseError instanceof Error ? looseError : undefined },
            );
        }
    }
}
