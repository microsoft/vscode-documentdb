/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, tokens } from '@fluentui/react-components';

/**
 * The base type of a `StatusListItem` disclosure region, and of every details building block, so a
 * block renders the same inside a region and on its own.
 *
 * `fontSizeBase200` and `lineHeightBase200` are the detail line's size: the region continues that
 * line, so it reads one step below the row title (base300) and never above it. The colour is the
 * primary foreground, not the detail line's secondary one, because the region is content, not a
 * caption; secondary text inside it is a choice the content makes.
 *
 * `code` is reset as well as set: VS Code's webview default stylesheet gives `code` its preformat
 * colour, a background, padding and rounded corners, which would turn every host name in a facts
 * list into a chip. Inside details, code is a typeface and nothing else.
 */
export const useDetailsTypographyStyles = makeStyles({
    base: {
        fontFamily: tokens.fontFamilyBase,
        fontSize: tokens.fontSizeBase200,
        fontWeight: tokens.fontWeightRegular,
        lineHeight: tokens.lineHeightBase200,
        color: tokens.colorNeutralForeground1,
        '& code': {
            fontFamily: tokens.fontFamilyMonospace,
            fontSize: 'inherit',
            lineHeight: 'inherit',
            color: 'inherit',
            backgroundColor: 'transparent',
            padding: 0,
            borderRadius: 0,
        },
    },
});
