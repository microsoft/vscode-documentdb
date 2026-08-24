/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Builds the prompt behind the Operations tab's "Ask Copilot" action.
 *
 * The dashboard's advantage over a user pasting into chat by hand is *context*: the exact
 * command (already credential-redacted upstream), the runtime, and the platform's quirks —
 * which commands this server actually supports — so the model doesn't recommend `top` or
 * the profiler to someone on a platform without them.
 *
 * Prompt text is deliberately not localized, matching the repository's other LLM prompt
 * templates: the model consumes it, not the user.
 */

/** The operation fields the prompt describes. A subset shared by live rows and history rows. */
export interface OperationPromptInput {
    opid: string;
    type: string;
    namespace: string;
    /** Serialized command, credential-redacted by `buildCommandPreview` before it got here. */
    commandPreview: string;
    /** Longest observed runtime in seconds, when the server reported one. */
    secsRunning: number | null;
    clientDescription: string | null;
    /** `true` when the operation is no longer running (a history row). */
    ended: boolean;
}

/**
 * Names the platform from the cluster metadata, mirroring the header card's logic.
 * Returns `null` when the server did not identify itself.
 */
function describePlatform(metadata: Record<string, string | undefined>): string | null {
    if (metadata['topology_hello_internal_kind'] === 'azuredocumentdb') {
        const api = metadata['domainInfo_api'];
        return api ? `Azure DocumentDB (${api})` : 'Azure DocumentDB';
    }

    return null;
}

/**
 * Assembles the "investigate this operation" prompt.
 *
 * @param clusterDisplayName - Name shown in the dashboard header, for the model to echo.
 * @param metadata - Flat metadata map produced by `getClusterMetadata` (cached per client).
 * @param operation - The operation the user right-clicked.
 */
export function buildAskCopilotPrompt(
    clusterDisplayName: string,
    metadata: Record<string, string | undefined>,
    operation: OperationPromptInput,
): string {
    const lines: string[] = [];

    lines.push(
        `I'm looking at the Cluster Dashboard of my DocumentDB (MongoDB API) cluster "${clusterDisplayName}" ` +
            `in VS Code and want to understand one of its operations.`,
        '',
    );

    lines.push('## Operation');
    lines.push(`- Operation id: ${operation.opid || '(not reported)'}`);
    lines.push(`- Kind: ${operation.type}`);
    lines.push(`- Namespace: ${operation.namespace || '(none reported)'}`);
    lines.push(
        operation.secsRunning !== null
            ? `- Longest observed runtime: ${operation.secsRunning} s`
            : '- Runtime: not reported by the server',
    );
    lines.push(`- Status: ${operation.ended ? 'already finished (observed earlier by the dashboard)' : 'running now'}`);
    if (operation.clientDescription !== null) {
        lines.push(`- Client: ${operation.clientDescription}`);
    }
    lines.push('');

    if (operation.commandPreview !== '') {
        lines.push('Command document (credential fields are redacted):');
        lines.push('```json');
        lines.push(operation.commandPreview);
        lines.push('```');
    } else {
        lines.push('The server did not report the command document for this operation.');
    }
    lines.push('');

    lines.push('## Cluster');
    const platform = describePlatform(metadata);
    if (platform !== null) {
        lines.push(`- Platform: ${platform}`);
    }
    const version = metadata['serverInfo_version'];
    if (version !== undefined) {
        lines.push(`- Server version: ${version}`);
    }
    if (metadata['topology_type'] === 'isdbgrid') {
        lines.push('- Topology: sharded (connected through a mongos-compatible router)');
    }
    lines.push('');

    if (metadata['topology_hello_internal_kind'] === 'azuredocumentdb') {
        // Learned against a live vCore cluster; without this the model recommends the
        // classic MongoDB-API toolbox and half of it fails on this platform.
        lines.push(
            'Platform notes: on Azure DocumentDB (vCore), `serverStatus`, `top`, `latencyStats` and the ' +
                'profiler are NOT available. `explain`, `$indexStats`, `dbStats`, `$currentOp` and `killOp` ' +
                'ARE available. Operation ids are strings and must be passed to `killOp` unchanged.',
            '',
        );
    }

    lines.push(
        operation.ended
            ? 'Please explain what this operation was doing, the most likely reasons it ran as long as it did, ' +
                  'and what I could change (indexes, query shape, schema) to make it faster next time.'
            : 'Please explain what this operation is doing, the most likely reasons it is slow, and what I ' +
                  'could do about it — including whether terminating it with `killOp` would be safe, and what to ' +
                  'change (indexes, query shape, schema) so it does not recur.',
    );

    return lines.join('\n');
}
