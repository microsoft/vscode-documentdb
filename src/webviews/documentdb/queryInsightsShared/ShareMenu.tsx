/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Menu,
    MenuButton,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    useId,
    type ButtonProps,
} from '@fluentui/react-components';
import { CheckmarkRegular, DocumentTextRegular, MarkdownRegular, ShareRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';
import { useCopyFeedback, type CopiedWithMessage } from './useCopyFeedback';
import { writeHtmlToClipboard } from './writeHtmlToClipboard';

export interface ShareReportContent {
    /** Email-safe HTML for rich-text targets. */
    readonly html: string;
    /** Plain-text alternative written with the HTML and used as the fallback. */
    readonly plainText: string;
}

export interface ShareMenuProps {
    /** The full Markdown report, including the model inputs. */
    buildMarkdown: () => string;
    buildRichText: () => ShareReportContent;
    /** Copies plain text through the extension host. Resolving to `false` counts as a failure. */
    copyText: (text: string) => Promise<unknown>;
    appearance?: ButtonProps['appearance'];
}

interface ShareMenuItemProps {
    icon: JSX.Element;
    label: string;
    description: string;
    onClick: () => void;
}

/** A menu item named by its label and described by its second line. */
function ShareMenuItem({ icon, label, description, onClick }: ShareMenuItemProps): JSX.Element {
    const labelId = useId('share-item-label');
    const descriptionId = useId('share-item-description');
    return (
        <MenuItem
            icon={icon}
            aria-labelledby={labelId}
            aria-describedby={descriptionId}
            subText={{ id: descriptionId, children: description }}
            onClick={onClick}
        >
            <span id={labelId}>{label}</span>
        </MenuItem>
    );
}

/**
 * "Share" menu for the Query Insights report. Both options copy the same content: as Markdown, or as
 * rich text (the Markdown rendered as styled HTML, with the Markdown as the plain-text alternative). After a copy the button icon becomes a checkmark for two seconds and the result is
 * announced; the button label never changes.
 */
export function ShareMenu({
    buildMarkdown,
    buildRichText,
    copyText,
    appearance = 'subtle',
}: ShareMenuProps): JSX.Element {
    const feedback = useCopyFeedback();

    const copyMarkdown = (): void => {
        void feedback.run(() => copyText(buildMarkdown()), l10n.t('Copied the report as Markdown'));
    };

    const copyRichText = (): void => {
        void feedback.run(async (): Promise<unknown> => {
            const content = buildRichText();
            if (await writeHtmlToClipboard(content.html, content.plainText)) {
                return true;
            }
            const copied = await copyText(content.plainText);
            if (copied === false) return false;
            const fallback: CopiedWithMessage = {
                copiedMessage: l10n.t('Rich text is not available here. Copied the report as plain text'),
            };
            return fallback;
        }, l10n.t('Copied the report as rich text'));
    };

    return (
        <>
            <Menu positioning={{ position: 'below', align: 'end' }}>
                <MenuTrigger disableButtonEnhancement>
                    <MenuButton
                        appearance={appearance}
                        size="small"
                        icon={feedback.copied ? <CheckmarkRegular /> : <ShareRegular />}
                    >
                        {l10n.t('Share')}
                    </MenuButton>
                </MenuTrigger>
                <MenuPopover>
                    <MenuList>
                        <ShareMenuItem
                            icon={<MarkdownRegular />}
                            label={l10n.t('Copy as Markdown')}
                            description={l10n.t('For issues, docs and AI agents')}
                            onClick={copyMarkdown}
                        />
                        <ShareMenuItem
                            icon={<DocumentTextRegular />}
                            label={l10n.t('Copy as rich text')}
                            description={l10n.t('The same report, formatted for email, Teams and Word')}
                            onClick={copyRichText}
                        />
                    </MenuList>
                </MenuPopover>
            </Menu>
            {feedback.announcer}
        </>
    );
}
