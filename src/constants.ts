/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const isWindows: boolean = /^win/.test(process.platform);
export const isLinux: boolean = /^linux/.test(process.platform);
export const isMacOS: boolean = /^darwin/.test(process.platform);

export namespace Links {
    export const LocalConnectionDebuggingTips: string = 'https://aka.ms/vscode-documentdb-local-connections';
}

export const doubleClickDebounceDelay = 500; //milliseconds

export const wellKnownEmulatorPassword =
    'C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==';

export const isEmulatorSupported = isWindows || isLinux || (isMacOS && process.arch === 'x64');

// https://docs.mongodb.com/manual/mongo/#working-with-the-mongo-shell
export const testDb: string = 'test';
