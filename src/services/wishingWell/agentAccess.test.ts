/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const state = new Map<string, unknown>();
    const secretValues = new Map<string, string>();
    return {
        state,
        secretValues,
        showQuickPick: vi.fn(),
        showInformationMessage: vi.fn(),
        writeText: vi.fn(async (_text: string) => undefined),
        statusBarItem: {
            name: '',
            text: '',
            tooltip: '' as unknown,
            command: undefined as unknown,
            show: vi.fn(),
            hide: vi.fn(),
            dispose: vi.fn(),
        },
        startMcpHttpServer: vi.fn(),
        close: vi.fn(async () => undefined),
        globalState: {
            get: vi.fn((key: string) => state.get(key)),
            update: vi.fn(async (key: string, value: unknown) => {
                state.set(key, value);
            }),
        },
        secrets: {
            get: vi.fn(async (key: string) => secretValues.get(key)),
            store: vi.fn(async (key: string, value: string) => {
                secretValues.set(key, value);
            }),
        },
    };
});

vi.mock('vscode', () => ({
    window: {
        showQuickPick: mocks.showQuickPick,
        showInformationMessage: mocks.showInformationMessage,
        createStatusBarItem: vi.fn(() => mocks.statusBarItem),
    },
    env: { clipboard: { writeText: mocks.writeText } },
    l10n: {
        t: (message: string, ...args: unknown[]): string =>
            args.reduce<string>((result, value, index) => result.replace(`{${String(index)}}`, String(value)), message),
    },
    StatusBarAlignment: { Left: 1, Right: 2 },
}));
vi.mock('../../extensionVariables', () => ({
    ext: {
        context: {
            globalState: mocks.globalState,
            secrets: mocks.secrets,
            extension: { packageJSON: { version: '1.2.3' } },
        },
        outputChannel: { info: vi.fn(), warn: vi.fn() },
    },
}));
vi.mock('./mcpHttpServer', () => ({ startMcpHttpServer: mocks.startMcpHttpServer }));

import {
    agentConfigs,
    decideAgentPort,
    DEFAULT_AGENT_PORT,
    preferredAgentPort,
    WishingWellAgentAccess,
    type AgentToolset,
} from './agentAccess';

const ENABLED_STATE = 'documentdb.wishingWell.agentAccessEnabled';
const PORT_STATE = 'documentdb.wishingWell.agentAccessPort';
const TOKEN_SECRET = 'documentdb.wishingWell.agentToken';

const toolset: AgentToolset = { tools: [], instructions: 'Make a wish.', callTool: vi.fn() };

function bindTo(port: number): void {
    mocks.startMcpHttpServer.mockImplementation(async () => ({
        url: `http://127.0.0.1:${port}/mcp`,
        port,
        close: mocks.close,
    }));
}

/** Picks the quick pick item whose label starts with `label`, or presses Escape when it is undefined. */
function pick(label: string | undefined): void {
    mocks.showQuickPick.mockImplementationOnce(async (items: readonly { label: string }[]) =>
        label === undefined ? undefined : items.find((item) => item.label.startsWith(label)),
    );
}

function lastMessage(): string {
    return String(mocks.showInformationMessage.mock.calls.at(-1)?.[0]);
}

describe('preferredAgentPort', () => {
    it('uses a valid stored port', () => {
        expect(preferredAgentPort(50000)).toBe(50000);
    });

    it.each([undefined, '47017', 0, -1, 70000, 1.5])('falls back to the default for %s', (stored) => {
        expect(preferredAgentPort(stored)).toBe(DEFAULT_AGENT_PORT);
    });
});

describe('decideAgentPort', () => {
    it('remembers the default port the first time it binds', () => {
        expect(decideAgentPort(undefined, DEFAULT_AGENT_PORT)).toEqual({
            temporary: false,
            remember: DEFAULT_AGENT_PORT,
        });
    });

    it('writes nothing when it binds the stored port again', () => {
        expect(decideAgentPort(50000, 50000)).toEqual({ temporary: false });
    });

    it('never remembers a fallback port', () => {
        expect(decideAgentPort(undefined, 53123)).toEqual({ temporary: true });
        expect(decideAgentPort(DEFAULT_AGENT_PORT, 53123)).toEqual({ temporary: true });
        expect(decideAgentPort(50000, DEFAULT_AGENT_PORT)).toEqual({ temporary: true });
    });

    it('replaces an unusable stored value with the default it bound', () => {
        expect(decideAgentPort('47017', DEFAULT_AGENT_PORT)).toEqual({
            temporary: false,
            remember: DEFAULT_AGENT_PORT,
        });
    });
});

describe('agentConfigs', () => {
    const url = 'http://127.0.0.1:47017/mcp';

    it('builds a Claude Code command with the URL and bearer token', () => {
        expect(agentConfigs(url, 'tok').claudeCommand).toBe(
            `claude mcp add --transport http documentdb-wishing-well ${url} --header "Authorization: Bearer tok"`,
        );
    });

    it('builds the mcpServers JSON shape', () => {
        expect(JSON.parse(agentConfigs(url, 'tok').mcpJson)).toEqual({
            mcpServers: {
                'documentdb-wishing-well': { type: 'http', url, headers: { Authorization: 'Bearer tok' } },
            },
        });
    });
});

