/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Dev-only design preview (POC): reached only through the L2 scenario config flag
// `designPreview: 'tab-model-selection'`. Strings intentionally not localized.

import { Badge, Link, makeStyles, Text, tokens } from '@fluentui/react-components';
import { useRef, useState, useId, type ComponentType, type JSX, type ReactNode } from 'react';
import type { CommandType } from '../../../../commands/llmEnhancedCommands/indexAdvisorCommands';
import type { AvailableModelInfo } from '../../../../services/ai/modelSelection';
import { PerformanceInsightsCardComparison } from '../../collectionView/queryInsightsTab/components/optimizationCards/custom/PerformanceInsightsCardComparison';
import { HeaderChipOption, StaticModelSettings } from './HeaderChipOption';
import { PREVIEW_SAVED_MODEL_ID } from './mockModels';
import { ModelPillOption, type OptionProps } from './ModelPillOption';
import { BODY_TEXT, PopoverFrame, StaticModelMenu } from './previewParts';
import { QuickPickMock, QuickPickOption } from './QuickPickOption';
import { SettingsStripOption } from './SettingsStripOption';
import { SplitButtonOption, StaticSplitMenu } from './SplitButtonOption';

const useStyles = makeStyles({
    page: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalXXXL,
        maxWidth: '1360px',
        margin: '0 auto',
        padding: `${tokens.spacingVerticalXXL} ${tokens.spacingHorizontalXXL}`,
        boxSizing: 'border-box',
    },
    intro: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS, maxWidth: '920px' },
    heading: { margin: 0, display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS, flexWrap: 'wrap' },
    section: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalM,
        paddingTop: tokens.spacingVerticalXL,
        borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    },
    rationale: { color: tokens.colorNeutralForeground2, maxWidth: '920px' },
    frames: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(460px, 1fr))',
        gap: `${tokens.spacingVerticalXL} ${tokens.spacingHorizontalXXL}`,
        alignItems: 'start',
        marginTop: tokens.spacingVerticalS,
    },
    figure: { margin: 0, display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS, minWidth: 0 },
    caption: {
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase200,
        fontWeight: tokens.fontWeightSemibold,
    },
});

function Frame({ caption, children }: { caption: string; children: ReactNode }): JSX.Element {
    const styles = useStyles();
    return (
        <figure className={styles.figure}>
            <figcaption className={styles.caption}>{caption}</figcaption>
            {children}
        </figure>
    );
}

function OpenFrame({
    caption,
    option: OptionComponent,
    surface,
    align,
}: {
    caption: string;
    option: ComponentType<OptionProps>;
    surface: ReactNode;
    align?: 'start' | 'end';
}): JSX.Element {
    const anchorRef = useRef<HTMLSpanElement>(null);
    return (
        <Frame caption={caption}>
            <PopoverFrame
                anchorRef={anchorRef}
                align={align}
                card={<OptionComponent initialModelId={PREVIEW_SAVED_MODEL_ID} anchorRef={anchorRef} />}
                surface={surface}
            />
        </Frame>
    );
}

function OptionSection({
    heading,
    rationale,
    recommended,
    children,
}: {
    heading: string;
    rationale: ReactNode;
    recommended?: boolean;
    children: ReactNode;
}): JSX.Element {
    const styles = useStyles();
    const id = useId();
    return (
        <section className={styles.section} aria-labelledby={id}>
            <Text as="h2" size={500} weight="semibold" id={id} className={styles.heading}>
                {heading}
                {recommended && <Badge appearance="tint" shape="rounded" size="small" color="brand">Recommended</Badge>}
            </Text>
            <Text as="p" size={300} className={styles.rationale} style={{ margin: 0 }}>{rationale}</Text>
            <div className={styles.frames}>{children}</div>
        </section>
    );
}

const IDLE = 'Idle · saved choice GPT-6.1 Sol (medium cost)';
const UTILITY = 'Idle · Copilot utility';

function CurrentDesign(): JSX.Element {
    const [promptLabel, setPromptLabel] = useState<string>();
    const [selected, setSelected] = useState<AvailableModelInfo>();
    const noop = (): void => undefined;
    return (
        <PerformanceInsightsCardComparison
            commandType={'find' as CommandType}
            onModelChange={setSelected}
            onPromptLabelChange={setPromptLabel}
            className="cardSpacing"
            bodyText={BODY_TEXT}
            isLoading={false}
            enabled={!!selected}
            promptLabel={promptLabel}
            mayUsePremiumRequests={!selected?.isUtility}
            secondaryLink={<Link inline>Explore with your own input…</Link>}
            onGetInsights={noop}
            onLearnMore={noop}
            onCancel={noop}
            onLearnMoreUtilityModel={noop}
        />
    );
}

