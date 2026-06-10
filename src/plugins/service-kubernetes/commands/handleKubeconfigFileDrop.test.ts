/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const mockLoadKubeConfig = jest.fn();
const mockGetContexts = jest.fn();
const mockAddFileSource = jest.fn();
const mockRefreshKubernetesRoot = jest.fn();
const mockRevealKubernetesSource = jest.fn();
const mockShowInformationMessage = jest.fn();
const mockShowWarningMessage = jest.fn();
const mockOutputAppendLine = jest.fn();
const mockOutputError = jest.fn();
const mockOutputWarn = jest.fn();
const mockStat = jest.fn();

jest.mock('vscode', () => ({
    ThemeIcon: class ThemeIcon {
        constructor(public readonly id: string) {}
    },
    l10n: {
        t: jest.fn((message: string, ...args: string[]) =>
            args.reduce<string>((acc, value, index) => acc.replace(`{${String(index)}}`, value), message),
        ),
    },
    window: {
        showInformationMessage: (...args: unknown[]) => mockShowInformationMessage(...args),
        showWarningMessage: (...args: unknown[]) => mockShowWarningMessage(...args),
    },
}));

jest.mock('fs', () => ({
    promises: {
        stat: (...args: unknown[]) => mockStat(...args),
    },
}));

let lastTelemetryContext:
    | {
          telemetry: {
              properties: Record<string, string | undefined>;
              measurements: Record<string, number | undefined>;
          };
      }
    | undefined;

jest.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: jest.fn(
        async (_callbackId: string, callback: (ctx: unknown) => Promise<unknown>) => {
            const ctx = {
                telemetry: {
                    properties: {} as Record<string, string | undefined>,
                    measurements: {} as Record<string, number | undefined>,
                },
                errorHandling: { issueProperties: {} },
                ui: undefined,
                valuesToMask: [],
            };
            lastTelemetryContext = ctx;
            return callback(ctx);
        },
    ),
}));

jest.mock('../../../extensionVariables', () => ({
    ext: {
        outputChannel: {
            appendLine: (...args: unknown[]) => mockOutputAppendLine(...args),
            error: (...args: unknown[]) => mockOutputError(...args),
            warn: (...args: unknown[]) => mockOutputWarn(...args),
        },
    },
}));

jest.mock('../kubernetesClient', () => ({
    loadKubeConfig: (...args: unknown[]) => mockLoadKubeConfig(...args),
    getContexts: (...args: unknown[]) => mockGetContexts(...args),
}));

jest.mock('../sources/sourceStore', () => ({
    tryAddFileSource: (...args: unknown[]) => mockAddFileSource(...args),
}));

jest.mock('./refreshKubernetesRoot', () => ({
    refreshKubernetesRoot: (...args: unknown[]) => mockRefreshKubernetesRoot(...args),
    revealKubernetesSource: (...args: unknown[]) => mockRevealKubernetesSource(...args),
}));

import { handleKubeconfigFileDrop } from './handleKubeconfigFileDrop';

function fileUri(absolutePath: string): { scheme: string; fsPath: string } {
    return { scheme: 'file', fsPath: absolutePath };
}

beforeEach(() => {
    mockLoadKubeConfig.mockReset();
    mockGetContexts.mockReset();
    mockAddFileSource.mockReset();
    mockRefreshKubernetesRoot.mockReset();
    mockRevealKubernetesSource.mockReset();
    mockShowInformationMessage.mockReset();
    mockShowWarningMessage.mockReset();
    mockOutputAppendLine.mockReset();
    mockOutputError.mockReset();
    mockOutputWarn.mockReset();
    mockStat.mockReset();
    lastTelemetryContext = undefined;
});

/**
 * Convenience to build the `{ record, created }` shape that addFileSource now
 * returns. `created: true` is the default ("newly added") path; tests that
 * want to exercise the dedup branch pass `created: false`.
 */
