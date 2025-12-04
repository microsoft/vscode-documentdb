/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Card, CardHeader, makeStyles, Text, tokens } from '@fluentui/react-components';
import { SparkleRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';
import ReactMarkdown from 'react-markdown';
import './optimizationCard.scss';

const useStyles = makeStyles({
    content: {
        marginTop: '12px',
        '& h1, & h2, & h3, & h4, & h5, & h6': {
            marginTop: tokens.spacingVerticalM,
            marginBottom: tokens.spacingVerticalS,
            fontWeight: tokens.fontWeightSemibold,
        },
        '& h1': {
            fontSize: tokens.fontSizeBase500,
        },
        '& h2': {
            fontSize: tokens.fontSizeBase400,
        },
        '& h3': {
            fontSize: tokens.fontSizeBase300,
        },
        '& h4, & h5, & h6': {
            fontSize: tokens.fontSizeBase300,
        },
        '& p': {
            marginTop: tokens.spacingVerticalS,
            marginBottom: tokens.spacingVerticalS,
            fontSize: tokens.fontSizeBase300,
            lineHeight: tokens.lineHeightBase300,
        },
        '& code': {
            backgroundColor: tokens.colorNeutralBackground3,
            padding: '2px 4px',
            borderRadius: tokens.borderRadiusSmall,
            fontFamily: tokens.fontFamilyMonospace,
            fontSize: tokens.fontSizeBase200,
        },
        '& pre': {
            backgroundColor: tokens.colorNeutralBackground3,
            padding: tokens.spacingVerticalM,
            borderRadius: tokens.borderRadiusMedium,
            fontFamily: tokens.fontFamilyMonospace,
            fontSize: tokens.fontSizeBase200,
            overflow: 'auto',
            border: `1px solid ${tokens.colorNeutralStroke2}`,
        },
        '& blockquote': {
            borderLeft: `3px solid ${tokens.colorBrandBackground}`,
            paddingLeft: tokens.spacingHorizontalM,
            marginLeft: '0',
            fontStyle: 'italic',
        },
        '& ul, & ol': {
            paddingLeft: tokens.spacingHorizontalL,
        },
        '& li': {
            marginBottom: tokens.spacingVerticalXS,
        },
        '& hr': {
            border: 'none',
            height: '1px',
            backgroundColor: tokens.colorNeutralStroke2,
            margin: `${tokens.spacingVerticalM} 0`,
        },
        '& a': {
            color: tokens.colorBrandForeground1,
            textDecoration: 'underline',
        },
        '& table': {
            borderCollapse: 'collapse',
            width: '100%',
            marginTop: tokens.spacingVerticalS,
            marginBottom: tokens.spacingVerticalS,
        },
        '& th, & td': {
            border: `1px solid ${tokens.colorNeutralStroke2}`,
            padding: tokens.spacingVerticalXS,
            textAlign: 'left',
        },
        '& th': {
            backgroundColor: tokens.colorNeutralBackground2,
            fontWeight: tokens.fontWeightSemibold,
        },
    },
});

interface MarkdownCardExProps {
    /**
     * Card title
     */
    title: string;

    /**
     * Markdown content to render
     */
    content: string;

    /**
     * Optional custom icon (defaults to SparkleRegular)
     */
    icon?: JSX.Element;

    /**
     * Optional callback when the copy button is clicked
     */
    onCopy?: () => void;

    /**
     * Whether to show the AI disclaimer. Default: true
     * Set to false for non-AI generated content (e.g., error messages)
     */
    showAiDisclaimer?: boolean;

    /**
     * Optional children to render between the title and content
     */
    children?: React.ReactNode;
    
    /**
     * Ref to forward to the card element
     */
    ref?: React.Ref<HTMLDivElement>;
}

/**
 * Extended Markdown card component that supports children between title and content.
 * This component extends the original MarkdownCard with the ability to insert custom
 * content (such as MessageBars) between the title/header and the main markdown content.
 *
 * **Usage with children**:
 * ```tsx
 * <MarkdownCardEx title="..." content="...">
 *   <MessageBar intent="warning">
 *     <MessageBarBody>Custom message</MessageBarBody>
 *   </MessageBar>
 * </MarkdownCardEx>
 * ```
 *
 * **Usage with animations**: Use directly with animation libraries like @fluentui/react-motion-components-preview:
 * ```tsx
 * <CollapseRelaxed visible={isVisible}>
 *   <MarkdownCardEx title="..." content="..." {...props} />
 * </CollapseRelaxed>
 * ```
 *
 * **Important**: The component applies `marginBottom: '16px'` by default for proper spacing in animated lists.
 * The margin is on the Card itself to ensure borders and shadows render immediately during collapse animations.
 */
// TODO: Copy content feature will be added in the next release - _onCopy parameter will be used then
export function MarkdownCardEx({ title, content, icon, onCopy: _onCopy, showAiDisclaimer = true, children, ref }: MarkdownCardExProps) {
        const styles = useStyles();

        return (
            <Card ref={ref} style={{ marginBottom: '16px' }}>
                <div className="optimization-card-container">
                    <div className="optimization-card-icon" style={{ flexShrink: 0 }}>
                        {icon ?? <SparkleRegular />}
                    </div>
                    <div style={{ flex: 1 }}>
                        <CardHeader
                            header={
                                <Text weight="semibold" size={400}>
                                    {title}
                                </Text>
                            }
                            action={
                                showAiDisclaimer ? (
                                    <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                                        {l10n.t('AI responses may be inaccurate')}
                                    </Text>
                                ) : undefined
                            }
                            style={{ marginBottom: '16px' }}
                        />
                        {/* Custom children content between header and main content */}
                        {children}
                        <div className={styles.content}>
                            <ReactMarkdown>{content}</ReactMarkdown>
                        </div>
                    </div>
                </div>
            </Card>
        );
}
