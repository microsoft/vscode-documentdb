/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type IActionContext, type ITelemetryContext } from '@microsoft/vscode-azext-utils';
import { InstanceState } from '../../../services/localQuickStart/quickStartTypes';
import {
    createWizardSession,
    reportWizardClosed,
    reportWizardDetailsOpened,
    reportWizardStep,
} from './wizardTelemetry';

const mockEvents: Array<{ readonly eventName: string; readonly telemetry: ITelemetryContext }> = [];

vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn((eventName: string, callback: (context: IActionContext) => unknown) => {
        const context = {
            telemetry: { properties: {}, measurements: {} },
            errorHandling: {},
        } as unknown as IActionContext;
        mockEvents.push({ eventName, telemetry: context.telemetry });
        return Promise.resolve(callback(context));
    }),
}));

vi.mock('../../../services/localQuickStart/QuickStartService', () => ({
    QuickStartService: { getStatus: () => ({ state: 'CredentialsMissing' }) },
}));

describe('wizard telemetry', () => {
    beforeEach(() => {
        mockEvents.length = 0;
    });

    it('reports each step change with the time spent on the step it left', () => {
        const session = createWizardSession('session-1', 'configure', 1_000);

        reportWizardStep(session, 'provisioning', 'startSetup', 4_000);
        reportWizardStep(session, 'provisioning', 'auto', 5_000);
        reportWizardStep(session, 'failed', 'auto', 9_000);

        expect(mockEvents.map((event) => event.eventName)).toEqual([
            'documentDB.quickstart.wizard.step',
            'documentDB.quickstart.wizard.step',
        ]);
        expect(mockEvents[0].telemetry).toMatchObject({
            properties: {
                quickStartSessionId: 'session-1',
                fromStep: 'configure',
                toStep: 'provisioning',
                trigger: 'startSetup',
                instanceState: InstanceState.CredentialsMissing,
            },
            measurements: { timeOnFromStepMs: 3_000, stepChangeIndex: 1 },
        });
        expect(mockEvents[1].telemetry.measurements).toMatchObject({ timeOnFromStepMs: 5_000, stepChangeIndex: 2 });
    });

    it('reports where the journey ended when the panel closes', () => {
        const session = createWizardSession('session-1', 'introduction', 1_000);
        reportWizardStep(session, 'configure', 'next', 2_000);
        session.setupAttemptCount = 2;

        reportWizardClosed(session, 10_000);

        expect(mockEvents.at(-1)).toMatchObject({
            eventName: 'documentDB.quickstart.wizard.close',
            telemetry: {
                properties: {
                    quickStartSessionId: 'session-1',
                    initialStep: 'introduction',
                    lastStep: 'configure',
                    closeReason: 'panelClosed',
                    setupSucceeded: 'false',
                    detailsOpenedStages: 'none',
                },
                measurements: {
                    sessionDurationMs: 9_000,
                    timeOnLastStepMs: 8_000,
                    stepChangeCount: 1,
                    setupAttemptCount: 2,
                    waitLongerCount: 0,
                    detailsOpenCount: 0,
                },
            },
        });
    });

    it('aggregates unique sorted stages and total expansions only when the session closes', () => {
        const session = createWizardSession('session-1', 'configure', 1_000);

        reportWizardDetailsOpened(session, 'waiting');
        reportWizardDetailsOpened(session, 'pulling');
        reportWizardDetailsOpened(session, 'checking');
        reportWizardDetailsOpened(session, 'waiting');
        reportWizardDetailsOpened(session, 'starting');
        reportWizardDetailsOpened(session, 'creating');

        expect(mockEvents).toEqual([]);
        reportWizardClosed(session, 10_000);

        expect(mockEvents).toHaveLength(1);
        expect(mockEvents[0]).toMatchObject({
            eventName: 'documentDB.quickstart.wizard.close',
            telemetry: {
                properties: { detailsOpenedStages: 'checking,creating,pulling,starting,waiting' },
                measurements: { detailsOpenCount: 6 },
            },
        });
    });

    it('retains usage across setup attempts and includes expansions on Done', () => {
        const session = createWizardSession('session-1', 'provisioning', 1_000);
        session.setupAttemptCount++;
        reportWizardDetailsOpened(session, 'checking');
        reportWizardStep(session, 'failed', 'auto', 2_000);
        reportWizardStep(session, 'provisioning', 'startSetup', 3_000);
        session.setupAttemptCount++;
        reportWizardDetailsOpened(session, 'checking');
        reportWizardStep(session, 'success', 'auto', 4_000);
        session.setupSucceeded = true;
        reportWizardDetailsOpened(session, 'waiting');

        expect(mockEvents.every((event) => event.eventName === 'documentDB.quickstart.wizard.step')).toBe(true);
        expect(mockEvents.every((event) => event.telemetry.properties.detailsOpenedStages === undefined)).toBe(true);
        expect(mockEvents.every((event) => event.telemetry.measurements.detailsOpenCount === undefined)).toBe(true);
        reportWizardClosed(session, 5_000);

        expect(mockEvents.at(-1)?.telemetry).toMatchObject({
            properties: { lastStep: 'success', setupSucceeded: 'true', detailsOpenedStages: 'checking,waiting' },
            measurements: { setupAttemptCount: 2, detailsOpenCount: 3 },
        });
        const nextSession = createWizardSession('session-2');
        expect(nextSession.detailsOpenedStages.size).toBe(0);
        expect(nextSession.detailsOpenCount).toBe(0);
    });
});