describe('WishingWellAgentAccess', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.state.clear();
        mocks.secretValues.clear();
        mocks.secretValues.set(TOKEN_SECRET, 'secret-token');
        bindTo(DEFAULT_AGENT_PORT);
    });

    it('changes nothing when the first picker is dismissed', async () => {
        const access = new WishingWellAgentAccess(toolset);
        pick(undefined);

        await access.enable();

        expect(mocks.startMcpHttpServer).not.toHaveBeenCalled();
        expect(mocks.globalState.update).not.toHaveBeenCalled();
        expect(mocks.secrets.store).not.toHaveBeenCalled();
        expect(mocks.writeText).not.toHaveBeenCalled();
        expect(mocks.statusBarItem.show).not.toHaveBeenCalled();
        expect(access.isRunning).toBe(false);
    });

    it('offers only turn-on choices while access is off', async () => {
        const access = new WishingWellAgentAccess(toolset);
        pick(undefined);

        await access.enable();

        const labels = (mocks.showQuickPick.mock.calls[0][0] as { label: string }[]).map((item) => item.label);
        expect(labels).toEqual([
            'Turn on and copy the Claude Code command',
            'Turn on and copy the MCP JSON (mcpServers)',
        ]);
    });

    it('turns on, remembers the port and copies the chosen config', async () => {
        const access = new WishingWellAgentAccess(toolset);
        pick('Turn on and copy the Claude Code command');

        await access.enable();

        expect(mocks.startMcpHttpServer).toHaveBeenCalledWith(expect.anything(), DEFAULT_AGENT_PORT);
        expect(mocks.state.get(ENABLED_STATE)).toBe(true);
        expect(mocks.state.get(PORT_STATE)).toBe(DEFAULT_AGENT_PORT);
        expect(mocks.writeText).toHaveBeenCalledWith(expect.stringContaining('Bearer secret-token'));
        expect(lastMessage()).toContain('contains your access token');
        expect(lastMessage()).toContain('Keep this VS Code window open');
        expect(lastMessage()).toContain('list your DocumentDB connections');
        expect(lastMessage()).not.toContain('temporary address');
        expect(mocks.statusBarItem.show).toHaveBeenCalled();
        expect(mocks.statusBarItem.text).toBe('$(plug) Agents');
        expect(mocks.statusBarItem.tooltip).toContain('http://127.0.0.1:47017/mcp');
        expect(mocks.statusBarItem.command).toBe('vscode-documentdb.command.wishingWell.connectAgent');
    });

    it('keeps the stored port and says so when another window holds it', async () => {
        mocks.state.set(PORT_STATE, DEFAULT_AGENT_PORT);
        bindTo(53123);
        const access = new WishingWellAgentAccess(toolset);
        pick('Turn on and copy the MCP JSON');

        await access.enable();

        expect(mocks.globalState.update).not.toHaveBeenCalledWith(PORT_STATE, expect.anything());
        expect(mocks.state.get(PORT_STATE)).toBe(DEFAULT_AGENT_PORT);
        expect(lastMessage()).toContain('temporary address');
        expect(mocks.statusBarItem.tooltip).toContain('temporary address');
    });

    it('offers copy, a new token and turning off once access is on', async () => {
        const access = new WishingWellAgentAccess(toolset);
        pick('Turn on and copy the Claude Code command');
        await access.enable();
        pick(undefined);

        await access.enable();

        const labels = (mocks.showQuickPick.mock.calls[1][0] as { label: string }[]).map((item) => item.label);
        expect(labels).toEqual([
            'Copy the Claude Code command',
            'Copy the MCP JSON (mcpServers)',
            'Issue a new access token',
            'Turn off agent access',
        ]);
        expect(mocks.startMcpHttpServer).toHaveBeenCalledTimes(1);
    });

    it('stops the endpoint and hides the status bar item when turned off', async () => {
        const access = new WishingWellAgentAccess(toolset);
        pick('Turn on and copy the Claude Code command');
        await access.enable();
        pick('Turn off agent access');

        await access.enable();

        expect(mocks.close).toHaveBeenCalled();
        expect(mocks.statusBarItem.hide).toHaveBeenCalled();
        expect(mocks.state.get(ENABLED_STATE)).toBe(false);
        expect(access.isRunning).toBe(false);
    });

    it('restores access only when it was turned on', async () => {
        await new WishingWellAgentAccess(toolset).restore();
        expect(mocks.startMcpHttpServer).not.toHaveBeenCalled();

        mocks.state.set(ENABLED_STATE, true);
        const access = new WishingWellAgentAccess(toolset);
        await access.restore();
        expect(access.isRunning).toBe(true);
        expect(mocks.statusBarItem.show).toHaveBeenCalled();
    });
});
