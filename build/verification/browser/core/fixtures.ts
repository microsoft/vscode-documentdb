/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AnyProcedure, type AnyRouter, type inferRouterInputs, type inferRouterOutputs } from '@trpc/server';
import { type AppRouter } from '../../../../src/webviews/_integration/appRouter';

export type FixtureInputs = inferRouterInputs<AppRouter>;
export type FixtureOutputs = inferRouterOutputs<AppRouter>;
type ProcedurePaths<T> = {
    [K in keyof T & string]: T[K] extends AnyProcedure
        ? K
        : T[K] extends AnyRouter
          ? `${K}.${ProcedurePaths<T[K]['_def']['record']>}`
          : T[K] extends Record<string, unknown>
            ? `${K}.${ProcedurePaths<T[K]>}`
            : never;
}[keyof T & string];
export type FixturePaths = ProcedurePaths<AppRouter['_def']['record']>;

export interface RpcFixture {
    readonly type: 'query' | 'mutation' | 'subscription';
    readonly results: readonly unknown[];
    readonly keepOpen?: boolean;
    readonly undefinedResult?: boolean;
    readonly holdReply?: boolean;
    readonly afterFirst?: { readonly results: readonly unknown[]; readonly holdReply?: boolean };
}

export type RpcFixtures = Readonly<Partial<Record<FixturePaths, RpcFixture>>>;

export type FixtureAtPath<T, P extends string> = P extends `${infer Head}.${infer Tail}`
    ? Head extends keyof T
        ? FixtureAtPath<T[Head], Tail>
        : never
    : P extends keyof T
      ? T[P]
      : never;

type StreamItem<T> = T extends AsyncIterable<infer Item> ? Item : T;
// tRPC infers never for void outputs, but the extension host sends null for those results.
type FixtureResult<T> = [T] extends [never] ? void | null : StreamItem<T>;
export type TypedRpcFixtures = {
    readonly [P in FixturePaths]?: Omit<RpcFixture, 'results' | 'afterFirst'> & {
        readonly results: readonly FixtureResult<FixtureAtPath<FixtureOutputs, P>>[];
        readonly afterFirst?: {
            readonly results: readonly FixtureResult<FixtureAtPath<FixtureOutputs, P>>[];
            readonly holdReply?: boolean;
        };
    };
};

export function isRpcFixture(value: unknown): value is RpcFixture {
    return (
        typeof value === 'object' &&
        value !== null &&
        'type' in value &&
        (value.type === 'query' || value.type === 'mutation' || value.type === 'subscription') &&
        'results' in value &&
        Array.isArray(value.results) &&
        (!('keepOpen' in value) || value.keepOpen === undefined || typeof value.keepOpen === 'boolean') &&
        (!('undefinedResult' in value) ||
            value.undefinedResult === undefined ||
            typeof value.undefinedResult === 'boolean')
    );
}
