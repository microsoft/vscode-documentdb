/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Stands for any ES module in a graph (our ESM-only workspace packages, ESM dependencies). webpack
// resolves its `bson` request with the `import` condition, which without the alias selects
// `bson/lib/bson.node.mjs` instead of the driver's `bson/lib/bson.cjs`.
import { ObjectId as BsonObjectId } from 'bson';
import { ObjectId as MongodbObjectId } from 'mongodb';

export const esmBsonObjectId = BsonObjectId;
export const esmMongodbObjectId = MongodbObjectId;
