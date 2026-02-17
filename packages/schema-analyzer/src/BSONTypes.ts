/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Binary,
    BSONSymbol,
    Code,
    DBRef,
    Decimal128,
    Double,
    Int32,
    Long,
    MaxKey,
    MinKey,
    ObjectId,
    Timestamp,
    UUID,
} from 'mongodb';

/**
 * Represents the different data types that can be stored in a MongoDB document.
 * The string representation is casesensitive and should match the MongoDB documentation.
 * https://www.mongodb.com/docs/manual/reference/bson-types/
 */
export enum BSONTypes {
    String = 'string',
    Number = 'number',
    Int32 = 'int32',
    Double = 'double',
    Decimal128 = 'decimal128',
    Long = 'long',
    Boolean = 'boolean',
    Object = 'object',
    Array = 'array',
    Null = 'null',
    Undefined = 'undefined',
    Date = 'date',
    RegExp = 'regexp',
    Binary = 'binary',
    ObjectId = 'objectid',
    Symbol = 'symbol',
    Timestamp = 'timestamp',
    UUID = 'uuid',
    UUID_LEGACY = 'uuid-legacy', // old UUID subtype, used in some legacy data
    MinKey = 'minkey',
    MaxKey = 'maxkey',
    DBRef = 'dbref',
    Code = 'code',
    CodeWithScope = 'codewithscope',
    Map = 'map',
    // Add any deprecated types if necessary
    _UNKNOWN_ = '_unknown_', // Catch-all for unknown types
}

export namespace BSONTypes {
    const displayStringMap: Record<BSONTypes, string> = {
        [BSONTypes.String]: 'String',
        [BSONTypes.Number]: 'Number',
        [BSONTypes.Int32]: 'Int32',
        [BSONTypes.Double]: 'Double',
        [BSONTypes.Decimal128]: 'Decimal128',
        [BSONTypes.Long]: 'Long',
        [BSONTypes.Boolean]: 'Boolean',
        [BSONTypes.Object]: 'Object',
        [BSONTypes.Array]: 'Array',
        [BSONTypes.Null]: 'Null',
        [BSONTypes.Undefined]: 'Undefined',
        [BSONTypes.Date]: 'Date',
        [BSONTypes.RegExp]: 'RegExp',
        [BSONTypes.Binary]: 'Binary',
        [BSONTypes.ObjectId]: 'ObjectId',
        [BSONTypes.Symbol]: 'Symbol',
        [BSONTypes.Timestamp]: 'Timestamp',
        [BSONTypes.MinKey]: 'MinKey',
        [BSONTypes.MaxKey]: 'MaxKey',
        [BSONTypes.DBRef]: 'DBRef',
        [BSONTypes.Code]: 'Code',
        [BSONTypes.CodeWithScope]: 'CodeWithScope',
        [BSONTypes.Map]: 'Map',
        [BSONTypes._UNKNOWN_]: 'Unknown',
        [BSONTypes.UUID]: 'UUID',
        [BSONTypes.UUID_LEGACY]: 'UUID (Legacy)',
    };

    export function toDisplayString(type: BSONTypes): string {
        return displayStringMap[type] || 'Unknown';
    }

    export function toString(type: BSONTypes): string {
        return type;
    }

    /**
     * Converts a MongoDB data type to a case sensitive JSON data type
     * @param type The MongoDB data type
     * @returns A corresponding JSON data type (please note: it's case sensitive)
     */
    export function toJSONType(type: BSONTypes): string {
        switch (type) {
            case BSONTypes.String:
            case BSONTypes.Symbol:
            case BSONTypes.Date:
            case BSONTypes.Timestamp:
            case BSONTypes.ObjectId:
            case BSONTypes.RegExp:
            case BSONTypes.Binary:
            case BSONTypes.Code:
            case BSONTypes.UUID:
            case BSONTypes.UUID_LEGACY:
                return 'string';

            case BSONTypes.Boolean:
                return 'boolean';

            case BSONTypes.Int32:
            case BSONTypes.Long:
            case BSONTypes.Double:
            case BSONTypes.Decimal128:
                return 'number';

            case BSONTypes.Object:
            case BSONTypes.Map:
            case BSONTypes.DBRef:
            case BSONTypes.CodeWithScope:
                return 'object';

            case BSONTypes.Array:
                return 'array';

            case BSONTypes.Null:
            case BSONTypes.Undefined:
            case BSONTypes.MinKey:
            case BSONTypes.MaxKey:
                return 'null';

            default:
                return 'string'; // Default to string for unknown types
        }
    }

    /**
     * Accepts a value from a MongoDB 'Document' object and returns the inferred type.
     * @param value The value of a field in a MongoDB 'Document' object
     * @returns
     */
    export function inferType(value: unknown): BSONTypes {
        if (value === null) return BSONTypes.Null;
        if (value === undefined) return BSONTypes.Undefined;

        switch (typeof value) {
            case 'string':
                return BSONTypes.String;
            case 'number':
                return BSONTypes.Double; // JavaScript numbers are doubles
            case 'boolean':
                return BSONTypes.Boolean;
            case 'object':
                if (Array.isArray(value)) {
                    return BSONTypes.Array;
                }

                // Check for common BSON types first
                if (value instanceof ObjectId) return BSONTypes.ObjectId;
                if (value instanceof Int32) return BSONTypes.Int32;
                if (value instanceof Double) return BSONTypes.Double;
                if (value instanceof Date) return BSONTypes.Date;
                if (value instanceof Timestamp) return BSONTypes.Timestamp;

                // Less common types
                if (value instanceof Decimal128) return BSONTypes.Decimal128;
                if (value instanceof Long) return BSONTypes.Long;
                if (value instanceof MinKey) return BSONTypes.MinKey;
                if (value instanceof MaxKey) return BSONTypes.MaxKey;
                if (value instanceof BSONSymbol) return BSONTypes.Symbol;
                if (value instanceof DBRef) return BSONTypes.DBRef;
                if (value instanceof Map) return BSONTypes.Map;
                if (value instanceof UUID && value.sub_type === Binary.SUBTYPE_UUID) return BSONTypes.UUID;
                if (value instanceof UUID && value.sub_type === Binary.SUBTYPE_UUID_OLD) return BSONTypes.UUID_LEGACY;
                if (value instanceof Buffer || value instanceof Binary) return BSONTypes.Binary;
                if (value instanceof RegExp) return BSONTypes.RegExp;
                if (value instanceof Code) {
                    if (value.scope) {
                        return BSONTypes.CodeWithScope;
                    } else {
                        return BSONTypes.Code;
                    }
                }

                // Default to Object if none of the above match
                return BSONTypes.Object;
            default:
                // This should never happen, but if it does, we'll catch it here
                // TODO: add telemetry somewhere to know when it happens (not here, this could get hit too often)
                return BSONTypes._UNKNOWN_;
        }
    }
}
