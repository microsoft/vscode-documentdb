/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from '@jest/globals';
import * as fs from 'node:fs';
import * as path from 'node:path';

function readFluentProgressStyles(): string {
    // require.resolve lands on <package>/lib-commonjs/index.js; the raw (pre-Griffel) styles ship
    // beside the ESM build.
    const packageRoot = path.dirname(path.dirname(require.resolve('@fluentui/react-progress')));
    const stylesPath = path.join(packageRoot, 'lib/components/ProgressBar/useProgressBarStyles.styles.raw.js');

    if (!fs.existsSync(stylesPath)) {
        throw new Error(
            `@fluentui/react-progress no longer exposes its raw ProgressBar styles at "${stylesPath}". ` +
                'Locate the new file and re-verify the indeterminate override in fluentOverrides.scss.',
        );
    }

    return fs.readFileSync(stylesPath, 'utf8');
}

function compactWhitespace(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

describe('Fluent ProgressBar override contract', () => {
    test('Fluent indeterminate gradient retains the recipe adapted by our override', () => {
        expect(compactWhitespace(readFluentProgressStyles())).toContain(
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

    test('the override re-points every stop the Fluent recipe reads', () => {
        const scss = fs.readFileSync(path.join(__dirname, 'fluentOverrides.scss'), 'utf8');

        // The adaptation works by retargeting the three tokens above rather than by declaring a
        // background-image, which is what lets the rule stay at zero specificity. Drop one and
        // the indeterminate bar goes blank instead of failing loudly.
        expect(scss).toContain('--colorNeutralBackground6: transparent;');
        expect(scss).toContain('--colorCompoundBrandBackground: transparent;');
        expect(scss).toContain('--colorTransparentBackground: var(--vscode-progressBar-background');
    });
});
