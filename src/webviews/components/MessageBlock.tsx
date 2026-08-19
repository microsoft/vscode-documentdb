/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    makeStyles,
    MessageBar,
    MessageBarActions,
    MessageBarBody,
    type MessageBarIntent,
    type MessageBarProps,
    MessageBarTitle,
} from '@fluentui/react-components';
import { type JSX, type ReactNode } from 'react';

const useStyles = makeStyles({
    // Fluent's own `layout` prop controls whether the *actions* wrap to their own line. It offers
    // no way to give the *title* one, which is the whole gap this component fills.
    body: { display: 'flex', flexDirection: 'column', gap: '8px' },
});

export interface MessageBlockProps {
    /** @default 'info' */
    readonly intent?: MessageBarIntent;
    /** Rendered on its own line above the message. */
    readonly title?: ReactNode;
    /** Overrides the glyph Fluent picks for {@link intent}. Fluent's own icon slot type. */
    readonly icon?: MessageBarProps['icon'];
    /** Buttons, in reading order. */
    readonly actions?: ReactNode;
    /** The message. Multiple children stack, one per line. */
    readonly children: ReactNode;
}

/**
 * A `MessageBar` used as a block element inside the content flow, rather than as a slim strip
 * above it: the title takes its own line, and the body stacks whatever it is given.
 *
 * That shape follows from how this product uses `MessageBar` — inside a wizard step, where it is
 * not competing for vertical space, so a stacked title costs nothing. It is house style, which is
 * why it lives here and not in `@microsoft/vscode-ext-webview-fluentui` (decision 0022). Staying
 * local is also what lets it take `vscode.l10n.t()` strings, which nothing in the package may do.
 *
 * @example
 * ```tsx
 * <MessageBlock
 *     intent="error"
 *     title={l10n.t('Setup did not finish')}
 *     actions={<Button onClick={showLog}>{l10n.t('View setup log')}</Button>}
 * >
 *     {message}
 * </MessageBlock>
 * ```
 */
export const MessageBlock = ({ intent = 'info', title, icon, actions, children }: MessageBlockProps): JSX.Element => {
    const styles = useStyles();

    return (
        <MessageBar intent={intent} layout="multiline" icon={icon}>
            <MessageBarBody className={styles.body}>
                {title !== undefined && <MessageBarTitle>{title}</MessageBarTitle>}
                {children}
            </MessageBarBody>
            {actions !== undefined && <MessageBarActions>{actions}</MessageBarActions>}
        </MessageBar>
    );
};
