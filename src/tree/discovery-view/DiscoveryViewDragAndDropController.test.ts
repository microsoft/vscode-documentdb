/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const mockHandleKubeconfigFileDrop = jest.fn();

jest.mock('vscode', () => ({
    Uri: {
        parse: (value: string, _strict?: boolean) => {
            // Minimal URI parser that mimics the shape DiscoveryViewDragAndDropController
            // depends on (`scheme` + `fsPath`). Strict mode rejects anything without
            // an explicit scheme to match real Uri.parse behavior used by the SUT.
            const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(value);
            if (!match) {
                throw new Error(`Invalid URI: ${value}`);
            }
            const scheme = match[1];
            const rest = value.slice(match[0].length);
            const path = rest.startsWith('//') ? decodeURIComponent(rest.slice(2)) : rest;
            return { scheme, fsPath: path };
        },
    },
}));

jest.mock('../../plugins/service-kubernetes/commands/handleKubeconfigFileDrop', () => ({
    handleKubeconfigFileDrop: (...args: unknown[]) => mockHandleKubeconfigFileDrop(...args),
}));

import { DiscoveryViewDragAndDropController, parseUriList } from './DiscoveryViewDragAndDropController';

interface MockDataTransferItem {
    asString: () => Promise<string>;
}

function makeDataTransfer(map: Record<string, string>): {
    get: (mime: string) => MockDataTransferItem | undefined;
} {
    return {
        get: (mime: string): MockDataTransferItem | undefined => {
            if (!(mime in map)) {
                return undefined;
            }
            return { asString: () => Promise.resolve(map[mime]) };
        },
    };
}

function makeToken(cancelled = false): { isCancellationRequested: boolean } {
    return { isCancellationRequested: cancelled };
}

beforeEach(() => {
    mockHandleKubeconfigFileDrop.mockReset();
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

    it('returns silently when the URI list contains no file URIs', async () => {
        const controller = new DiscoveryViewDragAndDropController();
        const dt = makeDataTransfer({ 'text/uri-list': 'http://example.com/x\nuntitled:y\n' });

        await controller.handleDrop(undefined, dt as never, makeToken() as never);

        expect(mockHandleKubeconfigFileDrop).not.toHaveBeenCalled();
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
