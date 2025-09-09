/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export class CaseInsensitiveMap<V> extends Map<string, V> {
    set(key: string, value: V): this {
        return super.set(key.toLowerCase(), value);
    }

    get(key: string): V | undefined {
        return super.get(key.toLowerCase());
    }

    has(key: string): boolean {
        return super.has(key.toLowerCase());
    }

    delete(key: string): boolean {
        return super.delete(key.toLowerCase());
    }
}
