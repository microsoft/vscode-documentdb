/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IDisposable } from '../vscodeUtils';

/**
 * Add a set of environment variables, and return to the previous values after disposing the result
 */
export function setEnvironmentVariables(env: { [key: string]: string }): IDisposable {
    const setRestoreEnv = new SetRestoreEnv();
    setRestoreEnv.set(env);
    return setRestoreEnv;
}

class SetRestoreEnv implements IDisposable {
    private _previousValues: { [key: string]: string | undefined } = {};

    public set(env: { [key: string]: string }): void {
        for (const key of Object.keys(env || {})) {
            [this._previousValues[key], process.env[key]] = [process.env[key], env[key]];
        }
    }

    public restore(): void {
        for (const key of Object.keys(this._previousValues)) {
            const previousValue = this._previousValues[key];
            if (previousValue === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = previousValue;
            }
        }
    }

    public dispose(): void {
        this.restore();
    }
}
