/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface TreeElementWithExplicitReload {
    prepareExplicitReload(): void;
}

export function isTreeElementWithExplicitReload(value: unknown): value is TreeElementWithExplicitReload {
    return (
        typeof value === 'object' &&
        value !== null &&
        'prepareExplicitReload' in value &&
        typeof value.prepareExplicitReload === 'function'
    );
}
