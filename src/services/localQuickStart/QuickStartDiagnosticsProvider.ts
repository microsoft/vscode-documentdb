/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Error translation for the managed DocumentDB Local instance.
 *
 * TRANSLATION ONLY. This provider must never show UI, start or stop the container, or retry the
 * failed operation; it returns text so the user can tell a Docker problem from a database problem.
 * See `src/services/connectionDiagnosticsService.ts` and
 * `.github/skills/error-translation/SKILL.md`.
 */

import * as l10n from '@vscode/l10n';
import { type ConnectionDiagnosticsProvider, type ConnectionDiagnosticsRequest } from '../connectionDiagnosticsService';
import { QuickStartService } from './QuickStartService';

export class QuickStartDiagnosticsProvider implements ConnectionDiagnosticsProvider {
    public readonly id = 'localQuickStart';

    public async explain({ clusterId }: ConnectionDiagnosticsRequest): Promise<string | undefined> {
        // In-memory lookup, so this costs nothing for the clusters that are not Quick Start ones.
        const alias = QuickStartService.listStatuses().find(
            (status) => status.metadata?.clusterId === clusterId,
        )?.alias;

        if (!alias) {
            return undefined;
        }

        // Deliberately not memoized: this runs once per user-initiated failure, and a cached verdict
        // would keep reporting "not running" right after the user started the container.
        //
        // The error shape does not matter here: if the container is not running, that accounts for
        // any failure against it. If it is running, we stay quiet and the original error stands.
        switch (await QuickStartService.prepareForConnection(alias, { silent: true })) {
            case 'stopped':
                return l10n.t(
                    'DocumentDB Local does not appear to be running. Start it from the Connections view, then try again.',
                );
            case 'missing':
                return l10n.t(
                    'We cannot find the DocumentDB Local container. It was very likely removed outside VS Code. You can recreate it from the Connections view, which reuses the existing data volume.',
                );
            case 'foreign':
                return l10n.t(
                    'We found a container using the DocumentDB Local name, but it very likely was not created by this extension, so we cannot open it.',
                );
            case 'dockerUnreachable':
                return l10n.t(
                    'Docker does not appear to be running, so DocumentDB Local cannot be reached. Start Docker, then try again.',
                );
            case 'unavailable':
                return l10n.t(
                    'We cannot reach DocumentDB Local at the moment. Review its setup in the Connections view.',
                );
            case 'busy':
            case 'ready':
            default:
                return undefined;
        }
    }
}
