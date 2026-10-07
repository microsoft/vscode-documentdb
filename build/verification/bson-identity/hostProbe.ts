/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Built with `vite.config.ext.mjs` as the `main` entry. Every route by which the extension
// host graph reaches `ObjectId` must yield the same constructor.
import { parse } from '@mongodb-js/shell-bson-parser';
import * as bson from 'bson';
import * as mongodb from 'mongodb';
import { esmBsonObjectId, esmMongodbObjectId } from './esmConsumer.mjs';

export function objectIdRoutes(): Record<string, unknown> {
    const parsed = parse('{ id: ObjectId("000000000000000000000000") }') as { id: object };
    return {
        mongodb: mongodb.ObjectId,
        'bson (TypeScript, compiled like src/)': bson.ObjectId,
        'bson (ES module)': esmBsonObjectId,
        'mongodb (ES module)': esmMongodbObjectId,
        '@mongodb-js/shell-bson-parser value': parsed.id.constructor,
    };
}
