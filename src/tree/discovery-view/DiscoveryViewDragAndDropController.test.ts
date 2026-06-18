/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const mockHandleKubeconfigFileDrop = jest.fn();
const mockShowErrorMessage = jest.fn();

jest.mock('vscode', () => ({
    Uri: {
        parse: (value: string, _strict?: boolean) => {
            // Minimal URI parser that mimics the shape DiscoveryViewDragAndDropController
            // depends on (`scheme` + `authority` + `path` + `fsPath`). Strict mode rejects
            // anything without an explicit scheme to match real Uri.parse behavior used by
            // the SUT.
            const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(value);
            if (!match) {
                throw new Error(`Invalid URI: ${value}`);
            }
            const scheme = match[1];
            const rest = value.slice(match[0].length);
            const safeDecode = (s: string): string => {
                try {
                    return decodeURIComponent(s);
                } catch {
                    return s;
                }
            };
            let authority = '';
            let path = safeDecode(rest);
            if (rest.startsWith('//')) {
                const afterSlashes = rest.slice(2);
                const slashIdx = afterSlashes.indexOf('/');
                if (slashIdx === -1) {
                    authority = decodeURIComponent(afterSlashes);
                    path = '';
                } else {
                    authority = decodeURIComponent(afterSlashes.slice(0, slashIdx));
                    path = decodeURIComponent(afterSlashes.slice(slashIdx));
                }
            }
            return { scheme, authority, path, fsPath: path, toString: () => value };
        },
        file: (fsPath: string) => ({
            scheme: 'file',
            authority: '',
            path: fsPath,
            fsPath,
            toString: () => `file://${fsPath}`,
        }),
    },
    l10n: {
        t: (message: string, ...args: unknown[]) =>
            message.replace(/\{(\d+)\}/g, (_m, i) => {
                const value = args[Number(i)];
                return typeof value === 'string' ? value : '';
            }),
    },
    window: {
        showErrorMessage: (...args: unknown[]) => mockShowErrorMessage(...args),
    },
}));

jest.mock('../../extensionVariables', () => ({
    ext: {
        outputChannel: {
            appendLine: jest.fn(),
            trace: jest.fn(),
            warn: jest.fn(),
        },
    },
}));

jest.mock('../../plugins/service-kubernetes/commands/handleKubeconfigFileDrop', () => ({
    handleKubeconfigFileDrop: (...args: unknown[]) => mockHandleKubeconfigFileDrop(...args),
}));

import * as vscode from 'vscode';
import {
    categorizeDroppedUris,
    DiscoveryViewDragAndDropController,
    parseUriList,
    windowsHostUriToWslMountPath,
} from './DiscoveryViewDragAndDropController';

/** Parse a single URI through the same mocked `Uri.parse` the SUT uses. */
function parseSingleUri(value: string): vscode.Uri {
    return vscode.Uri.parse(value);
}

interface MockDataTransferItem {
    asString: () => Promise<string>;
}

function makeDataTransfer(map: Record<string, string>): {
    get: (mime: string) => MockDataTransferItem | undefined;
    forEach: (callback: (item: MockDataTransferItem, mime: string) => void) => void;
} {
    return {
        get: (mime: string): MockDataTransferItem | undefined => {
            if (!(mime in map)) {
                return undefined;
            }
            return { asString: () => Promise.resolve(map[mime]) };
        },
        forEach: (callback: (item: MockDataTransferItem, mime: string) => void): void => {
            for (const mime of Object.keys(map)) {
                callback({ asString: () => Promise.resolve(map[mime]) }, mime);
            }
        },
    };
}

function makeToken(cancelled = false): { isCancellationRequested: boolean } {
    return { isCancellationRequested: cancelled };
}

beforeEach(() => {
    mockHandleKubeconfigFileDrop.mockReset();
    mockShowErrorMessage.mockReset();
});

