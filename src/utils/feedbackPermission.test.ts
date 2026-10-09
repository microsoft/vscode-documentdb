/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { affectsFeedbackPermission, isFeedbackPermitted, TELEMETRY_LEVEL_SETTING } from './feedbackPermission';

describe('isFeedbackPermitted', (): void => {
    const get = jest.fn<unknown, [string]>();

    beforeEach((): void => {
        get.mockReset();
        jest.spyOn(vscode.workspace, 'getConfiguration')
            .mockClear()
            .mockReturnValue({
                get,
            } as unknown as vscode.WorkspaceConfiguration);
    });

    afterEach((): void => {
        jest.restoreAllMocks();
    });

    it('permits feedback only at telemetry level all', (): void => {
        get.mockReturnValue('all');

        expect(isFeedbackPermitted()).toBe(true);
        expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith('telemetry');
        expect(get).toHaveBeenCalledWith('telemetryLevel');
    });

    it.each(['error', 'crash', 'off'])('denies feedback at telemetry level %s', (value): void => {
        get.mockReturnValue(value);

        expect(isFeedbackPermitted()).toBe(false);
    });

    it('denies feedback when the telemetry level is missing', (): void => {
        get.mockReturnValue(undefined);

        expect(isFeedbackPermitted()).toBe(false);
    });

    it.each(['ALL', 'everything'])('denies feedback for unrecognized telemetry level %s', (value): void => {
        get.mockReturnValue(value);

        expect(isFeedbackPermitted()).toBe(false);
    });

    it.each([true, 1])('denies feedback for non-string telemetry level %p', (value): void => {
        get.mockReturnValue(value);

        expect(isFeedbackPermitted()).toBe(false);
    });

    it('denies feedback when getConfiguration throws', (): void => {
        jest.spyOn(vscode.workspace, 'getConfiguration').mockImplementation((): never => {
            throw new Error('Configuration unavailable');
        });

        expect(isFeedbackPermitted()).toBe(false);
    });

    it('denies feedback when get throws', (): void => {
        get.mockImplementation((): never => {
            throw new Error('Telemetry level unavailable');
        });

        expect(isFeedbackPermitted()).toBe(false);
    });

    it('reads the current configuration on every call', (): void => {
        get.mockReturnValue('all');
        expect(isFeedbackPermitted()).toBe(true);

        get.mockReturnValue('off');
        expect(isFeedbackPermitted()).toBe(false);

        expect(vscode.workspace.getConfiguration).toHaveBeenCalledTimes(2);
        expect(get).toHaveBeenCalledTimes(2);
    });
});

describe('affectsFeedbackPermission', (): void => {
    it.each([true, false])('passes through affectsConfiguration returning %p', (affected): void => {
        const affectsConfiguration = jest.fn<boolean, [string]>().mockReturnValue(affected);
        const event: vscode.ConfigurationChangeEvent = { affectsConfiguration };

        expect(affectsFeedbackPermission(event)).toBe(affected);
        expect(TELEMETRY_LEVEL_SETTING).toBe('telemetry.telemetryLevel');
        expect(affectsConfiguration).toHaveBeenCalledWith('telemetry.telemetryLevel');
    });

    it('requests a permission recheck when affectsConfiguration throws', (): void => {
        const event: vscode.ConfigurationChangeEvent = {
            affectsConfiguration: jest.fn((): never => {
                throw new Error('Configuration change unavailable');
            }),
        };

        expect(affectsFeedbackPermission(event)).toBe(true);
    });
});
