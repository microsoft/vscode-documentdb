/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Dev-only design preview (POC); strings intentionally not localized.

import {
    Button,
    Menu,
    MenuDivider,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    SplitButton,
    type MenuButtonProps,
} from '@fluentui/react-components';
import { OpenRegular, SparkleRegular } from '@fluentui/react-icons';
import { useState, type JSX } from 'react';
import { previewModel, previewModels } from './mockModels';
import { type OptionProps } from './ModelPillOption';
import {
    CostBadge,
    InsightsCardShell,
    MetaItems,
    ModelMenuGroups,
    StaticModelMenu,
    usePreviewStyles,
} from './previewParts';

function SplitMenuExtra(): JSX.Element {
    return (
        <>
            <MenuDivider />
            <MenuItem icon={<OpenRegular />}>Explore with your own input…</MenuItem>
        </>
    );
}

/** The split button's menu: the model radio group plus the secondary "Explore…" action. */
export function StaticSplitMenu({ selectedId }: { selectedId: string }): JSX.Element {
    return <StaticModelMenu selectedId={selectedId} extra={<SplitMenuExtra />} />;
}

/** Option B: split button; the chevron holds model choice and Explore, meta text sits under the row. */
export function SplitButtonOption({ initialModelId, anchorRef }: OptionProps): JSX.Element {
    const styles = usePreviewStyles();
    const [modelId, setModelId] = useState(initialModelId);
    const model = previewModel(modelId);
    return (
        <InsightsCardShell>
            <div className={styles.actions}>
                <span ref={anchorRef} className={styles.anchor}>
                    <Menu
                        positioning="below-end"
                        hasCheckmarks
                        checkedValues={{ model: [modelId] }}
                        onCheckedValueChange={(_event, data) => {
                            if (data.checkedItems[0]) setModelId(data.checkedItems[0]);
                        }}
                    >
                        <MenuTrigger disableButtonEnhancement>
                            {(triggerProps: MenuButtonProps) => (
                                <SplitButton
                                    appearance="primary"
                                    icon={<SparkleRegular />}
                                    menuButton={{
                                        ...triggerProps,
                                        'aria-label': 'Choose the Copilot model and more options',
                                    }}
                                >
                                    Get AI Performance Insights
                                </SplitButton>
                            )}
                        </MenuTrigger>
                        <MenuPopover>
                            <MenuList>
                                <ModelMenuGroups models={previewModels} />
                                <SplitMenuExtra />
                            </MenuList>
                        </MenuPopover>
                    </Menu>
                </span>
                <Button appearance="subtle" aria-label="Learn more about AI Performance Insights">
                    Learn more
                </Button>
            </div>
            <div className={styles.metaLine}>
                <MetaItems
                    items={[
                        <span key="model" className={styles.pillContent}>
                            <span>
                                Using <span className={styles.strong}>{model.name}</span>
                            </span>
                            <CostBadge model={model} />
                        </span>,
                        'Built-in prompt',
                    ]}
                />
            </div>
        </InsightsCardShell>
    );
}
