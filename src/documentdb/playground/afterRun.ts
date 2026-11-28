/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type PlaygroundAfterRunSetting = 'auto' | 'stay' | 'focusResult' | 'notify';
export type PlaygroundAfterRunOutcome = 'stay' | 'focusResult' | 'notify';

export function resolveAfterRunOutcome(setting: unknown, screenReaderMode: boolean): PlaygroundAfterRunOutcome {
    if (setting === 'stay' || setting === 'focusResult' || setting === 'notify') {
        return setting;
    }
    return screenReaderMode ? 'focusResult' : 'stay';
}
