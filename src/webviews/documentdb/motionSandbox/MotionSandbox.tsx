/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * **Internal developer tool — not shipped to end users.**
 *
 * Root component of the Motion Sandbox webview. Hosts three independent
 * experimental panels:
 *
 *  1. {@link CleanCollapseLab} — the simplest case: a single Collapse with
 *     a Show/Hide button. Confirms (without any reducer noise) whether
 *     Collapse's enter motion fires on a fresh mount.
 *
 *  2. {@link StaggerLab} — wraps an array of presence motion components
 *     in `Stagger` so the user can see how Fluent's choreography helper
 *     behaves with each variant. Lets us pick `itemDelay`, motion variant,
 *     `hideMode`, `delayMode`, and `reversed`.
 *
 *  3. {@link AddFromTopLab} — the production scenario we care about:
 *     items get prepended to a list. Lets us A/B every motion variant on
 *     the same insert-at-top action and decide which (if any) does NOT
 *     cause the existing items to jump.
 *
 * No tRPC, no telemetry, no localised strings — this view never reaches
 * a customer build.
 */

import { tokens } from '@fluentui/react-components';
import { type JSX } from 'react';
import { AddFromTopLab, CleanCollapseLab, StaggerLab } from './labs';

export const MotionSandbox = (): JSX.Element => {
    return (
        <div
            style={{
                padding: tokens.spacingVerticalL,
                display: 'flex',
                flexDirection: 'column',
                gap: tokens.spacingVerticalL,
                maxWidth: '900px',
                margin: '0 auto',
            }}
        >
            <h1 style={{ margin: 0, fontSize: tokens.fontSizeBase600 }}>Fluent UI Motion Sandbox</h1>
            <p style={{ margin: 0, color: tokens.colorNeutralForeground3 }}>
                Internal experimental playground. No data, no IPC, no tRPC. Use this view to compare presence
                animations, the Stagger choreography helper, and the &quot;add new item at the top of a list&quot;
                scenario.
            </p>

            <CleanCollapseLab />
            <StaggerLab />
            <AddFromTopLab />
        </div>
    );
};
