/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createKeyborg, disposeKeyborg } from 'keyborg';

export function focusWithVisibleIndicator(
    candidates: ReadonlyArray<HTMLElement | null | undefined>,
): HTMLElement | undefined {
    for (const candidate of candidates) {
        if (
            !candidate?.isConnected ||
            candidate.matches(':disabled') ||
            candidate.getAttribute('aria-disabled') === 'true'
        ) {
            continue;
        }

        candidate.focus();
        if (candidate.ownerDocument.activeElement !== candidate) {
            continue;
        }

        const targetWindow = candidate.ownerDocument.defaultView;
        if (targetWindow) {
            const keyborg = createKeyborg(targetWindow);
            try {
                keyborg.setVal(true);
            } finally {
                disposeKeyborg(keyborg);
            }
        }
        return candidate;
    }

    return undefined;
}
