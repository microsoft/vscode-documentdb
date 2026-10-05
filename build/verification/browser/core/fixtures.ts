/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AnyProcedure, type AnyRouter, type inferRouterInputs, type inferRouterOutputs } from '@trpc/server';
import { type AppRouter } from '../../../../src/webviews/_integration/appRouter';

export type FixtureInputs = inferRouterInputs<AppRouter>;
export type FixtureOutputs = inferRouterOutputs<AppRouter>;
type ProcedurePaths<T> = {
    [K in keyof T & string]: T[K] extends AnyProcedure ? K :
        T[K] extends AnyRouter ? `${K}.${ProcedurePaths<T[K]['_def']['record']>}` :
            T[K] extends Record<string, unknown> ? `${K}.${ProcedurePaths<T[K]>}` : never;
}[keyof T & string];
export type FixturePaths = ProcedurePaths<AppRouter['_def']['record']>;

export interface RpcFixture {
    readonly type: 'query' | 'mutation' | 'subscription';
    readonly results: readonly unknown[];
    readonly keepOpen?: boolean;
    readonly undefinedResult?: boolean;
}

export type RpcFixtures = Readonly<Partial<Record<FixturePaths, RpcFixture>>>;

export function isRpcFixture(value: unknown): value is RpcFixture {
    return typeof value === 'object' && value !== null && 'type' in value &&
        (value.type === 'query' || value.type === 'mutation' || value.type === 'subscription') &&
        'results' in value && Array.isArray(value.results) &&
        (!('keepOpen' in value) || value.keepOpen === undefined || typeof value.keepOpen === 'boolean') &&
        (!('undefinedResult' in value) || value.undefinedResult === undefined || typeof value.undefinedResult === 'boolean');
}
