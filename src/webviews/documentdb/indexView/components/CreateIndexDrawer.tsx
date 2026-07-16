/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Combobox,
    DrawerBody,
    DrawerHeader,
    DrawerHeaderTitle,
    Dropdown,
    Field,
    Input,
    MessageBar,
    MessageBarBody,
    MessageBarTitle,
    Option,
    OverlayDrawer,
    Switch,
    Textarea,
    Tooltip,
} from '@fluentui/react-components';
import {
    AddRegular,
    ArrowLeftRegular,
    ArrowResetRegular,
    ChevronRightRegular,
    DeleteRegular,
    PanelRightContractRegular,
    SettingsRegular,
} from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useMemo, useState, type JSX, type ReactNode } from 'react';
import { LARGE_COLLECTION_THRESHOLD_DOCS } from '../constants';
import { type CreateIndexInput, type FieldIndexType } from '../types';

/** Which pane of the drawer is visible. Advanced is a pushed sub-page. */
type DrawerPage = 'main' | 'advanced';

/**
 * Local row state for the editable fields list. Each row gets a stable id so
 * React can key it across reorders without relying on the field name (which
 * can be empty mid-edit). `type` defaults to ascending so a freshly added row
 * is immediately usable.
 */
interface FieldDraft {
    id: string;
    field: string;
    type: FieldIndexType;
}

function makeFieldId(): string {
    return `field-${Math.random().toString(36).slice(2, 10)}`;
}

const INITIAL_FIELD = (): FieldDraft => ({ id: makeFieldId(), field: '', type: 'asc' });

/**
 * Build the localised per-field type options lazily inside the component so
 * `l10n.t()` is invoked after the localisation bundle has loaded. Ascending /
 * Descending cover the common case; the special key types follow.
 */
function buildTypeLabels(): ReadonlyArray<{ value: FieldIndexType; label: string }> {
    return [
        { value: 'asc', label: l10n.t('Ascending (1)') },
        { value: 'desc', label: l10n.t('Descending (-1)') },
        { value: 'text', label: l10n.t('Text') },
        { value: '2dsphere', label: l10n.t('Geospatial (2dsphere)') },
        { value: 'hashed', label: l10n.t('Hashed') },
    ];
}

/** True when `type` is an ordinary ascending/descending b-tree key. */
function isBTreeType(type: FieldIndexType): boolean {
    return type === 'asc' || type === 'desc';
}

/**
 * Parse a JSON-object text field (partial filter / collation). Empty input is
 * valid (the option is simply omitted); non-empty input must be a JSON object.
 */
function parseJsonObject(text: string): { value?: Record<string, unknown>; error?: string } {
    const trimmed = text.trim();
    if (trimmed === '') {
        return {};
    }
    try {
        const parsed: unknown = JSON.parse(trimmed);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            return { error: l10n.t('Enter a JSON object.') };
        }
        return { value: parsed as Record<string, unknown> };
    } catch {
        return { error: l10n.t('Invalid JSON.') };
    }
}

/** A titled form section with a short explanation above its inputs. */
function DrawerSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }): JSX.Element {
    return (
        <section className="drawerSection">
            <div className="drawerSectionTitle">{title}</div>
            {hint && <div className="drawerSectionHint">{hint}</div>}
            <div className="drawerSectionBody">{children}</div>
        </section>
    );
}

export interface CreateIndexDrawerProps {
    open: boolean;
    /** Suggested field names from the schema scanner. */
    fieldSuggestions: ReadonlyArray<string>;
    /** Document count used to decide whether to surface the large-collection banner. */
    documentCount: number;
    onCancel: () => void;
    onSubmit: (input: CreateIndexInput) => Promise<void>;
}

/**
 * Create Index experience, rendered as a Fluent overlay drawer pinned to the
 * end (right) of the panel. The primary pane covers the common case (fields +
 * index-level options); rarely-needed settings live on a pushed "Advanced"
 * sub-page reached via the header back button.
 *
 * Form state is intentionally preserved when the drawer is hidden — users who
 * set up a complex compound index do not lose their work on an accidental
 * close — and is only cleared via "Reset form" or after a successful creation.
 */
