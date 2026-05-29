/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Clean Collapse experiment — the absolute minimum case: a single
 * Collapse with a Show/Hide button. Verifies (without any reducer,
 * choreography, or animation queue around it) that:
 *
 *  - the **enter** motion fires on a true `visible: false → true`
 *    transition,
 *  - the **enter** motion fires on first mount when `appear={true}`,
 *  - the **enter** motion is SKIPPED on first mount when `appear={false}`
 *    (the default — and the cause of the production "cards just pop in"
 *    bug we just fixed in AnimatedCardList).
 *
 * Use this lab when you suspect AnimatedCardList's queue management is
 * obscuring the framework's actual behaviour. If Collapse works here but
 * not in production, the bug is in the queue, not the framework.
 */

import { Button, Card, CardHeader, Field, Switch, Text, tokens } from '@fluentui/react-components';
import { ArrowResetRegular, EyeOffRegular, EyeRegular } from '@fluentui/react-icons';
import { Collapse } from '@fluentui/react-motion-components-preview';
import { useCallback, useState, type JSX } from 'react';
import { DemoCard } from './shared';

export function CleanCollapseLab(): JSX.Element {
    const [visible, setVisible] = useState(true);
    const [appear, setAppear] = useState(true);
    const [mountKey, setMountKey] = useState(0);

    // Bumping `mountKey` swaps the test subtree's key, forcing React to
    // unmount + remount it. That's the canonical way to re-test `appear`
    // first-mount behaviour without reloading the whole webview.
    const remount = useCallback(() => {
        setMountKey((k) => k + 1);
        setVisible(true);
    }, []);

    return (
        <Card
            style={{
                backgroundColor: tokens.colorNeutralBackground2,
                border: `1px dashed ${tokens.colorNeutralStroke2}`,
            }}
        >
            <CardHeader
                header={
                    <Text weight="semibold" size={400}>
                        Clean Collapse
                    </Text>
                }
                description={
                    <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                        Smallest possible test: one Collapse, one Show/Hide button. Toggle <code>appear</code>{' '}
                        to see whether the framework animates on first mount.
                    </Text>
                }
            />

            <div style={{ display: 'flex', gap: tokens.spacingHorizontalL, flexWrap: 'wrap' }}>
                <Field
                    label="appear"
                    hint="OFF reproduces the original 'no enter animation' bug — first mount has no enter."
                >
                    <Switch checked={appear} onChange={(_, data) => setAppear(data.checked)} />
                </Field>
                <div style={{ alignSelf: 'flex-end', display: 'flex', gap: tokens.spacingHorizontalS }}>
                    {visible ? (
                        <Button appearance="primary" icon={<EyeOffRegular />} onClick={() => setVisible(false)}>
                            Hide
                        </Button>
                    ) : (
                        <Button appearance="primary" icon={<EyeRegular />} onClick={() => setVisible(true)}>
                            Show
                        </Button>
                    )}
                    <Button icon={<ArrowResetRegular />} onClick={remount}>
                        Remount (mount #{mountKey})
                    </Button>
                </div>
            </div>

            {/* min-height keeps the surrounding card stable while the
                inner Collapse animates its own height — that way we're
                only observing the test subject, not surrounding reflow. */}
            <div
                key={mountKey}
                style={{
                    marginTop: tokens.spacingVerticalL,
                    minHeight: '220px',
                    padding: tokens.spacingVerticalM,
                    border: `1px dotted ${tokens.colorNeutralStroke2}`,
                    borderRadius: tokens.borderRadiusMedium,
                    backgroundColor: tokens.colorNeutralBackground1,
                }}
            >
                <Collapse visible={visible} appear={appear}>
                    <div>
                        <DemoCard title="Collapse subject" />
                    </div>
                </Collapse>
            </div>
        </Card>
    );
}
