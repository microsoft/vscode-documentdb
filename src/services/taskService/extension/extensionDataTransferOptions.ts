/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { type DataTransferOptions, type DataTransferStrings } from '../data-api/dataTransferHost';

export function getExtensionDataTransferStrings(): DataTransferStrings {
    return {
        keepAliveTimeoutExceeded: vscode.l10n.t('Keep-alive timeout exceeded'),
        failedAfterAttempts: (attempts: string): string =>
            vscode.l10n.t('Failed to complete operation after {0} attempts', attempts),
        writeOperationFailed: (message: string): string => vscode.l10n.t('Write operation failed: {0}', message),
        unknownError: vscode.l10n.t('Unknown error'),
        inserted: (count: string): string => vscode.l10n.t('{0} inserted', count),
        skipped: (count: string): string => vscode.l10n.t('{0} skipped', count),
        replaced: (count: string): string => vscode.l10n.t('{0} replaced', count),
        created: (count: string): string => vscode.l10n.t('{0} created', count),
    };
}

export function createExtensionDataTransferOptions(): DataTransferOptions {
    return {
        logger: ext.outputChannel,
        strings: getExtensionDataTransferStrings(),
    };
}
