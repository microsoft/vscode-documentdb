/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ext } from '../../extensionVariables';

/** Local-only diagnostics. Neither formatting nor an unavailable logger may affect the survey. */
export function traceSurvey(message: () => string): void {
    try {
        ext.outputChannel?.trace(message());
    } catch {
        // Diagnostics must not throw into successful features or hide product failures.
    }
}