export function QueryInsightsDesignPreview(): JSX.Element {
    const styles = useStyles();
    return (
        <main className={styles.page}>
            <div className={styles.intro}>
                <Text as="h1" size={700} weight="semibold" className={styles.heading}>
                    Query Insights tab · model selection options
                </Text>
                <Text size={300} className={styles.rationale}>
                    Dev-only design preview of the “AI Performance Insights” card in the Collection View. Mock data,
                    nothing is sent. Every option keeps the primary action, the model and how to change it, the cost
                    tier (utility: no badge, the careful footnote instead), the prompt source, “Explore with your own input…”, “Learn more” and the
                    “AI responses may be inaccurate” disclaimer. Menus and popovers are interactive; the “open”
                    frames show a static copy so they can be compared side by side.
                </Text>
            </div>

            <OptionSection
                heading="Option A — Model pill in the actions row"
                recommended
                rationale="Mirrors the VS Code Chat model picker: a subtle pill next to the button reads “Get insights with GPT-6.1 Sol · Medium cost” and opens a grouped radio menu with a cost badge per model. Everything else collapses into one muted footer line. Trade-off: the pill is a second control in the button row and the menu is a webview popup, not native."
            >
                <Frame caption={IDLE}><ModelPillOption initialModelId={PREVIEW_SAVED_MODEL_ID} /></Frame>
                <Frame caption="Idle · Claude Opus 5.5 (very high cost → warning tint)"><ModelPillOption initialModelId="claude-opus-5.5" /></Frame>
                <Frame caption={UTILITY}><ModelPillOption initialModelId="copilot-utility" /></Frame>
                <OpenFrame caption="Model menu open" option={ModelPillOption} surface={<StaticModelMenu selectedId={PREVIEW_SAVED_MODEL_ID} />} />
            </OptionSection>

            <OptionSection
                heading="Option B — Split button"
                rationale="One control: the primary action, with a chevron that holds the model radio group and “Explore with your own input…”. The chosen model and its cost sit as muted meta text under the row. Trade-off: model choice is hidden behind a chevron users rarely open, and a split menu usually means alternative actions, not settings."
            >
                <Frame caption={IDLE}><SplitButtonOption initialModelId={PREVIEW_SAVED_MODEL_ID} /></Frame>
                <Frame caption={UTILITY}><SplitButtonOption initialModelId="copilot-utility" /></Frame>
                <OpenFrame caption="Split menu open" option={SplitButtonOption} surface={<StaticSplitMenu selectedId={PREVIEW_SAVED_MODEL_ID} />} align="start" />
            </OptionSection>

            <OptionSection
                heading="Option C — Settings footer strip"
                rationale="The card body stays exactly as shipped (title, text, two buttons). Below a divider, a compact label/value strip — Model · Prompt — like the wizard's settings table, with “Change” and “Explore…” as links. Trade-off: the tallest option, and the cost is read after the button rather than next to it."
            >
                <Frame caption={IDLE}><SettingsStripOption initialModelId={PREVIEW_SAVED_MODEL_ID} /></Frame>
                <Frame caption={UTILITY}><SettingsStripOption initialModelId="copilot-utility" /></Frame>
                <OpenFrame caption="“Change” menu open" option={SettingsStripOption} surface={<StaticModelMenu selectedId={PREVIEW_SAVED_MODEL_ID} />} />
            </OptionSection>

            <OptionSection
                heading="Option D — Native VS Code quick pick"
                rationale="The card only names the model; “Change model…” asks the host to open vscode.window.showQuickPick (separator per category, description = cost tier · context, detail = credits). Native keyboard, filtering and accessibility, and the same picker can back a command. Trade-off: plain text only (no tinted badge in the list), the picker opens at the top of the window, and it needs a new host RPC."
            >
                <Frame caption={IDLE}><QuickPickOption initialModelId={PREVIEW_SAVED_MODEL_ID} /></Frame>
                <Frame caption={UTILITY}><QuickPickOption initialModelId="copilot-utility" /></Frame>
                <Frame caption="“Change model…” → native quick pick (static mock)">
                    <div inert><QuickPickMock selectedId={PREVIEW_SAVED_MODEL_ID} /></div>
                </Frame>
            </OptionSection>

            <OptionSection
                heading="Option E — Header chip with a settings popover"
                rationale="The model becomes context for the whole card: a chip in the header (where the disclaimer was) opens a small popover with the model dropdown, cost tier and credits, context, prompt and Explore. The action row is untouched; the disclaimer moves to the footer. Trade-off: a popover containing a dropdown is two levels of popup, and the chip is easy to overlook in the header."
            >
                <Frame caption={IDLE}><HeaderChipOption initialModelId={PREVIEW_SAVED_MODEL_ID} /></Frame>
                <Frame caption={UTILITY}><HeaderChipOption initialModelId="copilot-utility" /></Frame>
                <OpenFrame caption="Settings popover open" option={HeaderChipOption} surface={<StaticModelSettings selectedId={PREVIEW_SAVED_MODEL_ID} />} align="end" />
            </OptionSection>

            <OptionSection
                heading="Live comparison — six real cards"
                rationale="The same comparison component used in the Collection View tab, with working Fluent controls and a shared selection. Only the model data and analysis action are mocked on this preview page."
            >
                <Frame caption={IDLE}><CurrentDesign /></Frame>
            </OptionSection>
        </main>
    );
}
