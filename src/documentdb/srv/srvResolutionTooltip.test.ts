/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as l10n from '@vscode/l10n';
import { ClustersClient } from '../ClustersClient';
import { appendSrvResolutionTooltipLine } from './srvResolutionTooltip';
import type { SrvResolutionSummary } from './srvResolutionSummary';

jest.mock('@vscode/l10n', () => ({ t: jest.fn(
    (message: string, ...args: unknown[]): string =>
        args.reduce<string>((translated, arg, index) => translated.replace(`{${index}}`, String(arg)), message),
) }));

describe('SRV resolution tooltip', (): void => {
    afterEach((): void => {
        jest.restoreAllMocks();
    });

    it.each(['node', 'nodeErrorPassthrough', undefined] as const)(
        'leaves the tooltip unchanged for %s',
        (path): void => {
            jest.spyOn(ClustersClient, 'getSrvResolution').mockReturnValue(
                path ? { path, resolvedAt: 1 } : undefined,
            );
            const md = new vscode.MarkdownString('Original tooltip');
            appendSrvResolutionTooltipLine(md, 'stable-id');
            expect(md.value).toBe('Original tooltip');
        },
    );

    it.each(['EBADRESP', 'EFORMERR', 'ECONNREFUSED', undefined])(
        'renders a single host-free fallback line with code %s',
        (nodeErrorCode): void => {
            const summary: SrvResolutionSummary = { path: 'fallback', resolvedAt: 1, nodeErrorCode };
            const getSummary = jest.spyOn(ClustersClient, 'getSrvResolution').mockReturnValue(summary);
            const md = new vscode.MarkdownString();
            appendSrvResolutionTooltipLine(md, 'stable-id');
            appendSrvResolutionTooltipLine(md, 'stable-id');
            expect(getSummary).toHaveBeenCalledWith('stable-id');
            expect(md.value.match(/\*\*DNS:\*\*/g)).toHaveLength(1);
            expect(md.value).toContain("SRV record resolved by the extension's fallback resolver");
            if (nodeErrorCode) {
                expect(md.value).toContain(`could not use the reply (\`${nodeErrorCode}\`).`);
            } else {
                expect(md.value).not.toContain('because');
            }
            expect(md.value).not.toContain('mongodb://');
        },
    );

    it.each(['Translated sentence without a colon', 'Translated sentence with a full-width colon：'])(
        'localizes the DNS label separately from %s',
        (message): void => {
            jest.spyOn(ClustersClient, 'getSrvResolution').mockReturnValue({ path: 'fallback', resolvedAt: 1 });
            jest.mocked(l10n.t).mockImplementationOnce(() => message).mockImplementationOnce(() => 'Translated DNS');
            const md = new vscode.MarkdownString();
            appendSrvResolutionTooltipLine(md, 'stable-id');
            expect(md.value).toContain(`**Translated DNS:** ${message}`);
            expect(l10n.t).toHaveBeenCalledWith('DNS');
            expect(md.value).not.toContain('****');
        },
    );
});
