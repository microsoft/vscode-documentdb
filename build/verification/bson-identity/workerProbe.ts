/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Built with the real `webpack.config.ext.js` as the `playgroundWorker` entry. The worker thread has its
// own module graph, so identity is checked separately from the host.
import * as bson from 'bson';
import * as mongodb from 'mongodb';
import { esmBsonObjectId, esmMongodbObjectId } from './esmConsumer.mjs';

export function objectIdRoutes(): Record<string, unknown> {
    return {
        mongodb: mongodb.ObjectId,
        'bson (TypeScript, compiled like src/)': bson.ObjectId,
        'bson (ES module)': esmBsonObjectId,
        'mongodb (ES module)': esmMongodbObjectId,
    };
}
