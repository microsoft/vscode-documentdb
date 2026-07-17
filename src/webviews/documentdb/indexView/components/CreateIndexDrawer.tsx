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
    type ComboboxProps,
} from '@fluentui/react-components';
import {
    AddRegular,
    ArrowLeftRegular,
    ArrowResetRegular,
    CheckmarkCircleRegular,
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

/**
 * One index-level option: a compact switch whose label carries a short
 * parenthetical explanation, plus an optional reason shown when the option is
 * disabled and any revealed input. The detail container is rendered only when
 * there is something to show, and lives in a single `.optionDetail` block so
 * its layout is tuned in one place.
 */
function OptionRow({
    label,
    checked,
    disabled = false,
    disabledReason,
    onToggle,
    children,
}: {
    label: string;
    checked: boolean;
    disabled?: boolean;
    disabledReason?: string;
    onToggle: (checked: boolean) => void;
    children?: ReactNode;
}): JSX.Element {
    const reason = disabled && disabledReason !== undefined ? disabledReason : undefined;
    const hasDetail = reason !== undefined || Boolean(children);
    return (
        <div className="optionItem">
            <Switch
                size="small"
                checked={checked}
                disabled={disabled}
                onChange={(_, data) => onToggle(data.checked)}
                label={label}
            />
            {hasDetail && (
                <div className="optionDetail">
                    {reason !== undefined && <div className="optionDescription">{reason}</div>}
                    {children}
                </div>
            )}
        </div>
    );
}

/**
 * Field-name entry for a single index key. A freeform Combobox that filters the
 * schema suggestions as the user types and offers a `Use "…"` option so a value
 * that is not in the suggestion list can be committed explicitly.
 */
function FieldNameCombobox({
    value,
    suggestions,
    onChange,
}: {
    value: string;
    suggestions: ReadonlyArray<string>;
    onChange: (value: string) => void;
}): JSX.Element {
    const [matching, setMatching] = useState<ReadonlyArray<string>>(suggestions);
    const [customValue, setCustomValue] = useState<string | undefined>(undefined);

    const handleInput: ComboboxProps['onChange'] = (event) => {
        const next = event.target.value;
        onChange(next);
        const needle = next.trim().toLowerCase();
        const matches = suggestions.filter((option) => option.toLowerCase().includes(needle));
        setMatching(matches);
        setCustomValue(
            needle.length > 0 && !suggestions.some((o) => o.toLowerCase() === needle) ? next.trim() : undefined,
        );
    };

    const handleSelect: ComboboxProps['onOptionSelect'] = (_, data) => {
        onChange(data.optionText ?? '');
        setCustomValue(undefined);
    };

    return (
        <Combobox
            className="fieldGrow"
            freeform
            placeholder={l10n.t('Select or type a field name')}
            value={value}
            selectedOptions={value ? [value] : []}
            onChange={handleInput}
            onOptionSelect={handleSelect}
            aria-label={l10n.t('Field name')}
        >
            {customValue !== undefined ? (
                <Option key="__custom" text={customValue}>
                    {l10n.t('Use "{0}"', customValue)}
                </Option>
            ) : null}
            {matching.map((option) => (
                <Option key={option} text={option}>
                    {option}
                </Option>
            ))}
        </Combobox>
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
    const [nameEnabled, setNameEnabled] = useState(false);
    const [unique, setUnique] = useState(false);
    const [sparse, setSparse] = useState(false);
    const [ttlEnabled, setTtlEnabled] = useState(false);
    // Seeded with a sensible default so the TTL input never opens in an error state.
    const [ttlSeconds, setTtlSeconds] = useState<string>('3600');
    const [partialText, setPartialText] = useState('');
    const [collationText, setCollationText] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const typeLabels = useMemo(() => buildTypeLabels(), []);

    const reset = (): void => {
        setPage('main');
        setFields([INITIAL_FIELD()]);
        setName('');
        setNameEnabled(false);
        setUnique(false);
        setSparse(false);
        setTtlEnabled(false);
        setTtlSeconds('3600');
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

    // Which advanced settings are populated — surfaced on the entry so the user
    // can tell at a glance that something is configured behind it.
    const advancedSummary = [
        partialText.trim() !== '' ? l10n.t('Partial filter') : undefined,
        collationText.trim() !== '' ? l10n.t('Collation') : undefined,
    ]
        .filter((part): part is string => part !== undefined)
        .join(' · ');

    const canSubmit = completedRows.length > 0 && ttlNumberValid && !partial.error && !collation.error && !submitting;

    const handleSubmit = async (): Promise<void> => {
        if (!canSubmit) {
            return;
        }
        setSubmitting(true);
        try {
            const payload: CreateIndexInput = {
                fields: completedRows.map((r) => ({ field: r.field.trim(), type: r.type })),
            };
            if (nameEnabled && name.trim() !== '') {
                payload.name = name.trim();
            }
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
                                        <FieldNameCombobox
                                            value={draft.field}
                                            suggestions={fieldSuggestions}
                                            onChange={(v) => updateField(draft.id, { field: v })}
                                        />
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
                                        <Tooltip content={l10n.t('Remove field')} relationship="description" withArrow>
                                            <Button
                                                appearance="subtle"
                                                size="small"
                                                icon={<DeleteRegular />}
                                                aria-label={l10n.t('Remove field')}
                                                disabled={fields.length <= 1}
                                                onClick={() => removeField(draft.id)}
                                            />
                                        </Tooltip>
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
                                <OptionRow
                                    label={l10n.t('Unique (rejects duplicate values)')}
                                    checked={unique}
                                    onToggle={setUnique}
                                />
                                <OptionRow
                                    label={l10n.t('Sparse (only indexes documents that contain the field)')}
                                    checked={sparse && !sparseDisabled}
                                    disabled={sparseDisabled}
                                    disabledReason={l10n.t('Not available together with a partial filter expression.')}
                                    onToggle={setSparse}
                                />
                                <OptionRow
                                    label={l10n.t('TTL (auto-deletes documents after a set age)')}
                                    checked={ttlActive}
                                    disabled={!isSingleBTree}
                                    disabledReason={l10n.t('Requires a single ascending or descending field.')}
                                    onToggle={setTtlEnabled}
                                >
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
                                </OptionRow>
                                <OptionRow
                                    label={l10n.t('Name (use a custom index name)')}
                                    checked={nameEnabled}
                                    onToggle={setNameEnabled}
                                >
                                    {nameEnabled && (
                                        <Field>
                                            <Input
                                                value={name}
                                                placeholder={l10n.t('Index name')}
                                                onChange={(e) => setName(e.target.value)}
                                            />
                                        </Field>
                                    )}
                                </OptionRow>
                            </div>
                        </DrawerSection>

                        <button type="button" className="advancedEntry" onClick={() => setPage('advanced')}>
                            <SettingsRegular className="advancedEntryIcon" />
                            <span className="advancedEntryText">
                                <span className="advancedEntryTitle">{l10n.t('Advanced settings')}</span>
                                <span className="advancedEntrySub">
                                    {advancedSummary !== ''
                                        ? advancedSummary
                                        : l10n.t('Partial filter expression, custom collation')}
                                </span>
                            </span>
                            {advancedHasError ? (
                                <span className="advancedEntryBadge advancedEntryBadgeError">{l10n.t('Error')}</span>
                            ) : advancedHasContent ? (
                                <span className="advancedEntryBadge advancedEntryBadgeSet">
                                    <CheckmarkCircleRegular />
                                    {l10n.t('Configured')}
                                </span>
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
                {page === 'advanced' ? (
                    <Button appearance="secondary" icon={<ArrowLeftRegular />} onClick={() => setPage('main')}>
                        {l10n.t('Back to Create Index')}
                    </Button>
                ) : (
                    <>
                        <Button appearance="primary" onClick={() => void handleSubmit()} disabled={!canSubmit}>
                            {submitting ? l10n.t('Creating…') : l10n.t('Create Index')}
                        </Button>
                        <Button
                            appearance="secondary"
                            icon={<ArrowResetRegular />}
                            disabled={submitting}
                            onClick={reset}
                        >
                            {l10n.t('Reset form')}
                        </Button>
                    </>
                )}
            </div>
        </OverlayDrawer>
    );
};
