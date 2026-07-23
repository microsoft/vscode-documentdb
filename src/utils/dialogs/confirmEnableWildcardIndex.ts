/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import {
    type EnableWildcardIndexConfirmationDetails,
    type FieldIndexType,
} from '../../webviews/documentdb/indexView/types';

function fieldTypeLabel(type: FieldIndexType): string {
    switch (type) {
        case 'asc':
            return l10n.t('Ascending');
        case 'desc':
            return l10n.t('Descending');
        case 'text':
            return l10n.t('Text');
        case '2dsphere':
            return l10n.t('Geospatial (2dsphere)');
        case 'hashed':
            return l10n.t('Hashed');
    }
}

/** Confirm the exact destructive effects of enabling wildcard mode in a native modal. */
export async function confirmEnableWildcardIndex(details: EnableWildcardIndexConfirmationDetails): Promise<boolean> {
    const title = l10n.t('Enable wildcard index?');
    const actionLabel = l10n.t('Enable wildcard');
    const lines = [
        details.fields.length > 0
            ? l10n.t('Wildcard mode will use $** instead of the selected index fields.')
            : l10n.t('Wildcard mode will use $** as the only index field.'),
    ];

    if (details.fields.length > 0) {
        lines.push('', l10n.t('Fields that will be replaced:'));
        for (const field of details.fields) {
            lines.push(l10n.t('- {0} ({1})', field.field, fieldTypeLabel(field.type)));
        }
    }
    lines.push('', l10n.t('$** (Ascending) will be added.'));

    const clearedOptions: string[] = [];
    if (details.clearUnique) {
        clearedOptions.push(l10n.t('Unique'));
    }
    if (details.clearSparse) {
        clearedOptions.push(l10n.t('Sparse'));
    }
    if (details.clearTtl) {
        clearedOptions.push(l10n.t('TTL'));
    }
    if (clearedOptions.length > 0) {
        lines.push('', l10n.t('Options that will be cleared:'));
        lines.push(...clearedOptions.map((option) => `- ${option}`));
    }

    const retainedOptions: string[] = [];
    if (details.retainName) {
        retainedOptions.push(l10n.t('Custom index name'));
    }
    if (details.retainPartialFilter) {
        retainedOptions.push(l10n.t('Partial filter expression'));
    }
    if (details.retainCollation) {
        retainedOptions.push(l10n.t('Collation'));
    }
    if (retainedOptions.length > 0) {
        lines.push('', l10n.t('Configured options that will be retained:'));
        lines.push(...retainedOptions.map((option) => `- ${option}`));
    }

    lines.push('', l10n.t('Enabling wildcard mode replaces the listed fields and clears the incompatible options.'));
    const detail = lines.join('\n');
    const result = await vscode.window.showWarningMessage(title, { modal: true, detail }, actionLabel);
    return result === actionLabel;
}
