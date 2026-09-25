/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Checkbox,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Divider,
    Link,
    Text,
} from '@fluentui/react-components';
import { ChatMailRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useEffect, useState, type JSX } from 'react';

export interface FeedbackDialogProps {
    /** Whether the dialog is open */
    open: boolean;

    /** Callback when dialog is closed */
    onClose: () => void;

    /** The sentiment: 'positive' or 'negative' */
    sentiment: 'positive' | 'negative';

    /** Callback when feedback is submitted */
    onSubmit: (feedback: { sentiment: 'positive' | 'negative'; selectedReasons: string[] }) => Promise<void>;
}

export const FeedbackDialog = ({ open, onClose, sentiment, onSubmit }: FeedbackDialogProps): JSX.Element => {
    const [selectedReasons, setSelectedReasons] = useState<Set<string>>(new Set());
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [consentChecked, setConsentChecked] = useState(false);

    // Reset selected reasons and consent when sentiment changes or dialog closes
    useEffect(() => {
        setSelectedReasons(new Set());
        setConsentChecked(false);
    }, [sentiment, open]);

    const positiveReasons = [
        l10n.t('Data shown was correct'),
        l10n.t('Helped me understand the query execution'),
        l10n.t('Recommendations were actionable'),
        l10n.t('Improved my query performance'),
    ];

    const negativeReasons = [
        l10n.t('Data shown was incorrect'),
        l10n.t('Information was confusing'),
        l10n.t('Recommendations were not helpful'),
        l10n.t('Missing important information'),
    ];

    const reasons = sentiment === 'positive' ? positiveReasons : negativeReasons;

    const handleReasonToggle = (reason: string) => {
        const newReasons = new Set(selectedReasons);
        if (newReasons.has(reason)) {
            newReasons.delete(reason);
        } else {
            newReasons.add(reason);
        }
        setSelectedReasons(newReasons);
    };

    const handleSubmit = async () => {
        setIsSubmitting(true);
        try {
            await onSubmit({
                sentiment,
                selectedReasons: Array.from(selectedReasons),
            });
            // Reset state
            setSelectedReasons(new Set());
            onClose();
        } catch (error) {
            console.error('Failed to submit feedback:', error);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleClose = () => {
        if (!isSubmitting) {
            setSelectedReasons(new Set());
            setConsentChecked(false);
            onClose();
        }
    };

    const consentNoticeText = l10n.t(
        'Microsoft will process the feedback data you submit on behalf of your organization in accordance with the Data Protection Addendum between your organization and Microsoft.',
    );

    return (
        <Dialog open={open} onOpenChange={(_, data) => !data.open && handleClose()}>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span>
                                {sentiment === 'positive'
                                    ? l10n.t('Thank you for your feedback!')
                                    : l10n.t('Thank you for helping us improve!')}
                            </span>
                            <ChatMailRegular fontSize={36} />
                        </div>
                    </DialogTitle>
                    <DialogContent>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <Text>
                                {sentiment === 'positive'
                                    ? l10n.t(
                                          'Your positive feedback helps us understand what works well in Query Insights. Tell us more:',
                                      )
                                    : l10n.t(
                                          'Your feedback helps us improve Query Insights. Tell us what could be better:',
                                      )}
                            </Text>

                            {/* Checkbox reasons */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {reasons.map((reason) => (
                                    <Checkbox
                                        key={reason}
                                        label={reason}
                                        checked={selectedReasons.has(reason)}
                                        onChange={() => handleReasonToggle(reason)}
                                    />
                                ))}
                            </div>

                            {/* Invitation for more feedback */}
                            <div
                                style={{
                                    padding: '12px',
                                    backgroundColor: 'var(--colorNeutralBackground3)',
                                    borderRadius: '4px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '8px',
                                }}
                            >
                                <Text size={200}>
                                    {l10n.t(
                                        'These signals help us improve, but more context in a discussion, issue report, or a direct message adds even more value. ',
                                    )}
                                    <Link
                                        href="https://github.com/microsoft/vscode-documentdb/discussions"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        {l10n.t('Start a discussion')}
                                    </Link>
                                    {l10n.t(' or ')}{' '}
                                    <Link
                                        href="https://github.com/microsoft/vscode-documentdb/issues/new"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        {l10n.t('report an issue')}
                                    </Link>
                                    {l10n.t(' on GitHub.')}
                                </Text>
                            </div>

                            {/* Horizontal divider */}
                            <Divider />

                            {/* Privacy consent section */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                {/* Consent checkbox */}
                                <Checkbox
                                    required
                                    checked={consentChecked}
                                    onChange={(_, data) => setConsentChecked(data.checked === true)}
                                    label={
                                        <Text>
                                            {l10n.t('I have read and agree to the ')}{' '}
                                            <Link
                                                href="https://go.microsoft.com/fwlink/?LinkId=521839"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                            >
                                                {l10n.t('Privacy Statement')}
                                            </Link>
                                        </Text>
                                    }
                                />

                                {/* Privacy notice text */}
                                <Text size={100}>{consentNoticeText}</Text>
                            </div>
                        </div>
                    </DialogContent>
                    <DialogActions>
                        <Button
                            appearance="primary"
                            onClick={() => void handleSubmit()}
                            disabled={isSubmitting || !consentChecked}
                        >
                            {isSubmitting ? l10n.t('Submitting...') : l10n.t('Submit Feedback')}
                        </Button>
                        <Button appearance="secondary" onClick={handleClose} disabled={isSubmitting}>
                            {l10n.t('Cancel')}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};

FeedbackDialog.displayName = 'FeedbackDialog';