describe('parseUriList', () => {
    it('extracts file URIs from a basic uri-list payload', () => {
        const uris = parseUriList('file:///etc/kubeconfig\nfile:///home/user/.kube/config\n');
        expect(uris).toHaveLength(2);
        expect(uris.map((u) => u.fsPath)).toEqual(['/etc/kubeconfig', '/home/user/.kube/config']);
    });

    it('ignores blank lines and RFC 2483 comment lines', () => {
        const uris = parseUriList(
            ['# comment from a drag source', 'file:///a.yaml', '', '# another comment', 'file:///b.yaml'].join('\n'),
        );
        expect(uris.map((u) => u.fsPath)).toEqual(['/a.yaml', '/b.yaml']);
    });

    it('drops non-file schemes (http, untitled, etc.)', () => {
        const uris = parseUriList(['http://example.com/file', 'untitled:Untitled-1', 'file:///valid.yaml'].join('\n'));
        expect(uris).toHaveLength(1);
        expect(uris[0].fsPath).toBe('/valid.yaml');
    });

    it('silently skips malformed lines without failing the whole list', () => {
        const uris = parseUriList(['not-a-uri', 'file:///kept.yaml'].join('\n'));
        expect(uris).toHaveLength(1);
        expect(uris[0].fsPath).toBe('/kept.yaml');
    });

    it('handles CRLF line endings as well as LF', () => {
        const uris = parseUriList('file:///a.yaml\r\nfile:///b.yaml\r\n');
        expect(uris.map((u) => u.fsPath)).toEqual(['/a.yaml', '/b.yaml']);
    });

    it('returns an empty array for an empty payload', () => {
        expect(parseUriList('')).toEqual([]);
        expect(parseUriList('\n\n')).toEqual([]);
    });
});

