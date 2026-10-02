/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module '*/vsix.cjs' {
    export function readVsix(filename: string): Map<string, Buffer>;
    export function extractVsix(filename: string, destination: string): void;
    export function writeVsix(filename: string, files: Map<string, Buffer>): void;
}
