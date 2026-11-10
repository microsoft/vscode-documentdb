/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, tokens } from '@fluentui/react-components';
import { StatusListDetailsFacts, StatusListDetailsSection } from '@microsoft/vscode-ext-webview-fluentui/components';
import { type JSX } from 'react';
import { type StageDetailFact } from './stageDetailsPresentation';

const useStyles = makeStyles({
    root: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
});

export const SetupStageDetails = ({
    facts,
    mutedClassName,
}: {
    readonly facts: readonly StageDetailFact[];
    readonly mutedClassName: string;
}): JSX.Element => {
    const styles = useStyles();
    return (
        <div className={styles.root}>
            <StatusListDetailsSection>
                <StatusListDetailsFacts
                    items={facts.map((fact) => ({
                        term: fact.label,
                        value: (
                            <>
                                {fact.value}
                                {fact.note && (
                                    <span className={mutedClassName}>
                                        {' · '}
                                        {fact.note}
                                    </span>
                                )}
                            </>
                        ),
                    }))}
                />
            </StatusListDetailsSection>
        </div>
    );
};
