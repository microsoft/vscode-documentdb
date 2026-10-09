/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { Links } from '../../constants';
import {
    type ConnectionDiagnosticsProvider,
    type ConnectionDiagnosticsRequest,
} from '../../services/connectionDiagnosticsService';

export class SrvDnsDiagnosticsProvider implements ConnectionDiagnosticsProvider {
    public readonly id = 'srv-dns';

    public async explain({ error }: ConnectionDiagnosticsRequest): Promise<string | undefined> {
        if (!(error instanceof Error) || error instanceof UserCancelledError) {
            return undefined;
        }

        // A socket refusal has the same code as a DNS refusal, so require the SRV operation first.
        if (!error.message.startsWith('querySrv ') && !('syscall' in error && error.syscall === 'querySrv')) {
            return undefined;
        }

        // Worker-relayed errors preserve only the message, not the Node.js error properties.
        const code =
            'code' in error && error.code !== undefined ? error.code : /^querySrv (\S+)/.exec(error.message)?.[1];

        switch (code) {
            case 'EBADRESP':
            case 'EFORMERR':
                return l10n.t(
                    'The SRV record for this connection could not be resolved: the DNS reply could not be read. This often happens with home routers and some VPN or corporate DNS servers. Use a non-SRV `mongodb://` connection string, or a different DNS server. See {link} for troubleshooting.',
                    { link: Links.SrvDnsTroubleshooting },
                );
            case 'ECONNREFUSED':
                return l10n.t(
                    "The SRV record for this connection could not be resolved: the DNS server refused the query. Check your network's DNS settings, or use a non-SRV `mongodb://` connection string. See {link} for troubleshooting.",
                    { link: Links.SrvDnsTroubleshooting },
                );
            default:
                return undefined;
        }
    }
}
