/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dropdown, Option } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { useContext, type JSX } from 'react';
import { CollectionViewContext, Views } from '../../collectionViewContext';

export function ViewSwitcher({ onViewChanged }: { onViewChanged: (view: Views) => void }): JSX.Element {
    const [currentContext] = useContext(CollectionViewContext);
    const labels = {
        [Views.TABLE]: l10n.t('Table View'),
        [Views.TREE]: l10n.t('Tree View'),
        [Views.JSON]: l10n.t('JSON View'),
    };

    return (
        <Dropdown
            disabled={currentContext.isLoading}
            className="collectionDocumentViewSwitcher"
            value={labels[currentContext.currentView]}
            selectedOptions={[currentContext.currentView]}
            onOptionSelect={(_, data) => {
                const selection = Object.values(Views).find((view) => view === data.optionValue);
                if (selection !== undefined) {
                    onViewChanged(selection);
                }
            }}
            aria-label={l10n.t('Select view type')}
        >
            {Object.values(Views).map((view) => (
                <Option key={view} value={view}>
                    {labels[view]}
                </Option>
            ))}
        </Dropdown>
    );
}
