/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ext } from '../../extensionVariables';
import { traceSurvey } from './surveyDiagnostics';

describe('survey diagnostics safety', (): void => {
    let originalOutputChannel: typeof ext.outputChannel;

    beforeEach((): void => {
        originalOutputChannel = ext.outputChannel;
    });

    afterEach((): void => {
        ext.outputChannel = originalOutputChannel;
    });

    it('does not format or throw before the output channel is initialized', (): void => {
        ext.outputChannel = undefined as unknown as typeof ext.outputChannel;
        const message = jest.fn((): string => '[Survey] Test.');
        expect((): void => traceSurvey(message)).not.toThrow();
        expect(message).not.toHaveBeenCalled();
    });

    it('uses only the trace level on the existing output channel', (): void => {
        const trace = jest.fn();
        const info = jest.fn();
        const error = jest.fn();
        ext.outputChannel = { trace, info, error } as unknown as typeof ext.outputChannel;
        traceSurvey((): string => '[Survey] Test.');
        expect(trace.mock.calls).toEqual([['[Survey] Test.']]);
        expect(info).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
    });

    it('contains formatting and logging failures', (): void => {
        const trace = jest.fn((): never => {
            throw new Error('logger unavailable');
        });
        ext.outputChannel = { trace } as unknown as typeof ext.outputChannel;
        expect((): void => traceSurvey((): string => '[Survey] Test.')).not.toThrow();
        expect((): void =>
            traceSurvey((): never => {
                throw new Error('localization unavailable');
            }),
        ).not.toThrow();
        expect(trace).toHaveBeenCalledTimes(1);
    });
});
