/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// TEMPORARY (modernization Stage 2): types for runnerRouting.cjs, used by vitest.config.ts.
export declare function isVitestFile(file: string): boolean;
export declare function jestIgnorePatterns(dir: string): string[];
export declare function listTestFiles(dir: string): string[];
export declare function vitestFiles(root: string, dir: string): string[];
