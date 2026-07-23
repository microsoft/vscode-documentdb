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
    Radio,
    RadioGroup,
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
import { useTrpcClient } from '../../../_integration/useTrpcClient';
import { LARGE_COLLECTION_THRESHOLD_DOCS } from '../constants';
import { type CreateIndexInput, type FieldIndexType } from '../types';
import {
    applyConfirmedWildcardTransition,
    createInitialIndexFormState,
    disableWildcardMode,
    getEnableWildcardImpact,
    getWildcardActivationDecision,
    isBlankIndexOption,
    isWildcardParentPathValid,
    normalizeWildcardParentPath,
    setWildcardPath,
    setWildcardScope,
} from '../wildcardIndexForm';
import { JsonInputEditor } from './JsonInputEditor';

/** Which pane of the drawer is visible. Advanced is a pushed sub-page. */
type DrawerPage = 'main' | 'advanced';

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
    disabled,
    onChange,
}: {
    value: string;
    suggestions: ReadonlyArray<string>;
    disabled: boolean;
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
            disabled={disabled}
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
    const trpcClient = useTrpcClient();
    const [page, setPage] = useState<DrawerPage>('main');
    const [form, setForm] = useState(createInitialIndexFormState);
    const [submitting, setSubmitting] = useState(false);
    const [wildcardConfirmationPending, setWildcardConfirmationPending] = useState(false);
    const wildcardConfirmationPendingRef = useRef(false);
    const wildcardConfirmationGenerationRef = useRef(0);

    const {
        fields,
        name,
        nameEnabled,
        unique,
        sparse,
        ttlEnabled,
        ttlSeconds,
        partialText,
        collationText,
        wildcardEnabled,
        wildcardScope,
        wildcardPath,
        wildcardProjectionText,
    } = form;

    const typeLabels = useMemo(() => buildTypeLabels(), []);

    const reset = useCallback((): void => {
        setPage('main');
        setForm(createInitialIndexFormState());
        setSubmitting(false);
        wildcardConfirmationGenerationRef.current += 1;
        wildcardConfirmationPendingRef.current = false;
        setWildcardConfirmationPending(false);
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
        if (submitting || wildcardConfirmationPending) {
            return;
        }
        onCancel();
    };

    const addField = (): void => {
        setForm((prev) => ({
            ...prev,
            fields: [...prev.fields, createInitialIndexFormState().fields[0]],
        }));
    };

    const removeField = (id: string): void => {
        setForm((prev) => ({
            ...prev,
            fields: prev.fields.length > 1 ? prev.fields.filter((field) => field.id !== id) : prev.fields,
        }));
    };

    // Reset a single row back to its empty state. Used for the lone first field,
    // where there is nothing to delete but the user still needs a way to clear
    // what they typed.
    const clearField = (id: string): void => {
        setForm((prev) => ({
            ...prev,
            fields: prev.fields.map((field) => (field.id === id ? { ...field, field: '', type: 'asc' } : field)),
        }));
    };

    const updateField = (id: string, patch: { field?: string; type?: FieldIndexType }): void => {
        setForm((prev) => ({
            ...prev,
            fields: prev.fields.map((field) => (field.id === id ? { ...field, ...patch } : field)),
        }));
    };

    const handleWildcardToggle = async (checked: boolean): Promise<void> => {
        if (!checked) {
            if (!wildcardConfirmationPendingRef.current) {
                setForm((prev) => disableWildcardMode(prev));
            }
            return;
        }

        const decision = getWildcardActivationDecision(form, wildcardConfirmationPendingRef.current);
        if (decision === 'blocked') {
            return;
        }
        if (decision === 'enable') {
            setForm((prev) => applyConfirmedWildcardTransition(prev));
            return;
        }

        const impact = getEnableWildcardImpact(form);
        const generation = ++wildcardConfirmationGenerationRef.current;
        wildcardConfirmationPendingRef.current = true;
        setWildcardConfirmationPending(true);
        try {
            const result = await trpcClient.mongoClusters.indexView.confirmEnableWildcardIndex.mutate(impact);
            if (generation === wildcardConfirmationGenerationRef.current && result.confirmed) {
                setForm((prev) => applyConfirmedWildcardTransition(prev));
            }
        } catch (error) {
            const cause = error instanceof Error ? error.message : String(error);
            void trpcClient.common.displayErrorMessage.mutate({
                message: l10n.t('Failed to confirm wildcard index changes.'),
                modal: false,
                cause,
            });
        } finally {
            if (generation === wildcardConfirmationGenerationRef.current) {
                wildcardConfirmationPendingRef.current = false;
                setWildcardConfirmationPending(false);
            }
        }
    };

    // Only rows with a field name contribute to the index; the type always has
    // a value (defaults to ascending).
    const completedRows = useMemo(() => fields.filter((f) => f.field.trim().length > 0), [fields]);

    // TTL is only valid on a single-field b-tree index.
    const isSingleBTree = completedRows.length === 1 && isBTreeType(completedRows[0].type);

    // Single source of truth for "is this advanced option meaningfully set?" —
    // a blank object ({} / whitespace) counts as not set. Used everywhere so the
    // Advanced entry badge, its summary, and the payload never disagree.
    const hasPartialFilter = !isBlankIndexOption(partialText);
    const hasCollation = !isBlankIndexOption(collationText);
    const hasWildcardProjection = wildcardEnabled && !isBlankIndexOption(wildcardProjectionText);

    // Sparse and a partial filter are mutually exclusive on the server.
    const sparseDisabled = wildcardEnabled || hasPartialFilter;
    const ttlActive = ttlEnabled && isSingleBTree;
    const trimmedTtlSeconds = ttlSeconds.trim();
    const parsedTtlSeconds = Number.parseInt(trimmedTtlSeconds, 10);
    const ttlNumberValid = !ttlActive || (parsedTtlSeconds > 0 && String(parsedTtlSeconds) === trimmedTtlSeconds);
    const wildcardPathValid = !wildcardEnabled || wildcardScope === 'all' || isWildcardParentPathValid(wildcardPath);
    const interactionDisabled = submitting || wildcardConfirmationPending;

    const advancedHasContent = hasPartialFilter || hasCollation || wildcardEnabled;

    let wildcardSummary: string | undefined;
    if (wildcardEnabled) {
        if (wildcardScope === 'all') {
            wildcardSummary = l10n.t('Wildcard: all fields');
        } else {
            const normalizedPath = normalizeWildcardParentPath(wildcardPath);
            wildcardSummary =
                normalizedPath === ''
                    ? l10n.t('Wildcard: fields below a path')
                    : l10n.t('Wildcard: {0}', normalizedPath);
        }
    }

    // Which advanced settings are populated — surfaced on the entry so the user
    // can tell at a glance that something is configured behind it.
    const advancedSummary = [
        wildcardSummary,
        hasWildcardProjection ? l10n.t('Wildcard projection configured') : undefined,
        hasPartialFilter ? l10n.t('Partial filter') : undefined,
        hasCollation ? l10n.t('Collation') : undefined,
    ]
        .filter((part): part is string => part !== undefined)
        .join(' · ');

    const canSubmit =
        completedRows.length > 0 && ttlNumberValid && wildcardPathValid && !submitting && !wildcardConfirmationPending;

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
            payload.expireAfterSeconds = parsedTtlSeconds;
        }
        if (hasPartialFilter) {
            payload.partialFilterExpression = partialText.trim();
        }
        if (hasCollation) {
            payload.collation = collationText.trim();
        }
        if (hasWildcardProjection) {
            payload.wildcardProjection = wildcardProjectionText.trim();
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
                        disabled={interactionDisabled}
                        onClick={() => setPage('main')}
                    />
                </Tooltip>
            )}
            <Tooltip content={l10n.t('Hide')} relationship="label" withArrow>
                <Button
                    appearance="subtle"
                    aria-label={l10n.t('Hide')}
                    icon={<PanelRightContractRegular />}
                    disabled={interactionDisabled}
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
                            hint={
                                wildcardEnabled
                                    ? l10n.t('The wildcard key is generated from the scope in Advanced settings.')
                                    : l10n.t(
                                          'Select the field(s) to index and a type for each. Add more fields to build a compound index.',
                                      )
                            }
                        >
                            <div className="indexFieldsList">
                                {fields.map((draft) => (
                                    <div key={draft.id} className="fieldRow">
                                        {wildcardEnabled ? (
                                            <Input
                                                className="fieldGrow generatedWildcardKey"
                                                value={draft.field}
                                                readOnly
                                                disabled={interactionDisabled}
                                                aria-label={l10n.t('Generated wildcard index key')}
                                            />
                                        ) : (
                                            <FieldNameCombobox
                                                value={draft.field}
                                                suggestions={fieldSuggestions}
                                                disabled={interactionDisabled}
                                                onChange={(v) => updateField(draft.id, { field: v })}
                                            />
                                        )}
                                        <Dropdown
                                            className="fieldType"
                                            selectedOptions={[draft.type]}
                                            value={typeLabels.find((t) => t.value === draft.type)?.label ?? ''}
                                            disabled={wildcardEnabled || interactionDisabled}
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
                                        {/*
                                         * With a single field there is nothing to
                                         * delete, so offer a "clear" affordance to
                                         * reset that lone row instead of a disabled
                                         * delete button. Once a second field exists,
                                         * every row (including the first) can be
                                         * deleted, so show the delete button.
                                         */}
                                        {fields.length <= 1 ? (
                                            <Tooltip
                                                content={
                                                    wildcardEnabled
                                                        ? l10n.t('The wildcard key is generated from its scope.')
                                                        : l10n.t('Clear field')
                                                }
                                                relationship="description"
                                                withArrow
                                            >
                                                <Button
                                                    appearance="subtle"
                                                    size="small"
                                                    icon={<ArrowResetRegular />}
                                                    aria-label={l10n.t('Clear field')}
                                                    disabled={wildcardEnabled || interactionDisabled}
                                                    onClick={() => clearField(draft.id)}
                                                />
                                            </Tooltip>
                                        ) : (
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
                                                    disabled={wildcardEnabled || interactionDisabled}
                                                    onClick={() => removeField(draft.id)}
                                                />
                                            </Tooltip>
                                        )}
                                    </div>
                                ))}
                            </div>
                            <div>
                                <Button
                                    appearance="subtle"
                                    size="small"
                                    icon={<AddRegular />}
                                    disabled={wildcardEnabled || interactionDisabled}
                                    onClick={addField}
                                >
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
                                    checked={unique && !wildcardEnabled}
                                    disabled={wildcardEnabled || interactionDisabled}
                                    disabledReason={
                                        wildcardEnabled
                                            ? l10n.t('Unique is not available for wildcard indexes.')
                                            : undefined
                                    }
                                    onToggle={(checked) => setForm((prev) => ({ ...prev, unique: checked }))}
                                />
                                <OptionRow
                                    label={l10n.t('Sparse - only indexes documents that contain the field')}
                                    checked={sparse && !sparseDisabled}
                                    disabled={sparseDisabled || interactionDisabled}
                                    disabledReason={
                                        wildcardEnabled
                                            ? l10n.t('Sparse is not available for wildcard indexes.')
                                            : l10n.t(
                                                  'Sparse is not available together with a partial filter expression.',
                                              )
                                    }
                                    onToggle={(checked) => setForm((prev) => ({ ...prev, sparse: checked }))}
                                />
                                <OptionRow
                                    label={l10n.t('TTL - auto-deletes documents after a set age')}
                                    checked={ttlActive}
                                    disabled={wildcardEnabled || !isSingleBTree || interactionDisabled}
                                    disabledReason={
                                        wildcardEnabled
                                            ? l10n.t('TTL is not available for wildcard indexes.')
                                            : l10n.t('TTL requires a single ascending or descending field.')
                                    }
                                    onToggle={(checked) => setForm((prev) => ({ ...prev, ttlEnabled: checked }))}
                                >
                                    {ttlActive && (
                                        <Field
                                            label={l10n.t('Expire after (seconds)')}
                                            required
                                            validationState={ttlNumberValid ? 'none' : 'error'}
                                            validationMessage={
                                                ttlNumberValid
                                                    ? undefined
                                                    : l10n.t('Enter a positive whole number using digits only.')
                                            }
                                        >
                                            <Input
                                                type="number"
                                                min={1}
                                                value={ttlSeconds}
                                                disabled={interactionDisabled}
                                                onChange={(e) =>
                                                    setForm((prev) => ({
                                                        ...prev,
                                                        ttlSeconds: e.target.value,
                                                        ttlConfigured: true,
                                                    }))
                                                }
                                            />
                                        </Field>
                                    )}
                                </OptionRow>
                                <OptionRow
                                    label={l10n.t('Name - use a custom index name')}
                                    checked={nameEnabled}
                                    disabled={interactionDisabled}
                                    onToggle={(checked) => setForm((prev) => ({ ...prev, nameEnabled: checked }))}
                                >
                                    {nameEnabled && (
                                        <Field>
                                            <Input
                                                value={name}
                                                placeholder={l10n.t('Index name')}
                                                disabled={interactionDisabled}
                                                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                                            />
                                        </Field>
                                    )}
                                </OptionRow>
                            </div>
                        </DrawerSection>

                        <button
                            type="button"
                            className="advancedEntry"
                            disabled={interactionDisabled}
                            onClick={() => setPage('advanced')}
                        >
                            <SettingsRegular className="advancedEntryIcon" />
                            <span className="advancedEntryText">
                                <span className="advancedEntryTitle">{l10n.t('Advanced settings')}</span>
                                <span className="advancedEntrySub">
                                    {advancedSummary !== ''
                                        ? advancedSummary
                                        : l10n.t('Wildcard index, partial filter expression, custom collation')}
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
                            title={l10n.t('Wildcard index')}
                            hint={l10n.t(
                                'Create one ascending wildcard key for all fields or for fields below a parent path.',
                            )}
                            example={'$**  ·  metadata.$**'}
                        >
                            <div className="typeOptions wildcardOptions">
                                <OptionRow
                                    label={l10n.t('Wildcard index')}
                                    checked={wildcardEnabled}
                                    disabled={interactionDisabled}
                                    disabledReason={
                                        wildcardConfirmationPending
                                            ? l10n.t('Waiting for confirmation in VS Code.')
                                            : undefined
                                    }
                                    onToggle={(checked) => void handleWildcardToggle(checked)}
                                >
                                    {wildcardEnabled && (
                                        <div className="wildcardSettings">
                                            <Field label={l10n.t('Scope')}>
                                                <RadioGroup
                                                    value={wildcardScope}
                                                    disabled={interactionDisabled}
                                                    aria-label={l10n.t('Wildcard index scope')}
                                                    onChange={(_, data) => {
                                                        const scope = data.value;
                                                        if (scope === 'all' || scope === 'path') {
                                                            setForm((prev) => setWildcardScope(prev, scope));
                                                        }
                                                    }}
                                                >
                                                    <Radio value="all" label={l10n.t('All fields')} />
                                                    <Radio value="path" label={l10n.t('Fields below a path')} />
                                                </RadioGroup>
                                            </Field>

                                            {wildcardScope === 'path' && (
                                                <Field
                                                    label={l10n.t('Parent path')}
                                                    required
                                                    validationState={wildcardPathValid ? 'none' : 'error'}
                                                    validationMessage={
                                                        wildcardPath.includes('$**')
                                                            ? l10n.t(
                                                                  'Enter a parent path without $**. It is added automatically.',
                                                              )
                                                            : l10n.t('Enter a non-empty parent path.')
                                                    }
                                                    hint={l10n.t('For example, metadata creates metadata.$**.')}
                                                >
                                                    <Input
                                                        value={wildcardPath}
                                                        disabled={interactionDisabled}
                                                        placeholder={l10n.t('metadata')}
                                                        aria-label={l10n.t('Wildcard parent path')}
                                                        onChange={(event) =>
                                                            setForm((prev) => setWildcardPath(prev, event.target.value))
                                                        }
                                                        onBlur={() => {
                                                            if (!wildcardPath.includes('$**')) {
                                                                setForm((prev) =>
                                                                    setWildcardPath(
                                                                        prev,
                                                                        normalizeWildcardParentPath(prev.wildcardPath),
                                                                    ),
                                                                );
                                                            }
                                                        }}
                                                    />
                                                </Field>
                                            )}

                                            <div className="wildcardProjectionField">
                                                <div className="wildcardProjectionLabel">
                                                    {l10n.t('Wildcard projection (optional)')}
                                                </div>
                                                <div className="optionDescription">
                                                    {l10n.t(
                                                        'Limit which fields the wildcard index includes. Enter a JSON object.',
                                                    )}
                                                </div>
                                                <code className="drawerSectionExample">
                                                    {"{ name: 1, 'metadata.category': 1 }"}
                                                </code>
                                                <JsonInputEditor
                                                    value={wildcardProjectionText}
                                                    readOnly={interactionDisabled}
                                                    onChange={(value) =>
                                                        setForm((prev) => ({
                                                            ...prev,
                                                            wildcardProjectionText: value,
                                                        }))
                                                    }
                                                    ariaLabel={l10n.t('Wildcard projection: enter a JSON object')}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </OptionRow>
                            </div>
                        </DrawerSection>

                        <DrawerSection
                            title={l10n.t('Partial filter expression')}
                            hint={l10n.t('Only index documents that match this filter. Enter a JSON object.')}
                            example={"{ status: { $eq: 'active' } }"}
                        >
                            <JsonInputEditor
                                value={partialText}
                                readOnly={interactionDisabled}
                                onChange={(value) => setForm((prev) => ({ ...prev, partialText: value }))}
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
                                readOnly={interactionDisabled}
                                onChange={(value) => setForm((prev) => ({ ...prev, collationText: value }))}
                                ariaLabel={l10n.t('Collation: enter a JSON object')}
                            />
                        </DrawerSection>
                    </div>
                )}
            </DrawerBody>

            <div className="createIndexDrawerFooter">
                {page === 'advanced' ? (
                    <Button
                        appearance="secondary"
                        icon={<ArrowLeftRegular />}
                        disabled={interactionDisabled}
                        onClick={() => setPage('main')}
                    >
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
                            disabled={interactionDisabled}
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
