/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from '@jest/globals';
import * as fs from 'node:fs';
import * as path from 'node:path';

const fluentProgressEntry = require.resolve('@fluentui/react-progress');
const fluentProgressStylesPath = path.join(
    path.dirname(path.dirname(fluentProgressEntry)),
    'lib/components/ProgressBar/useProgressBarStyles.styles.raw.js',
);
const fluentProgressStyles = fs.readFileSync(fluentProgressStylesPath, 'utf8');
const fluentOverrides = fs.readFileSync(path.join(__dirname, 'fluentOverrides.scss'), 'utf8');

function compactWhitespace(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

describe('Fluent ProgressBar override contract', () => {
    test('Fluent indeterminate gradient retains the recipe adapted by our override', () => {
        expect(compactWhitespace(fluentProgressStyles)).toContain(
            compactWhitespace(`
                backgroundImage: \`linear-gradient(
                    to right,
                    \${tokens.colorNeutralBackground6} 0%,
                    \${tokens.colorTransparentBackground} 50%,
                    \${tokens.colorNeutralBackground6} 100%
                )\`,
            `),
        );
    });

    test('our indeterminate gradient retains Fluent direction and stop positions', () => {
        expect(compactWhitespace(fluentOverrides)).toContain(
            compactWhitespace(`
                background-image: linear-gradient(
                    to right,
                    transparent 0%,
                    var(--vscode-progressBar-background, var(--colorBrandStroke1)) 50%,
                    transparent 100%
                );
            `),
        );
    });
});