export const CreateIndexDrawer = ({
    open,
    fieldSuggestions,
    documentCount,
    onCancel,
    onSubmit,
}: CreateIndexDrawerProps): JSX.Element => {
    const [page, setPage] = useState<DrawerPage>('main');
    const [fields, setFields] = useState<FieldDraft[]>([INITIAL_FIELD()]);
    const [name, setName] = useState('');
    const [unique, setUnique] = useState(false);
    const [sparse, setSparse] = useState(false);
    const [ttlEnabled, setTtlEnabled] = useState(false);
    const [ttlSeconds, setTtlSeconds] = useState<string>('');
    const [partialText, setPartialText] = useState('');
    const [collationText, setCollationText] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const typeLabels = useMemo(() => buildTypeLabels(), []);

    const reset = (): void => {
        setPage('main');
        setFields([INITIAL_FIELD()]);
        setName('');
        setUnique(false);
        setSparse(false);
        setTtlEnabled(false);
        setTtlSeconds('');
        setPartialText('');
        setCollationText('');
        setSubmitting(false);
    };

    // Closing preserves the form; only an explicit reset (or a successful
    // create) clears it.
    const handleCancel = (): void => {
        if (submitting) {
            return;
        }
        onCancel();
    };

    const addField = (): void => {
        setFields((prev) => [...prev, INITIAL_FIELD()]);
    };

    const removeField = (id: string): void => {
        setFields((prev) => (prev.length > 1 ? prev.filter((f) => f.id !== id) : prev));
    };

    const updateField = (id: string, patch: Partial<Omit<FieldDraft, 'id'>>): void => {
        setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
    };

    // Only rows with a field name contribute to the index; the type always has
    // a value (defaults to ascending).
    const completedRows = useMemo(() => fields.filter((f) => f.field.trim().length > 0), [fields]);

    // TTL is only valid on a single-field b-tree index.
    const isSingleBTree = completedRows.length === 1 && isBTreeType(completedRows[0].type);

    const partial = useMemo(() => parseJsonObject(partialText), [partialText]);
    const collation = useMemo(() => parseJsonObject(collationText), [collationText]);

    // Sparse and a partial filter are mutually exclusive on the server.
    const sparseDisabled = partial.value !== undefined;
    const ttlActive = ttlEnabled && isSingleBTree;
    const ttlNumberValid = !ttlActive || (ttlSeconds.trim() !== '' && Number.parseInt(ttlSeconds, 10) > 0);

    const advancedHasContent = partialText.trim() !== '' || collationText.trim() !== '';
    const advancedHasError = partial.error !== undefined || collation.error !== undefined;

    const canSubmit = completedRows.length > 0 && ttlNumberValid && !partial.error && !collation.error && !submitting;

    const handleSubmit = async (): Promise<void> => {
        if (!canSubmit) {
            return;
        }
        setSubmitting(true);
        try {
            const payload: CreateIndexInput = {
                fields: completedRows.map((r) => ({ field: r.field.trim(), type: r.type })),
                name: name.trim() || undefined,
            };
            if (unique) {
                payload.unique = true;
            }
            if (sparse && !sparseDisabled) {
                payload.sparse = true;
            }
            if (ttlActive && ttlNumberValid) {
                payload.expireAfterSeconds = Number.parseInt(ttlSeconds, 10);
            }
            if (partial.value) {
                payload.partialFilterExpression = partial.value;
            }
            if (collation.value) {
                payload.collation = collation.value;
            }
            await onSubmit(payload);
            reset();
        } catch {
            // The parent surfaces the error; keep the form so the user can retry.
        } finally {
            setSubmitting(false);
        }
    };

    const showLargeCollectionWarning = documentCount > LARGE_COLLECTION_THRESHOLD_DOCS;

    // Header quick actions: Back is present only on the advanced sub-page; Hide
    // (collapse) is always available since the drawer preserves its state.
    const headerActions = (
        <div className="drawerHeaderActions">
            {page === 'advanced' && (
                <Tooltip content={l10n.t('Back')} relationship="label" withArrow>
                    <Button
                        appearance="subtle"
                        aria-label={l10n.t('Back')}
                        icon={<ArrowLeftRegular />}
                        disabled={submitting}
                        onClick={() => setPage('main')}
                    />
                </Tooltip>
            )}
            <Tooltip content={l10n.t('Hide')} relationship="label" withArrow>
                <Button
                    appearance="subtle"
                    aria-label={l10n.t('Hide')}
                    icon={<PanelRightContractRegular />}
                    disabled={submitting}
                    onClick={handleCancel}
                />
            </Tooltip>
        </div>
    );

    return (
        <OverlayDrawer
            as="aside"
            position="end"
            size="medium"
            open={open}
            onOpenChange={(_, data) => {
                if (!data.open) {
                    handleCancel();
                }
            }}
            className="createIndexDrawer"
        >
            <DrawerHeader>
                <DrawerHeaderTitle action={headerActions}>
                    {page === 'advanced' ? l10n.t('Advanced settings') : l10n.t('Create Index')}
                </DrawerHeaderTitle>
            </DrawerHeader>

            <DrawerBody className="createIndexDrawerBody">
                {page === 'main' ? (
                    <div className="createIndexForm">
                        {showLargeCollectionWarning && (
                            <MessageBar intent="warning">
                                <MessageBarBody>
                                    <MessageBarTitle>{l10n.t('Large collection')}</MessageBarTitle>
                                    {l10n.t('Index creation may impact write performance during build.')}
                                </MessageBarBody>
                            </MessageBar>
                        )}

                        <DrawerSection
                            title={l10n.t('Index fields')}
                            hint={l10n.t(
                                'Select the field(s) to index and a type for each. Add more fields to build a compound index.',
                            )}
                        >
                            <div className="indexFieldsList">
                                {fields.map((draft) => (
                                    <div key={draft.id} className="fieldRow">
                                        <Combobox
                                            className="fieldGrow"
                                            freeform
                                            placeholder={l10n.t('Select or type a field name')}
                                            value={draft.field}
                                            selectedOptions={draft.field ? [draft.field] : []}
                                            onOptionSelect={(_, data) =>
                                                updateField(draft.id, { field: data.optionValue ?? '' })
                                            }
                                            onChange={(e) => updateField(draft.id, { field: e.target.value })}
                                            aria-label={l10n.t('Field name')}
                                        >
                                            {fieldSuggestions.map((s) => (
                                                <Option key={s} value={s}>
                                                    {s}
                                                </Option>
                                            ))}
                                        </Combobox>
                                        <Dropdown
                                            className="fieldType"
                                            selectedOptions={[draft.type]}
                                            value={typeLabels.find((t) => t.value === draft.type)?.label ?? ''}
                                            onOptionSelect={(_, data) => {
                                                if (data.optionValue) {
                                                    updateField(draft.id, {
                                                        type: data.optionValue as FieldIndexType,
                                                    });
                                                }
                                            }}
                                            aria-label={l10n.t('Field type')}
                                        >
                                            {typeLabels.map((t) => (
                                                <Option key={t.value} value={t.value}>
                                                    {t.label}
                                                </Option>
                                            ))}
                                        </Dropdown>
                                        {fields.length > 1 && (
                                            <Tooltip
                                                content={l10n.t('Remove field')}
                                                relationship="description"
                                                withArrow
                                            >
                                                <Button
                                                    appearance="subtle"
                                                    size="small"
                                                    icon={<DeleteRegular />}
                                                    aria-label={l10n.t('Remove field')}
                                                    onClick={() => removeField(draft.id)}
                                                />
                                            </Tooltip>
                                        )}
                                    </div>
                                ))}
                            </div>
                            <div>
                                <Button appearance="subtle" size="small" icon={<AddRegular />} onClick={addField}>
                                    {l10n.t('Add field (compound)')}
                                </Button>
                            </div>
                        </DrawerSection>

                        <DrawerSection
                            title={l10n.t('Options')}
                            hint={l10n.t('Index-level properties applied to the whole index.')}
                        >
                            <div className="typeOptions">
                                <Switch
                                    checked={unique}
                                    onChange={(_, data) => setUnique(data.checked)}
                                    label={l10n.t('Unique — reject duplicate values')}
                                />
                                <div className="optionItem">
                                    <Switch
                                        checked={sparse && !sparseDisabled}
                                        disabled={sparseDisabled}
                                        onChange={(_, data) => setSparse(data.checked)}
                                        label={l10n.t('Sparse — only index documents that contain the field')}
                                    />
                                    {sparseDisabled && (
                                        <div className="optionHint">
                                            {l10n.t('Not available together with a partial filter expression.')}
                                        </div>
                                    )}
                                </div>
                                <div className="optionItem">
                                    <Switch
                                        checked={ttlActive}
                                        disabled={!isSingleBTree}
                                        onChange={(_, data) => setTtlEnabled(data.checked)}
                                        label={l10n.t('TTL — automatically delete documents after an age')}
                                    />
                                    {!isSingleBTree && (
                                        <div className="optionHint">
                                            {l10n.t('TTL requires a single ascending or descending field.')}
                                        </div>
                                    )}
                                    {ttlActive && (
                                        <Field
                                            label={l10n.t('Expire after (seconds)')}
                                            required
                                            validationState={ttlNumberValid ? 'none' : 'error'}
                                            validationMessage={
                                                ttlNumberValid
                                                    ? undefined
                                                    : l10n.t('Enter a positive number of seconds.')
                                            }
                                        >
                                            <Input
                                                type="number"
                                                min={1}
                                                value={ttlSeconds}
                                                onChange={(e) => setTtlSeconds(e.target.value)}
                                            />
                                        </Field>
                                    )}
                                </div>
                            </div>
                        </DrawerSection>

                        <DrawerSection
                            title={l10n.t('Name')}
                            hint={l10n.t('Optional. If left empty, the server generates a name from the field list.')}
                        >
                            <Field>
                                <Input
                                    value={name}
                                    placeholder={l10n.t('Index name')}
                                    onChange={(e) => setName(e.target.value)}
                                />
                            </Field>
                        </DrawerSection>

                        <button type="button" className="advancedEntry" onClick={() => setPage('advanced')}>
                            <SettingsRegular className="advancedEntryIcon" />
                            <span className="advancedEntryText">
                                <span className="advancedEntryTitle">{l10n.t('Advanced settings')}</span>
                                <span className="advancedEntrySub">
                                    {l10n.t('Partial filter expression, custom collation')}
                                </span>
                            </span>
                            {advancedHasError ? (
                                <span className="advancedEntryBadge advancedEntryBadgeError">{l10n.t('Error')}</span>
                            ) : advancedHasContent ? (
                                <span className="advancedEntryBadge">{l10n.t('Set')}</span>
                            ) : null}
                            <ChevronRightRegular className="advancedEntryChevron" />
                        </button>
                    </div>
                ) : (
                    <div className="createIndexForm">
                        <DrawerSection
                            title={l10n.t('Partial filter expression')}
                            hint={l10n.t('Only index documents that match this filter. Enter a JSON object.')}
                        >
                            <Field validationState={partial.error ? 'error' : 'none'} validationMessage={partial.error}>
                                <Textarea
                                    resize="vertical"
                                    value={partialText}
                                    placeholder={'{ "status": { "$eq": "active" } }'}
                                    onChange={(e) => setPartialText(e.target.value)}
                                />
                            </Field>
                        </DrawerSection>

                        <DrawerSection
                            title={l10n.t('Collation')}
                            hint={l10n.t('Language-specific comparison rules. Enter a JSON object.')}
                        >
                            <Field
                                validationState={collation.error ? 'error' : 'none'}
                                validationMessage={collation.error}
                            >
                                <Textarea
                                    resize="vertical"
                                    value={collationText}
                                    placeholder={'{ "locale": "en", "strength": 2 }'}
                                    onChange={(e) => setCollationText(e.target.value)}
                                />
                            </Field>
                        </DrawerSection>
                    </div>
                )}
            </DrawerBody>

            <div className="createIndexDrawerFooter">
                <Button appearance="primary" onClick={() => void handleSubmit()} disabled={!canSubmit}>
                    {submitting ? l10n.t('Creating…') : l10n.t('Create Index')}
                </Button>
                <Button appearance="secondary" icon={<ArrowResetRegular />} disabled={submitting} onClick={reset}>
                    {l10n.t('Reset form')}
                </Button>
            </div>
        </OverlayDrawer>
    );
};
