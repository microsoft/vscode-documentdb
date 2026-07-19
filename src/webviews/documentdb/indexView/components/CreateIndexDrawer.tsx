/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Combobox,
    Divider,
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
    Tooltip,
} from '@fluentui/react-components';
import {
    AddRegular,
    ArrowLeftRegular,
    ArrowResetRegular,
    CheckmarkCircleRegular,
    ChevronRightRegular,
    DeleteRegular,
    KeyboardRegular,
    PanelRightContractRegular,
    SendRegular,
    SettingsRegular,
    WindowConsoleRegular,
} from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import { LARGE_COLLECTION_THRESHOLD_DOCS } from '../constants';
import { type CreateIndexInput, type FieldIndexType } from '../types';
import { JsonInputEditor } from './JsonInputEditor';

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
/** A titled form section with a short explanation above its inputs. */
function DrawerSection({
    title,
    hint,
    example,
    children,
}: {
    title: string;
    hint?: string;
    /** A small, always-visible example rendered in monospace above the inputs. */
    example?: string;
    children: ReactNode;
}): JSX.Element {
    return (
        <section className="drawerSection">
            <div className="drawerSectionTitle">{title}</div>
            {hint && <div className="drawerSectionHint">{hint}</div>}
            {example && <code className="drawerSectionExample">{example}</code>}
            <div className="drawerSectionBody">{children}</div>
        </section>
    );
}

/**
 * True when the text is either empty or an empty JSON object (`{}` with any
 * inner/outer whitespace). Such values are treated as "not set" so they never
 * mark the Advanced section as configured or get sent to the server.
 */
