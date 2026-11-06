/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { redactReport } from './redact.js';

import { type DiagnosticsReport } from './types.js';

export function renderJson<TCode extends string>(
    report: DiagnosticsReport<TCode>,
    options: { redact: boolean; generatedBy?: Readonly<Record<string, string>> },
): string {
    const output = { ...(options.redact ? redactReport(report) : report) };
    Reflect.deleteProperty(output, 'identifierKeys');
    return JSON.stringify(
        {
            ...output,
            redacted: options.redact,
            ...(options.generatedBy === undefined ? {} : { generatedBy: options.generatedBy }),
        },
        null,
        2,
    );
}
