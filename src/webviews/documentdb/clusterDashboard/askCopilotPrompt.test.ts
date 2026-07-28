/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { buildAskCopilotPrompt, type OperationPromptInput } from './askCopilotPrompt';

function operation(overrides: Partial<OperationPromptInput> = {}): OperationPromptInput {
    return {
        opid: '10000053116:1785197164497492',
        type: 'command',
        namespace: 'analytics.events',
        commandPreview: '{"aggregate":"events","pipeline":[{"$lookup":{}}]}',
        secsRunning: 42,
        clientDescription: '127.0.0.1:1234',
        ended: false,
        ...overrides,
    };
}

const VCORE_METADATA: Record<string, string | undefined> = {
    serverInfo_version: '8.0.0',
    topology_type: 'isdbgrid',
    topology_hello_internal_kind: 'azuredocumentdb',
    domainInfo_api: 'vCore',
};

describe('buildAskCopilotPrompt', () => {
    it('carries the operation, cluster identity and command into the prompt', () => {
        const prompt = buildAskCopilotPrompt('demo-cluster', VCORE_METADATA, operation());

        expect(prompt).toContain('demo-cluster');
        expect(prompt).toContain('10000053116:1785197164497492');
        expect(prompt).toContain('analytics.events');
        expect(prompt).toContain('42 s');
        expect(prompt).toContain('{"aggregate":"events"');
        expect(prompt).toContain('Azure DocumentDB (vCore)');
        expect(prompt).toContain('8.0.0');
        expect(prompt).toContain('sharded');
    });

    it('warns the model which commands vCore rejects', () => {
        // Without this the model recommends the classic MongoDB toolbox — `top`, the
        // profiler — and half of it fails on the platform the user is actually on.
        const prompt = buildAskCopilotPrompt('demo-cluster', VCORE_METADATA, operation());

        expect(prompt).toContain('`serverStatus`, `top`, `latencyStats` and the profiler are NOT available');
        expect(prompt).toContain('Operation ids are strings');
    });

    it('omits the platform notes for a server that is not vCore', () => {
        const prompt = buildAskCopilotPrompt(
            'local-emulator',
            { serverInfo_version: '7.0.0' },
            operation({ opid: '42' }),
        );

        expect(prompt).not.toContain('NOT available');
        expect(prompt).not.toContain('Azure DocumentDB');
        expect(prompt).toContain('7.0.0');
    });

    it('asks about prevention rather than killing when the operation already ended', () => {
        const prompt = buildAskCopilotPrompt('demo-cluster', VCORE_METADATA, operation({ ended: true }));

        expect(prompt).toContain('already finished');
        expect(prompt).toContain('faster next time');
        expect(prompt).not.toContain('terminating it with `killOp` would be safe');
    });

    it('says so when the server reported no command document', () => {
        const prompt = buildAskCopilotPrompt('demo-cluster', VCORE_METADATA, operation({ commandPreview: '' }));

        expect(prompt).toContain('did not report the command document');
        expect(prompt).not.toContain('```json');
    });

    it('does not fabricate fields the server left out', () => {
        const prompt = buildAskCopilotPrompt(
            'demo-cluster',
            {},
            operation({ opid: '', namespace: '', secsRunning: null, clientDescription: null }),
        );

        expect(prompt).toContain('(not reported)');
        expect(prompt).toContain('(none reported)');
        expect(prompt).toContain('Runtime: not reported by the server');
        expect(prompt).not.toContain('Client:');
    });
});
