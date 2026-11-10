/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { StatusListItem, type StatusListItemStatus } from '@microsoft/vscode-ext-webview-fluentui/components';
import * as l10n from '@vscode/l10n';
import { type JSX, type ReactNode, type RefObject, useCallback, useRef } from 'react';
import { type ProvisionStage } from '../../../services/localQuickStart/quickStartTypes';
import { SetupStageDetails } from './SetupStageDetails';
import { type StageDetailFact } from './stageDetailsPresentation';

interface SetupStageRowProps {
    readonly stage: ProvisionStage;
    readonly label: string;
    readonly status: StatusListItemStatus;
    readonly detail?: ReactNode;
    readonly facts?: readonly StageDetailFact[];
    readonly failureTitle?: string;
    readonly expanded: boolean;
    readonly onExpandedChange: (stage: ProvisionStage, expanded: boolean) => void;
    readonly focusFallback: RefObject<HTMLButtonElement | null>;
    readonly mutedClassName: string;
    readonly onShowOutput: () => void;
}

export const SetupStageRow = ({
    stage,
    label,
    status,
    detail,
    facts,
    failureTitle,
    expanded,
    onExpandedChange,
    focusFallback,
    mutedClassName,
    onShowOutput,
}: SetupStageRowProps): JSX.Element => {
    const attachedRef = useRef<HTMLButtonElement | null>(null);
    const toggleRef = useCallback(
        (element: HTMLButtonElement | null): void => {
            const previous = attachedRef.current;
            attachedRef.current = element;
            if (!element && previous?.contains(previous.ownerDocument.activeElement)) {
                focusFallback.current?.focus();
            }
        },
        [focusFallback],
    );
    const settledFacts = (status === 'done' || status === 'error') && facts?.length ? facts : undefined;
    return (
        <StatusListItem
            label={label}
            status={status}
            detail={detail}
            reserveDetailSpace
            disclosure={
                settledFacts
                    ? {
                          content: (
                              <SetupStageDetails
                                  facts={settledFacts}
                                  mutedClassName={mutedClassName}
                                  onShowOutput={onShowOutput}
                              />
                          ),
                          toggleText: l10n.t('Details'),
                          toggleLabel: l10n.t('Details for {0}', label),
                          toggleDescription: status === 'error' ? failureTitle : undefined,
                          expanded,
                          onExpandedChange: (next) => onExpandedChange(stage, next),
                          toggleRef,
                          placement: 'detail',
                      }
                    : undefined
            }
        />
    );
};
