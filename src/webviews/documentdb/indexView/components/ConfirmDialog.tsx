/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Text,
} from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';

export interface ConfirmDialogProps {
    open: boolean;
    title: string;
    body: string;
    confirmLabel: string;
    /** Reserved to opt into a destructive style when Fluent UI v9 ships one; currently rendered as a primary button. */
    destructive?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
    busy?: boolean;
}

/**
 * Generic two-button confirmation dialog used for destructive (delete) and
 * caution-required (edit) actions. Keeping it in a single component avoids
 * duplicating the FluentUI Dialog boilerplate at each call site.
 */
export const ConfirmDialog = ({
    open,
    title,
    body,
    confirmLabel,
    onConfirm,
    onCancel,
    busy,
}: ConfirmDialogProps): JSX.Element => {
    return (
        <Dialog open={open} onOpenChange={(_, data) => !data.open && !busy && onCancel()}>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogContent>
                        <Text>{body}</Text>
                    </DialogContent>
                    <DialogActions>
                        <Button appearance="primary" onClick={onConfirm} disabled={busy}>
                            {busy ? l10n.t('Working…') : confirmLabel}
                        </Button>
                        <Button appearance="secondary" onClick={onCancel} disabled={busy}>
                            {l10n.t('Cancel')}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};
