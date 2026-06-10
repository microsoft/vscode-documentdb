/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const mockShowInputBox = jest.fn();
const mockGetConfiguration = jest.fn();
const mockCreateServer = jest.fn();

jest.mock('vscode', () => ({
    window: {
        showInputBox: (...args: unknown[]) => mockShowInputBox(...args),
    },
    workspace: {
        getConfiguration: (...args: unknown[]) => mockGetConfiguration(...args),
    },
    l10n: {
        t: jest.fn((message: string, ...values: string[]) =>
            values.reduce<string>((acc, value, index) => acc.replace(`{${String(index)}}`, value), message),
        ),
    },
}));

jest.mock('net', () => ({
    createServer: (...args: unknown[]) => mockCreateServer(...args),
}));

import { type KubeServiceInfo } from './kubernetesClient';
import { promptForLocalPort } from './promptForLocalPort';

interface InputBoxOptions {
    readonly value?: string;
    readonly validateInput?: (value: string) => string | undefined;
}

type ErrorListener = () => void;

function createService(port = 10260): KubeServiceInfo {
    return {
        sourceKind: 'dko',
        name: 'documentdb-service',
        displayName: 'DocumentDB Service',
        serviceName: 'documentdb-service',
        namespace: 'default',
        type: 'ClusterIP',
        port,
    };
}

function setConfiguration(values: Record<string, unknown>): void {
    mockGetConfiguration.mockReturnValue({
        get: (key: string, defaultValue: unknown) =>
            Object.prototype.hasOwnProperty.call(values, key) ? values[key] : defaultValue,
    });
}

function createMockServer(portAvailability: ReadonlyMap<number, boolean>): {
    once: jest.Mock;
    listen: jest.Mock;
    close: jest.Mock;
} {
    let errorListener: ErrorListener | undefined;
    const server = {
        once: jest.fn((_event: 'error', listener: ErrorListener) => {
            errorListener = listener;
            return server;
        }),
        listen: jest.fn((port: number, _host: string, callback: () => void) => {
            if (portAvailability.get(port) === false) {
                errorListener?.();
                return server;
            }

            callback();
            return server;
        }),
        close: jest.fn((callback: () => void) => {
            callback();
            return server;
        }),
    };
    return server;
}

function getInputOptions(): InputBoxOptions {
    return mockShowInputBox.mock.calls[0][0] as InputBoxOptions;
}

describe('promptForLocalPort', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setConfiguration({});
        mockShowInputBox.mockResolvedValue('10260');
        mockCreateServer.mockImplementation(() => createMockServer(new Map()));
    });

    it('uses the remote service port by default with matchRemote strategy', async () => {
        setConfiguration({
            'portForward.localPortStrategy': 'matchRemote',
        });

        await promptForLocalPort(createService(10260));

        expect(getInputOptions().value).toBe('10260');
        expect(mockCreateServer).not.toHaveBeenCalled();
    });

    it('uses the first available port from localPortBase with autoSelect strategy', async () => {
        setConfiguration({
            'portForward.localPortStrategy': 'autoSelect',
            'portForward.localPortBase': 27100,
        });
        mockCreateServer.mockImplementation(() =>
            createMockServer(
                new Map([
                    [27100, false],
                    [27101, false],
                    [27102, true],
                ]),
            ),
        );

        await promptForLocalPort(createService(10260));

        expect(getInputOptions().value).toBe('27102');
    });

    it('falls back to the default base port when localPortBase is invalid', async () => {
        setConfiguration({
            'portForward.localPortStrategy': 'autoSelect',
            'portForward.localPortBase': 100,
        });

        await promptForLocalPort(createService(10260));

        expect(getInputOptions().value).toBe('27100');
    });

    it('falls back to the remote service port when no port is available in the scan window', async () => {
        setConfiguration({
            'portForward.localPortStrategy': 'autoSelect',
            'portForward.localPortBase': 27100,
        });
        mockCreateServer.mockImplementation(() => {
            const busyPorts = Array.from({ length: 100 }, (_value, index) => [27100 + index, false] as const);
            return createMockServer(new Map(busyPorts));
        });

        await promptForLocalPort(createService(10260));

        expect(getInputOptions().value).toBe('10260');
        expect(mockCreateServer).toHaveBeenCalledTimes(100);
    });

    it('returns undefined when the user cancels the prompt', async () => {
        mockShowInputBox.mockResolvedValue(undefined);

        await expect(promptForLocalPort(createService(10260))).resolves.toBeUndefined();
    });

    it('validates local port input range', async () => {
        await promptForLocalPort(createService(10260));

        expect(getInputOptions().validateInput?.('0')).toBe('Enter a valid port number (1-65535)');
        expect(getInputOptions().validateInput?.('65536')).toBe('Enter a valid port number (1-65535)');
        expect(getInputOptions().validateInput?.('10260')).toBeUndefined();
    });
});