function added(id: string, label: string): { record: { id: string; label: string }; created: true } {
    return { record: { id, label }, created: true };
}
function existing(id: string, label: string): { record: { id: string; label: string }; created: false } {
    return { record: { id, label }, created: false };
}

describe('handleKubeconfigFileDrop', () => {
    it('adds a single valid kubeconfig and refreshes/reveals it', async () => {
        mockStat.mockResolvedValue({ isFile: () => true });
        mockLoadKubeConfig.mockResolvedValue({});
        mockGetContexts.mockReturnValue([{ name: 'ctx-1' }]);
        mockAddFileSource.mockResolvedValue(added('src-1', 'team.yaml'));
        mockRevealKubernetesSource.mockResolvedValue(undefined);

        await handleKubeconfigFileDrop([fileUri('/abs/team.yaml')] as never);

        expect(mockLoadKubeConfig).toHaveBeenCalledWith('/abs/team.yaml');
        expect(mockAddFileSource).toHaveBeenCalledWith('/abs/team.yaml');
        expect(mockRefreshKubernetesRoot).toHaveBeenCalledTimes(1);
        expect(mockRevealKubernetesSource).toHaveBeenCalledWith('src-1');
        // Toast must include the source label (consistency with the wizard pattern).
        expect(mockShowInformationMessage).toHaveBeenCalledTimes(1);
        const successMessage = mockShowInformationMessage.mock.calls[0][0] as string;
        expect(successMessage).toContain('team.yaml');
        expect(mockShowWarningMessage).not.toHaveBeenCalled();
    });

    it('uses the plural success toast when multiple sources are added', async () => {
        mockStat.mockResolvedValue({ isFile: () => true });
        mockLoadKubeConfig.mockResolvedValue({});
        mockGetContexts.mockReturnValue([{ name: 'ctx' }]);
        mockAddFileSource.mockResolvedValueOnce(added('a', 'a.yaml')).mockResolvedValueOnce(added('b', 'b.yaml'));
        mockRevealKubernetesSource.mockResolvedValue(undefined);

        await handleKubeconfigFileDrop([fileUri('/a.yaml'), fileUri('/b.yaml')] as never);

        expect(mockAddFileSource).toHaveBeenCalledTimes(2);
        expect(mockShowInformationMessage).toHaveBeenCalledTimes(1);
        const message = mockShowInformationMessage.mock.calls[0][0] as string;
        expect(message).toMatch(/2 kubeconfig sources/);
        // Reveal targets the FIRST added source so the user immediately sees the result.
        expect(mockRevealKubernetesSource).toHaveBeenCalledWith('a');
    });

    it('skips a directory with a per-file warning and does not refresh', async () => {
        mockStat.mockResolvedValue({ isFile: () => false });

        await handleKubeconfigFileDrop([fileUri('/some/dir')] as never);

        expect(mockShowWarningMessage).toHaveBeenCalledTimes(1);
        expect(mockShowWarningMessage.mock.calls[0][0]).toMatch(/not a regular file/);
        expect(mockAddFileSource).not.toHaveBeenCalled();
        expect(mockRefreshKubernetesRoot).not.toHaveBeenCalled();
    });

    it('skips a file whose stat fails (e.g., missing or unreadable)', async () => {
        mockStat.mockRejectedValue(new Error('ENOENT: no such file'));

        await handleKubeconfigFileDrop([fileUri('/missing.yaml')] as never);

        expect(mockShowWarningMessage).toHaveBeenCalledTimes(1);
        expect(mockShowWarningMessage.mock.calls[0][0]).toMatch(/Cannot read "missing.yaml": ENOENT/);
        expect(mockOutputWarn).toHaveBeenCalled();
        expect(mockAddFileSource).not.toHaveBeenCalled();
    });

    it('skips a file with no Kubernetes contexts', async () => {
        mockStat.mockResolvedValue({ isFile: () => true });
        mockLoadKubeConfig.mockResolvedValue({});
        mockGetContexts.mockReturnValue([]);

        await handleKubeconfigFileDrop([fileUri('/empty.yaml')] as never);

        expect(mockShowWarningMessage).toHaveBeenCalledTimes(1);
        expect(mockShowWarningMessage.mock.calls[0][0]).toMatch(/does not contain any Kubernetes contexts/);
        expect(mockAddFileSource).not.toHaveBeenCalled();
        expect(mockRefreshKubernetesRoot).not.toHaveBeenCalled();
    });

    it('skips a file that fails to parse as a kubeconfig and logs the reason', async () => {
        mockStat.mockResolvedValue({ isFile: () => true });
        mockLoadKubeConfig.mockRejectedValue(new Error('YAML syntax error at line 3'));

        await handleKubeconfigFileDrop([fileUri('/garbage.yaml')] as never);

        expect(mockShowWarningMessage).toHaveBeenCalledTimes(1);
        expect(mockShowWarningMessage.mock.calls[0][0]).toMatch(/is not a valid kubeconfig/);
        expect(mockOutputError).toHaveBeenCalled();
        const logged = mockOutputError.mock.calls[0][0] as string;
        expect(logged).toContain('/garbage.yaml');
        expect(logged).toContain('YAML syntax error');
        expect(mockAddFileSource).not.toHaveBeenCalled();
    });

    it('continues processing remaining files when one in the batch is invalid', async () => {
        mockStat.mockResolvedValue({ isFile: () => true });
        mockLoadKubeConfig
            .mockResolvedValueOnce({})
            .mockRejectedValueOnce(new Error('bad yaml'))
            .mockResolvedValueOnce({});
        mockGetContexts.mockReturnValueOnce([{ name: 'a' }]).mockReturnValueOnce([{ name: 'c' }]);
        mockAddFileSource
            .mockResolvedValueOnce(added('src-a', 'a.yaml'))
            .mockResolvedValueOnce(added('src-c', 'c.yaml'));
        mockRevealKubernetesSource.mockResolvedValue(undefined);

        await handleKubeconfigFileDrop([fileUri('/a.yaml'), fileUri('/b.yaml'), fileUri('/c.yaml')] as never);

        expect(mockAddFileSource).toHaveBeenCalledTimes(2);
        expect(mockAddFileSource).toHaveBeenNthCalledWith(1, '/a.yaml');
        expect(mockAddFileSource).toHaveBeenNthCalledWith(2, '/c.yaml');
        // One warning for the invalid middle file.
        expect(mockShowWarningMessage).toHaveBeenCalledTimes(1);
        expect(mockRefreshKubernetesRoot).toHaveBeenCalledTimes(1);
    });

    it('ignores non-file scheme URIs in the input', async () => {
        // No file: schemes => nothing to do
        await handleKubeconfigFileDrop([
            { scheme: 'http', fsPath: 'http://example.com/x' },
            { scheme: 'untitled', fsPath: 'untitled' },
        ] as never);

        expect(mockStat).not.toHaveBeenCalled();
        expect(mockAddFileSource).not.toHaveBeenCalled();
        expect(mockRefreshKubernetesRoot).not.toHaveBeenCalled();
    });

    it('does not throw when the cosmetic reveal call fails', async () => {
        mockStat.mockResolvedValue({ isFile: () => true });
        mockLoadKubeConfig.mockResolvedValue({});
        mockGetContexts.mockReturnValue([{ name: 'ctx' }]);
        mockAddFileSource.mockResolvedValue(added('src-x', 'x.yaml'));
        mockRevealKubernetesSource.mockRejectedValue(new Error('tree not ready'));

        await expect(handleKubeconfigFileDrop([fileUri('/x.yaml')] as never)).resolves.toBeUndefined();

        expect(mockRefreshKubernetesRoot).toHaveBeenCalledTimes(1);
    });

    it('treats a re-dropped already-registered file as a no-op (no toast, no refresh)', async () => {
        // addFileSource reports the dup via `created: false` — race-safe single
        // source of truth (no snapshot of the cache that another flow could
        // race against).
        mockStat.mockResolvedValue({ isFile: () => true });
        mockLoadKubeConfig.mockResolvedValue({});
        mockGetContexts.mockReturnValue([{ name: 'ctx-1' }]);
        mockAddFileSource.mockResolvedValue(existing('pre-existing', 'team.yaml'));

        await handleKubeconfigFileDrop([fileUri('/abs/team.yaml')] as never);

        // addFileSource IS called (it has to be, to learn whether the file was
        // already registered), but nothing user-visible changes.
        expect(mockAddFileSource).toHaveBeenCalledTimes(1);
        expect(mockShowInformationMessage).not.toHaveBeenCalled();
        expect(mockRefreshKubernetesRoot).not.toHaveBeenCalled();
        expect(mockRevealKubernetesSource).not.toHaveBeenCalled();
        // One audit-trail line in the output channel.
        expect(mockOutputAppendLine).toHaveBeenCalledTimes(1);
        expect(mockOutputAppendLine.mock.calls[0][0] as string).toMatch(/already registered/);
    });

    it('counts a duplicate URI appearing twice in the same drop payload only once', async () => {
        mockStat.mockResolvedValue({ isFile: () => true });
        mockLoadKubeConfig.mockResolvedValue({});
        mockGetContexts.mockReturnValue([{ name: 'ctx' }]);
        // First call to addFileSource for the same path creates it; the second
        // call (same payload, same path) sees the just-created record.
        mockAddFileSource
            .mockResolvedValueOnce(added('src-1', 'team.yaml'))
            .mockResolvedValueOnce(existing('src-1', 'team.yaml'));
        mockRevealKubernetesSource.mockResolvedValue(undefined);

        await handleKubeconfigFileDrop([fileUri('/abs/team.yaml'), fileUri('/abs/team.yaml')] as never);

        expect(mockAddFileSource).toHaveBeenCalledTimes(2);
        expect(mockShowInformationMessage).toHaveBeenCalledTimes(1);
        // Singular toast (1 actually added, not 2).
        const message = mockShowInformationMessage.mock.calls[0][0] as string;
        expect(message).toContain('team.yaml');
        expect(message).not.toMatch(/2 kubeconfig sources/);
    });

    it('separates added vs already-registered when a batch mixes both', async () => {
        mockStat.mockResolvedValue({ isFile: () => true });
        mockLoadKubeConfig.mockResolvedValue({});
        mockGetContexts.mockReturnValue([{ name: 'ctx' }]);
        // First file is a dup, second is new — exercises the partial-success
        // path where refresh+reveal still need to fire.
        mockAddFileSource
            .mockResolvedValueOnce(existing('pre-existing', 'a.yaml'))
            .mockResolvedValueOnce(added('src-b', 'b.yaml'));
        mockRevealKubernetesSource.mockResolvedValue(undefined);

        await handleKubeconfigFileDrop([fileUri('/a.yaml'), fileUri('/b.yaml')] as never);

        expect(mockAddFileSource).toHaveBeenCalledTimes(2);
        // Singular toast: only one new file was actually added.
        expect(mockShowInformationMessage).toHaveBeenCalledTimes(1);
        expect(mockShowInformationMessage.mock.calls[0][0] as string).toContain('b.yaml');
        // Refresh runs because something was actually added.
        expect(mockRefreshKubernetesRoot).toHaveBeenCalledTimes(1);
        expect(mockRevealKubernetesSource).toHaveBeenCalledWith('src-b');
        // Telemetry must distinguish the two outcomes so dashboards can tell
        // "user re-dropped a file" from "user added a new file".
        expect(lastTelemetryContext?.telemetry.measurements.fileCount).toBe(2);
        expect(lastTelemetryContext?.telemetry.measurements.addedCount).toBe(1);
        expect(lastTelemetryContext?.telemetry.measurements.alreadyRegisteredCount).toBe(1);
    });
});
