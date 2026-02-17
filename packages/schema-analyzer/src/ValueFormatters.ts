/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Binary, type BSONRegExp, type ObjectId } from 'mongodb';
import { BSONTypes } from './BSONTypes';

/**
 * Converts a MongoDB API value to its display string representation based on its type.
 *
 * @param value - The value to be converted to a display string.
 * @param type - The MongoDB API data type of the value.
 * @returns The string representation of the value.
 *
 * The function handles various MongoDB API data types including:
 * - String
 * - Number, Int32, Double, Decimal128, Long
 * - Boolean
 * - Date
 * - ObjectId
 * - Binary
 * - ...
 *
 * For unsupported or unknown types, the function defaults to JSON stringification.
 */
export function valueToDisplayString(value: unknown, type: BSONTypes): string {
    switch (type) {
        case BSONTypes.String: {
            return value as string;
        }
        case BSONTypes.Number:
        case BSONTypes.Int32:
        case BSONTypes.Double:
        case BSONTypes.Decimal128:
        case BSONTypes.Long: {
            return (value as number).toString();
        }
        case BSONTypes.Boolean: {
            return (value as boolean).toString();
        }
        case BSONTypes.Date: {
            return (value as Date).toISOString();
        }
        case BSONTypes.ObjectId: {
            return (value as ObjectId).toHexString();
        }
        case BSONTypes.Null: {
            return 'null';
        }
        case BSONTypes.RegExp: {
            const v = value as BSONRegExp;
            return `${v.pattern} ${v.options}`;
        }
        case BSONTypes.Binary: {
            return `Binary[${(value as Binary).length()}]`;
        }
        case BSONTypes.Symbol: {
            return (value as symbol).toString();
        }
        case BSONTypes.Timestamp: {
            return (value as { toString: () => string }).toString();
        }
        case BSONTypes.MinKey: {
            return 'MinKey';
        }
        case BSONTypes.MaxKey: {
            return 'MaxKey';
        }
        case BSONTypes.Code:
        case BSONTypes.CodeWithScope: {
            return JSON.stringify(value);
        }

        case BSONTypes.Array:
        case BSONTypes.Object:
        case BSONTypes.Map:
        case BSONTypes.DBRef:
        case BSONTypes.Undefined:
        case BSONTypes._UNKNOWN_:
        default: {
            return JSON.stringify(value);
        }
    }
}