function isBlankJsonObject(text: string): boolean {
    const trimmed = text.trim();
    return trimmed === '' || /^\{\s*\}$/.test(trimmed);
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
                // The small size shrinks the label to fontSizeBase200; override just
                // the font-size back to the default via the label slot, keeping the
                // small line-height so the label stays aligned with the toggle.
                label={{ children: label, className: 'optionSwitchLabel' }}
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
 *
 * The filtered list and the custom-value affordance are derived from props (no
 * local state) so an async-loaded suggestion list is always reflected and there
 * is nothing to fall out of sync.
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
    const needle = value.trim().toLowerCase();
    const matching = useMemo(
        () => (needle === '' ? suggestions : suggestions.filter((option) => option.toLowerCase().includes(needle))),
        [suggestions, needle],
    );
    const showCustom = needle !== '' && !suggestions.some((option) => option.toLowerCase() === needle);

    return (
        <Combobox
            className="fieldGrow"
            freeform
            placeholder={l10n.t('Select or type a field name')}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onOptionSelect={(_, data) => onChange(data.optionText ?? '')}
            aria-label={l10n.t('Field name')}
        >
            {showCustom ? (
                <Option key="__custom" text={value.trim()}>
                    {l10n.t('Use "{0}"', value.trim())}
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
    /** Prepare the create-index command in a playground or interactive shell. */
    onPrepareInTarget: (target: 'playground' | 'shell', input: CreateIndexInput) => Promise<void>;
    /**
     * Monotonic counter bumped by the parent after a *successful* create. Each
     * increment clears the form. The drawer never resets itself on submit, so a
     * failed create leaves the form intact for the user to retry on re-open.
     */
    resetSignal?: number;
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
    onPrepareInTarget,
    resetSignal,
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
    const [partialText, setPartialText] = useState('{  }');
    const [collationText, setCollationText] = useState('{  }');
    const [submitting, setSubmitting] = useState(false);

    const typeLabels = useMemo(() => buildTypeLabels(), []);

    const reset = useCallback((): void => {
        setPage('main');
        setFields([INITIAL_FIELD()]);
        setName('');
        setNameEnabled(false);
        setUnique(false);
        setSparse(false);
        setTtlEnabled(false);
        setTtlSeconds('3600');
        setPartialText('{  }');
        setCollationText('{  }');
        setSubmitting(false);
    }, []);

    // The parent clears the form after a successful create by bumping
    // `resetSignal`; a failed create never bumps it, so the form is preserved
    // for the user to retry when they re-open the drawer.
    const prevResetSignal = useRef(resetSignal);
    useEffect(() => {
        if (resetSignal !== undefined && resetSignal !== prevResetSignal.current) {
            prevResetSignal.current = resetSignal;
            reset();
        }
    }, [resetSignal, reset]);

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

    // Single source of truth for "is this advanced option meaningfully set?" —
    // a blank object ({} / whitespace) counts as not set. Used everywhere so the
    // Advanced entry badge, its summary, and the payload never disagree.
    const hasPartialFilter = !isBlankJsonObject(partialText);
    const hasCollation = !isBlankJsonObject(collationText);

    // Sparse and a partial filter are mutually exclusive on the server.
    const sparseDisabled = hasPartialFilter;
    const ttlActive = ttlEnabled && isSingleBTree;
    const ttlNumberValid = !ttlActive || (ttlSeconds.trim() !== '' && Number.parseInt(ttlSeconds, 10) > 0);

    const advancedHasContent = hasPartialFilter || hasCollation;

    // Which advanced settings are populated — surfaced on the entry so the user
    // can tell at a glance that something is configured behind it.
    const advancedSummary = [
        hasPartialFilter ? l10n.t('Partial filter') : undefined,
        hasCollation ? l10n.t('Collation') : undefined,
    ]
        .filter((part): part is string => part !== undefined)
        .join(' · ');

    const canSubmit = completedRows.length > 0 && ttlNumberValid && !submitting;

    // Assemble the payload once; shared by the direct create and the
    // playground/shell hand-offs so all three produce an identical index.
    const buildPayload = (): CreateIndexInput => {
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
        if (hasPartialFilter) {
            payload.partialFilterExpression = partialText.trim();
        }
        if (hasCollation) {
            payload.collation = collationText.trim();
        }
        return payload;
    };

    const handleSubmit = async (): Promise<void> => {
        if (!canSubmit) {
            return;
        }
        setSubmitting(true);
        try {
            await onSubmit(buildPayload());
        } catch {
            // The parent surfaces the error; keep the form so the user can retry.
        } finally {
            setSubmitting(false);
        }
    };

    // Prepare the create-index command in a playground or interactive shell so
    // the user can review and run it there instead of submitting directly.
    const handleCreateIn = async (target: 'playground' | 'shell'): Promise<void> => {
        if (!canSubmit) {
            return;
        }
        setSubmitting(true);
        try {
            await onPrepareInTarget(target, buildPayload());
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
                                    label={l10n.t('Unique - rejects duplicate values')}
                                    checked={unique}
                                    onToggle={setUnique}
                                />
                                <OptionRow
                                    label={l10n.t('Sparse - only indexes documents that contain the field')}
                                    checked={sparse && !sparseDisabled}
                                    disabled={sparseDisabled}
                                    disabledReason={l10n.t(
                                        'Sparse is not available together with a partial filter expression.',
                                    )}
                                    onToggle={setSparse}
                                />
                                <OptionRow
                                    label={l10n.t('TTL - auto-deletes documents after a set age')}
                                    checked={ttlActive}
                                    disabled={!isSingleBTree}
                                    disabledReason={l10n.t('TTL Requires a single ascending or descending field.')}
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
                                    label={l10n.t('Name - use a custom index name')}
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
                            {advancedHasContent ? (
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
                            example={"{ status: { $eq: 'active' } }"}
                        >
                            <JsonInputEditor
                                value={partialText}
                                onChange={setPartialText}
                                ariaLabel={l10n.t('Partial filter expression: enter a JSON object')}
                            />
                        </DrawerSection>

                        <DrawerSection
                            title={l10n.t('Collation')}
                            hint={l10n.t('Language-specific comparison rules. Enter a JSON object.')}
                            example={"{ locale: 'en', strength: 2 }"}
                        >
                            <JsonInputEditor
                                value={collationText}
                                onChange={setCollationText}
                                ariaLabel={l10n.t('Collation: enter a JSON object')}
                            />
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
                        <Button
                            appearance="primary"
                            icon={<SendRegular />}
                            onClick={() => void handleSubmit()}
                            disabled={!canSubmit}
                        >
                            {submitting ? l10n.t('Creating…') : l10n.t('Create Index')}
                        </Button>
                        <Tooltip content={l10n.t('Create in the playground')} relationship="label" withArrow>
                            <Button
                                appearance="secondary"
                                icon={<KeyboardRegular />}
                                aria-label={l10n.t('Create in the playground')}
                                disabled={!canSubmit}
                                onClick={() => void handleCreateIn('playground')}
                            />
                        </Tooltip>
                        <Tooltip content={l10n.t('Create in the shell')} relationship="label" withArrow>
                            <Button
                                appearance="secondary"
                                icon={<WindowConsoleRegular />}
                                aria-label={l10n.t('Create in the shell')}
                                disabled={!canSubmit}
                                onClick={() => void handleCreateIn('shell')}
                            />
                        </Tooltip>
                        <Divider vertical className="createIndexFooterDivider" />
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
