/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FluentProvider } from '@fluentui/react-components';
import { type JSX, type PropsWithChildren } from 'react';
import { useActiveVSCodeTheme } from './useActiveVSCodeTheme';

/**
 * A `FluentProvider` whose theme tracks the user's active VS Code color theme.
 *
 * Wrap a webview's tree in this and Fluent's neutral ramp stops being Teams gray: surfaces,
 * strokes and the brand ramp all follow the workbench theme, including community themes.
 *
 * Built only from the package's own public API — `useActiveVSCodeTheme`, itself
 * `useActiveVSCodeThemeKind` + `createVSCodeFluentTheme` — so a consumer who has to own their
 * `FluentProvider` can assemble an identical result by hand.
 */
export const VSCodeFluentProvider = ({ children }: PropsWithChildren): JSX.Element => {
    const { theme } = useActiveVSCodeTheme();

    return <FluentProvider theme={theme}>{children}</FluentProvider>;
};

