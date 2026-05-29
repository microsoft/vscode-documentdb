/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Stagger lab — exercises Fluent's new `Stagger` choreography helper
 * (`@fluentui/react-motion-components-preview` ≥ 0.15.0). `Stagger`
 * ripples enter / exit transitions across its children; this lab lets
 * us vary the per-child motion variant, item delay, hide mode, and delay
 * mode, plus toggle `reversed`.
 *
 * What we're trying to learn:
 *  - Is `Stagger` a viable replacement for our hand-rolled
 *    `AnimatedCardList` for the case of "show/hide the whole list"?
 *  - Does the `hideMode="unmount"` option fit the production scenario
 *    where cards genuinely come and go?
 *  - With `Collapse` as the per-item motion, do existing siblings
 *    behave correctly during a ripple (i.e. height grows / shrinks
 *    smoothly per item)?
 *
 * `Stagger` does NOT solve the "insert one new card at the top of an
 * existing list" case — for that, see {@link AddFromTopLab}. Stagger is
 * a group-presence helper, so the natural pattern is to toggle the
 * entire group visible/hidden together.
 */

import {
    Button,
    Card,
    CardHeader,
    Dropdown,
    Field,
    Input,
    Option,
    Switch,
    Text,
    tokens,
} from '@fluentui/react-components';
import { ArrowResetRegular, EyeOffRegular, EyeRegular, PlayRegular } from '@fluentui/react-icons';
import { Stagger } from '@fluentui/react-motion-components-preview';
import { useCallback, useState, type JSX, type ReactElement } from 'react';
import { DemoCard, MOTIONS, type MotionKey } from './shared';

type HideMode = 'visibleProp' | 'visibilityStyle' | 'unmount';
type DelayMode = 'timing' | 'delayProp';

export function StaggerLab(): JSX.Element {
    const [motionKey, setMotionKey] = useState<MotionKey>('collapse');
    const [itemDelay, setItemDelay] = useState(100);
    const [reversed, setReversed] = useState(false);
    const [hideMode, setHideMode] = useState<HideMode>('visibleProp');
    const [delayMode, setDelayMode] = useState<DelayMode>('timing');
    const [count, setCount] = useState(5);
    const [visible, setVisible] = useState(true);
    const [replayKey, setReplayKey] = useState(0);

    const motion = MOTIONS[motionKey];

    // Wrap each child in the chosen presence motion. `Stagger` cycles
    // them according to `itemDelay`. Per the Fluent docs, when a child
    // is a motion component, Stagger passes `visible` (and optionally
    // `delay`) through to drive the animation — that's why each child
    // here is a motion wrapper around a plain card.
    const children: ReactElement[] = Array.from({ length: count }, (_, i) => {
        const Wrapper = motion.Wrapper;
        return (
            <Wrapper key={i}>
                <div>
                    <DemoCard title={`Stagger item #${i + 1}`} />
                </div>
            </Wrapper>
        );
    });

    const replay = useCallback(() => {
        // Bumping replayKey remounts the Stagger subtree so we get a
        // clean enter sequence. Useful when the user just wants to "see
        // it again" without manually toggling visible off and on.
        setReplayKey((k) => k + 1);
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
                        Stagger choreography
                    </Text>
                }
                description={
                    <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                        Wraps N motion-wrapped cards in <code>Stagger</code> and toggles the whole group
                        visible / hidden. Best for group presence, NOT for "prepend one new item to a list" —
                        use the lab below for that.
                    </Text>
                }
            />

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalL }}>
                <Field label="Per-item motion">
                    <Dropdown
                        value={motion.label}
                        selectedOptions={[motionKey]}
                        onOptionSelect={(_, data) => {
                            if (data.optionValue) setMotionKey(data.optionValue as MotionKey);
                        }}
                        style={{ minWidth: '220px' }}
                    >
                        {Object.entries(MOTIONS).map(([key, { label }]) => (
                            <Option key={key} value={key}>
                                {label}
                            </Option>
                        ))}
                    </Dropdown>
                </Field>
                <Field label="Item count">
                    <Input
                        type="number"
                        value={String(count)}
                        onChange={(_, data) => setCount(Math.max(1, Math.min(20, Number(data.value) || 1)))}
                        style={{ width: '90px' }}
                    />
                </Field>
                <Field label="itemDelay (ms)">
                    <Input
                        type="number"
                        value={String(itemDelay)}
                        onChange={(_, data) => setItemDelay(Math.max(0, Number(data.value) || 0))}
                        style={{ width: '110px' }}
                    />
                </Field>
                <Field label="reversed">
                    <Switch checked={reversed} onChange={(_, data) => setReversed(data.checked)} />
                </Field>
                <Field label="hideMode">
                    <Dropdown
                        value={hideMode}
                        selectedOptions={[hideMode]}
                        onOptionSelect={(_, data) => {
                            if (data.optionValue) setHideMode(data.optionValue as HideMode);
                        }}
                        style={{ minWidth: '180px' }}
                    >
                        <Option value="visibleProp">visibleProp (default for motion children)</Option>
                        <Option value="visibilityStyle">visibilityStyle (preserve layout)</Option>
                        <Option value="unmount">unmount (reflow on enter/exit)</Option>
                    </Dropdown>
                </Field>
                <Field label="delayMode">
                    <Dropdown
                        value={delayMode}
                        selectedOptions={[delayMode]}
                        onOptionSelect={(_, data) => {
                            if (data.optionValue) setDelayMode(data.optionValue as DelayMode);
                        }}
                        style={{ minWidth: '180px' }}
                    >
                        <Option value="timing">timing (setTimeout)</Option>
                        <Option value="delayProp">delayProp (native delay)</Option>
                    </Dropdown>
                </Field>
            </div>

            <div
                style={{
                    display: 'flex',
                    gap: tokens.spacingHorizontalS,
                    marginTop: tokens.spacingVerticalL,
                    flexWrap: 'wrap',
                }}
            >
                {visible ? (
                    <Button appearance="primary" icon={<EyeOffRegular />} onClick={() => setVisible(false)}>
                        Hide group
                    </Button>
                ) : (
                    <Button appearance="primary" icon={<EyeRegular />} onClick={() => setVisible(true)}>
                        Show group
                    </Button>
                )}
                <Button icon={<PlayRegular />} onClick={replay}>
                    Replay (remount, #{replayKey})
                </Button>
                <Button icon={<ArrowResetRegular />} onClick={() => setItemDelay(100)}>
                    Reset itemDelay
                </Button>
            </div>

            <div
                key={replayKey}
                style={{
                    marginTop: tokens.spacingVerticalL,
                    padding: tokens.spacingVerticalM,
                    border: `1px dotted ${tokens.colorNeutralStroke2}`,
                    borderRadius: tokens.borderRadiusMedium,
                    backgroundColor: tokens.colorNeutralBackground1,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: tokens.spacingVerticalM,
                    minHeight: '300px',
                }}
            >
                <Stagger
                    visible={visible}
                    reversed={reversed}
                    itemDelay={itemDelay}
                    hideMode={hideMode}
                    delayMode={delayMode}
                >
                    {children}
                </Stagger>
            </div>
        </Card>
    );
}