describe('DiscoveryViewDragAndDropController.handleDrop', () => {
    it('reads text/uri-list and delegates parsed file URIs to the Kubernetes handler', async () => {
        const controller = new DiscoveryViewDragAndDropController();
        const dt = makeDataTransfer({
            'text/uri-list': 'file:///a.yaml\nfile:///b.yaml\n',
        });

        await controller.handleDrop(undefined, dt as never, makeToken() as never);

        expect(mockHandleKubeconfigFileDrop).toHaveBeenCalledTimes(1);
        const passedUris = mockHandleKubeconfigFileDrop.mock.calls[0][0] as { fsPath: string }[];
        expect(passedUris.map((u) => u.fsPath)).toEqual(['/a.yaml', '/b.yaml']);
    });

    it('falls back to application/vnd.code.uri-list when text/uri-list is absent', async () => {
        const controller = new DiscoveryViewDragAndDropController();
        const dt = makeDataTransfer({
            'application/vnd.code.uri-list': 'file:///dropped.yaml\n',
        });

        await controller.handleDrop(undefined, dt as never, makeToken() as never);

        expect(mockHandleKubeconfigFileDrop).toHaveBeenCalledTimes(1);
        const passedUris = mockHandleKubeconfigFileDrop.mock.calls[0][0] as { fsPath: string }[];
        expect(passedUris.map((u) => u.fsPath)).toEqual(['/dropped.yaml']);
    });

    it('returns silently when no supported MIME type is present', async () => {
        const controller = new DiscoveryViewDragAndDropController();
        const dt = makeDataTransfer({ 'application/json': '{}' });

        await controller.handleDrop(undefined, dt as never, makeToken() as never);

        expect(mockHandleKubeconfigFileDrop).not.toHaveBeenCalled();
    });

    it('shows a modal error (and does not delegate) when the URI list contains no readable file URIs', async () => {
        const controller = new DiscoveryViewDragAndDropController();
        const dt = makeDataTransfer({ 'text/uri-list': 'http://example.com/x\nuntitled:y\n' });

        await controller.handleDrop(undefined, dt as never, makeToken() as never);

        expect(mockHandleKubeconfigFileDrop).not.toHaveBeenCalled();
        expect(mockShowErrorMessage).toHaveBeenCalledTimes(1);
        const [, options] = mockShowErrorMessage.mock.calls[0] as [string, { modal: boolean }];
        expect(options.modal).toBe(true);
    });

    it('does not prefix the detail with a bullet when only one item was rejected', async () => {
        const controller = new DiscoveryViewDragAndDropController();
        const dt = makeDataTransfer({ 'text/uri-list': 'http://example.com/x\n' });

        await controller.handleDrop(undefined, dt as never, makeToken() as never);

        expect(mockShowErrorMessage).toHaveBeenCalledTimes(1);
        const [, options] = mockShowErrorMessage.mock.calls[0] as [string, { detail: string }];
        expect(options.detail).not.toContain('•');
    });

    it('prefixes each detail line with a bullet when multiple items were rejected', async () => {
        const controller = new DiscoveryViewDragAndDropController();
        const dt = makeDataTransfer({ 'text/uri-list': 'http://example.com/x\nuntitled:y\n' });

        await controller.handleDrop(undefined, dt as never, makeToken() as never);

        expect(mockShowErrorMessage).toHaveBeenCalledTimes(1);
        const [, options] = mockShowErrorMessage.mock.calls[0] as [string, { detail: string }];
        expect(options.detail).toContain('• ');
    });

    it('does not show a modal error when nothing recognizable was dropped', async () => {
        const controller = new DiscoveryViewDragAndDropController();
        const dt = makeDataTransfer({ 'text/uri-list': '# only a comment\n\n' });

        await controller.handleDrop(undefined, dt as never, makeToken() as never);

        expect(mockHandleKubeconfigFileDrop).not.toHaveBeenCalled();
        expect(mockShowErrorMessage).not.toHaveBeenCalled();
    });

    it('delegates only the usable file URIs when a drop mixes usable and unsupported entries', async () => {
        const controller = new DiscoveryViewDragAndDropController();
        const dt = makeDataTransfer({
            'text/uri-list': 'vscode-local:/c%3A/win.yaml\nfile:///home/user/config.yaml\n',
        });

        await controller.handleDrop(undefined, dt as never, makeToken() as never);

        expect(mockHandleKubeconfigFileDrop).toHaveBeenCalledTimes(1);
        const passedUris = mockHandleKubeconfigFileDrop.mock.calls[0][0] as { fsPath: string }[];
        expect(passedUris.map((u) => u.fsPath)).toEqual(['/home/user/config.yaml']);
        // A usable file was present, so no blocking modal is shown.
        expect(mockShowErrorMessage).not.toHaveBeenCalled();
    });

    it('respects cancellation after reading the data transfer payload', async () => {
        const controller = new DiscoveryViewDragAndDropController();
        const dt = makeDataTransfer({ 'text/uri-list': 'file:///a.yaml\n' });

        await controller.handleDrop(undefined, dt as never, makeToken(true) as never);

        expect(mockHandleKubeconfigFileDrop).not.toHaveBeenCalled();
    });

    it('respects cancellation after the dynamic import resolves but before delegating', async () => {
        // Simulate a token that goes from "not cancelled" (so we pass the
        // first check after asString) to "cancelled" by the time we re-check
        // after the dynamic import. Using a getter lets us flip mid-handler.
        const controller = new DiscoveryViewDragAndDropController();
        const dt = makeDataTransfer({ 'text/uri-list': 'file:///a.yaml\n' });

        let cancelled = false;
        const lazyToken = {
            get isCancellationRequested(): boolean {
                // First read (post asString) returns false; subsequent reads
                // (post dynamic import) return true. asString resolves
                // synchronously in the mock so we use a simple counter.
                const v = cancelled;
                cancelled = true;
                return v;
            },
        };

        await controller.handleDrop(undefined, dt as never, lazyToken as never);

        // Delegate must NOT have been called because the token flipped to
        // cancelled before we reached the await on handleKubeconfigFileDrop.
        expect(mockHandleKubeconfigFileDrop).not.toHaveBeenCalled();
    });
});

