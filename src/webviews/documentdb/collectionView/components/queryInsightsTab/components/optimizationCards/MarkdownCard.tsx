/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Card, CardHeader, makeStyles, Text, tokens } from '@fluentui/react-components';
// TODO: Copy content feature will be added in the next release
// import { CopyRegular } from '@fluentui/react-icons';
import { SparkleRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';
import ReactMarkdown from 'react-markdown';
import './baseOptimizationCard.scss';

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
            overflow: 'auto',
            marginTop: tokens.spacingVerticalS,
            marginBottom: tokens.spacingVerticalS,
        },
        '& pre code': {
            backgroundColor: 'transparent',
            padding: 0,
        },
        '& ul, & ol': {
            marginTop: tokens.spacingVerticalS,
            marginBottom: tokens.spacingVerticalS,
            paddingLeft: tokens.spacingHorizontalXXL,
        },
        '& li': {
            marginTop: tokens.spacingVerticalXS,
            marginBottom: tokens.spacingVerticalXS,
            fontSize: tokens.fontSizeBase300,
        },
        '& strong': {
            fontWeight: tokens.fontWeightSemibold,
        },
        '& em': {
            fontStyle: 'italic',
        },
        '& blockquote': {
            marginTop: tokens.spacingVerticalS,
            marginBottom: tokens.spacingVerticalS,
            paddingLeft: tokens.spacingHorizontalL,
            borderLeft: `4px solid ${tokens.colorBrandBackground}`,
            color: tokens.colorNeutralForeground2,
            fontStyle: 'italic',
        },
        '& blockquote p': {
            marginTop: tokens.spacingVerticalXS,
            marginBottom: tokens.spacingVerticalXS,
        },
        '& hr': {
            marginTop: tokens.spacingVerticalL,
            marginBottom: tokens.spacingVerticalL,
            border: 'none',
            borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
        },
        '& a': {
            color: tokens.colorBrandForeground1,
            textDecoration: 'none',
        },
        '& a:hover': {
            textDecoration: 'underline',
        },
    },
});

interface MarkdownCardProps {
    /**
     * Card title
     */
    title: string;

    /**
     * Markdown content to render
     */
    content: string;

    /**
     * Optional custom icon (defaults to BookInformation24Regular)
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
     * Ref to forward to the card element
     */
    ref?: React.Ref<HTMLDivElement>;
}

/**
 * Markdown card component for displaying educational content with rich formatting.
 * This component supports ref forwarding for use with animation libraries.
 *
 * **Usage with animations**: Use directly with animation libraries like @fluentui/react-motion-components-preview:
 *
 * ```tsx
 *  * <CollapseRelaxed visible={isVisible}>
 *     <MarkdownCard title="..." content="..." {...props} />
 * </CollapseRelaxed>
 * ```
 *
 * **Important**: The component applies `marginBottom: '16px'` by default for proper spacing in animated lists.
 * The margin is on the Card itself to ensure borders and shadows render immediately during collapse animations.
 */
// TODO: Copy content feature will be added in the next release - _onCopy parameter will be used then
export function MarkdownCard({
    title,
    content,
    icon,
    onCopy: _onCopy,
    showAiDisclaimer = true,
    ref,
}: MarkdownCardProps) {
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
                    />
                    <div className={styles.content}>
                        <ReactMarkdown>{content}</ReactMarkdown>
                    </div>
                </div>
            </div>
        </Card>
    );
}