describe('categorizeDroppedUris', () => {
    it('treats local file:// URIs (no authority) as usable', () => {
        const { usable, rejected } = categorizeDroppedUris('file:///home/user/.kube/config\n');
        expect(usable.map((u) => u.fsPath)).toEqual(['/home/user/.kube/config']);
        expect(rejected).toHaveLength(0);
    });

    it('rejects vscode-local URIs (Windows host file under WSL) when the file is not on the mount', () => {
        // Inject a resolver that reports "not found on the mount" so the test is
        // deterministic regardless of the host's real /mnt contents.
        const { usable, rejected } = categorizeDroppedUris(
            'vscode-local:/c%3A/Users/me/config.yaml\n',
            () => undefined,
        );
        expect(usable).toHaveLength(0);
        expect(rejected).toHaveLength(1);
        expect(rejected[0].reason).toMatch(/local \(Windows\) machine/i);
    });

    it('links a vscode-local Windows file when the WSL /mnt heuristic resolves it', () => {
        // Simulate the file being present on the WSL automount: the injected
        // resolver maps the Windows-host URI to a readable /mnt/<drive> file URI.
        const resolved = {
            scheme: 'file',
            authority: '',
            path: '/mnt/c/Users/me/config.yaml',
            fsPath: '/mnt/c/Users/me/config.yaml',
            toString: () => 'file:///mnt/c/Users/me/config.yaml',
        };
        const { usable, rejected } = categorizeDroppedUris(
            'vscode-local:/c%3A/Users/me/config.yaml\n',
            () => resolved as never,
        );
        expect(rejected).toHaveLength(0);
        expect(usable.map((u) => u.fsPath)).toEqual(['/mnt/c/Users/me/config.yaml']);
    });

    it('rejects file:// URIs that point at a network/UNC share', () => {
        const { usable, rejected } = categorizeDroppedUris('file://server/share/config.yaml\n');
        expect(usable).toHaveLength(0);
        expect(rejected).toHaveLength(1);
        expect(rejected[0].reason).toMatch(/network share/i);
    });

    it('rejects web links, remote, network and unsaved-editor schemes', () => {
        const payload = [
            'https://example.com/config.yaml',
            'vscode-remote://ssh-remote+host/config.yaml',
            'sftp://host/config.yaml',
            'untitled:Untitled-1',
        ].join('\n');

        const { usable, rejected } = categorizeDroppedUris(payload);
        expect(usable).toHaveLength(0);
        expect(rejected).toHaveLength(4);
        const reasons = rejected.map((r) => r.reason).join('\n');
        expect(reasons).toMatch(/web link/i);
        expect(reasons).toMatch(/different remote host/i);
        expect(reasons).toMatch(/network location/i);
        expect(reasons).toMatch(/unsaved editor/i);
    });

    it('reports an unknown scheme with a generic explanation', () => {
        const { rejected } = categorizeDroppedUris('weird-scheme:/whatever\n');
        expect(rejected).toHaveLength(1);
        expect(rejected[0].reason).toMatch(/unsupported URI scheme "weird-scheme"/i);
    });

    it('splits a mixed payload into usable and rejected entries', () => {
        const payload = ['file:///ok.yaml', 'https://example.com/x', 'file://nas/share/y.yaml'].join('\n');
        const { usable, rejected } = categorizeDroppedUris(payload);
        expect(usable.map((u) => u.fsPath)).toEqual(['/ok.yaml']);
        expect(rejected).toHaveLength(2);
    });

    it('ignores comments, blank lines and malformed entries', () => {
        const payload = ['# a comment', '', 'not-a-uri', 'file:///kept.yaml'].join('\n');
        const { usable, rejected } = categorizeDroppedUris(payload);
        expect(usable.map((u) => u.fsPath)).toEqual(['/kept.yaml']);
        expect(rejected).toHaveLength(0);
    });
});

describe('windowsHostUriToWslMountPath', () => {
    it('maps a vscode-local Windows drive path to the /mnt/<drive> automount path', () => {
        const uri = parseSingleUri('vscode-local:/c%3A/Users/me/config.yaml');
        expect(windowsHostUriToWslMountPath(uri)).toBe('/mnt/c/Users/me/config.yaml');
    });

    it('lower-cases the drive letter', () => {
        const uri = parseSingleUri('vscode-local:/D%3A/work/cluster.yaml');
        expect(windowsHostUriToWslMountPath(uri)).toBe('/mnt/d/work/cluster.yaml');
    });

    it('returns undefined for non vscode-local schemes', () => {
        const uri = parseSingleUri('file:///home/user/config.yaml');
        expect(windowsHostUriToWslMountPath(uri)).toBeUndefined();
    });

    it('returns undefined for a vscode-local path without a drive letter', () => {
        // e.g. a macOS/Linux client file behind an SSH remote — no /mnt mapping applies.
        const uri = parseSingleUri('vscode-local:/Users/me/config.yaml');
        expect(windowsHostUriToWslMountPath(uri)).toBeUndefined();
    });
});
