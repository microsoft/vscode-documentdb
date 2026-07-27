/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Combobox,
    DrawerBody,
    DrawerFooter,
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
    Tab,
    TabList,
    Tooltip,
} from '@fluentui/react-components';
import {
    AddRegular,
    ArrowLeftRegular,
    ArrowResetRegular,
    BracesRegular,
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
import {
    buildWildcardKey,
    buildWildcardProjectionObject,
    createInitialIndexFormState,
    isBlankIndexOption,
    isWildcardParentPathValid,
    makeProjectionFieldId,
    type IndexKind,
    type WildcardProjectionMode,
    type WildcardScope,
} from '../wildcardIndexForm';
import { JsonInputEditor } from './JsonInputEditor';

/** Which pane of the drawer is visible. Advanced and Preview are pushed sub-pages. */
type DrawerPage = 'main' | 'advanced' | 'preview';

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

/** Render a field's key value as a JS literal: `1` / `-1` or a quoted sentinel. */
function keyValueLiteral(type: FieldIndexType): string {
    switch (type) {
        case 'asc':
            return '1';
        case 'desc':
            return '-1';
        default:
            return `'${type}'`;
    }
}

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
 * end (right) of the panel. A three-way tab selector at the top picks the index
 * kind — Standard, Wildcard, or Vector — and each kind renders a focused form
 * for its own shape rather than folding every option into one conditional form.
 * Rarely-needed settings (partial filter, collation) live on a pushed "Advanced"
 * sub-page reached from the main pane.
 *
 * Form state is intentionally preserved when the drawer is hidden — and each
 * kind keeps its own draft, so switching tabs never destroys the other kinds'
 * work. State is only cleared via "Reset form" or after a successful creation.
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
    const [form, setForm] = useState(createInitialIndexFormState);
    const [submitting, setSubmitting] = useState(false);

    const {
        indexKind,
        fields,
        name,
        nameEnabled,
        unique,
        sparse,
        ttlEnabled,
        ttlSeconds,
        partialText,
        collationText,
        wildcardScope,
        wildcardPath,
        wildcardProjectionEnabled,
        wildcardProjectionMode,
        wildcardProjectionFields,
    } = form;

    const typeLabels = useMemo(() => buildTypeLabels(), []);

    const reset = useCallback((): void => {
        setPage('main');
        setForm(createInitialIndexFormState());
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

    const setIndexKind = (kind: IndexKind): void => {
        // Switching kinds keeps the main pane; Advanced only holds partial
        // filter and collation, so there is nothing kind-specific to leave.
        setPage('main');
        setForm((prev) => ({ ...prev, indexKind: kind }));
    };

    // --- Standard field list ------------------------------------------------

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

    // --- Wildcard projection field list -------------------------------------

    const addProjectionField = (): void => {
        setForm((prev) => ({
            ...prev,
            wildcardProjectionFields: [...prev.wildcardProjectionFields, { id: makeProjectionFieldId(), field: '' }],
        }));
    };

    // Never delete the last row — the list always keeps at least one field so
    // the projection is either configured or explicitly turned off via the switch.
    const removeProjectionField = (id: string): void => {
        setForm((prev) => ({
            ...prev,
            wildcardProjectionFields:
                prev.wildcardProjectionFields.length > 1
                    ? prev.wildcardProjectionFields.filter((field) => field.id !== id)
                    : prev.wildcardProjectionFields,
        }));
    };

    // Reset the lone projection row back to empty — mirrors the standard field
    // list, where the single first row offers a "clear" affordance instead of a
    // delete button.
    const clearProjectionField = (id: string): void => {
        setForm((prev) => ({
            ...prev,
            wildcardProjectionFields: prev.wildcardProjectionFields.map((field) =>
                field.id === id ? { ...field, field: '' } : field,
            ),
        }));
    };

    const updateProjectionField = (id: string, value: string): void => {
        setForm((prev) => ({
            ...prev,
            wildcardProjectionFields: prev.wildcardProjectionFields.map((field) =>
                field.id === id ? { ...field, field: value } : field,
            ),
        }));
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

    // The structured projection editor collapses to a plain object; `undefined`
    // means "nothing meaningful configured" so it is treated like an omitted
    // option everywhere. A projection is only valid on the all-fields `$**` key,
    // so it is ignored for the scoped-path scope.
    const wildcardProjectionObject = useMemo(
        () =>
            indexKind === 'wildcard' && wildcardScope === 'all' && wildcardProjectionEnabled
                ? buildWildcardProjectionObject(wildcardProjectionMode, wildcardProjectionFields)
                : undefined,
        [indexKind, wildcardScope, wildcardProjectionEnabled, wildcardProjectionMode, wildcardProjectionFields],
    );
    const hasWildcardProjection = wildcardProjectionObject !== undefined;

    // Live preview of the generated wildcard key, e.g. `$**` or `metadata.$**`.
    // An empty parent path collapses to `$**` (all fields), so the preview is
    // shown for empty input too; it is only suppressed when the path is invalid
    // (contains the `$**` token itself).
    const wildcardKeyPreview =
        indexKind === 'wildcard' && isWildcardParentPathValid(wildcardPath)
            ? buildWildcardKey(wildcardScope, wildcardPath)
            : '';

    // Sparse and a partial filter are mutually exclusive on the server.
    const sparseDisabled = hasPartialFilter;
    const ttlActive = ttlEnabled && isSingleBTree;
    const trimmedTtlSeconds = ttlSeconds.trim();
    const parsedTtlSeconds = Number.parseInt(trimmedTtlSeconds, 10);
    const ttlNumberValid = !ttlActive || (parsedTtlSeconds > 0 && String(parsedTtlSeconds) === trimmedTtlSeconds);
    // Empty path is fine (treated as all fields); only a path carrying the
    // wildcard token itself is rejected. Errors are otherwise deferred to submit.
    const wildcardPathValid = indexKind !== 'wildcard' || isWildcardParentPathValid(wildcardPath);
    const interactionDisabled = submitting;

    const advancedHasContent = hasPartialFilter || hasCollation;

    // Which advanced settings are populated — surfaced on the entry so the user
    // can tell at a glance that something is configured behind it.
    const advancedSummary = [
        hasPartialFilter ? l10n.t('Partial filter') : undefined,
        hasCollation ? l10n.t('Collation') : undefined,
    ]
        .filter((part): part is string => part !== undefined)
        .join(' · ');

    const canSubmit =
        !submitting &&
        (indexKind === 'standard'
            ? completedRows.length > 0 && ttlNumberValid
            : indexKind === 'wildcard'
              ? wildcardPathValid
              : false);

    // Assemble the payload once; shared by the direct create and the
    // playground/shell hand-offs so all three produce an identical index.
    const buildPayload = (): CreateIndexInput => {
        if (indexKind === 'wildcard') {
            const payload: CreateIndexInput = {
                fields: [{ field: buildWildcardKey(wildcardScope, wildcardPath), type: 'asc' }],
            };
            if (nameEnabled && name.trim() !== '') {
                payload.name = name.trim();
            }
            if (hasPartialFilter) {
                payload.partialFilterExpression = partialText.trim();
            }
            if (hasCollation) {
                payload.collation = collationText.trim();
            }
            if (hasWildcardProjection) {
                payload.wildcardProjection = JSON.stringify(wildcardProjectionObject);
            }
            return payload;
        }

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
        return payload;
    };

    // Build a read-only, JS-style preview of the specification passed to
    // createIndex(). Partial filter / collation are relaxed JSON parsed on the
    // host, so here they are embedded verbatim (continuation lines re-indented to
    // sit under their property). The wildcard projection is already a plain
    // object, so it is expanded directly.
    const buildPreviewText = (): string => {
        const payload = buildPayload();
        const reindent = (text: string): string => text.replace(/\n/g, '\n    ');
        const entries: string[] = [];

        const keyBody = payload.fields.map((f) => `${JSON.stringify(f.field)}: ${keyValueLiteral(f.type)}`).join(', ');
        entries.push(payload.fields.length > 0 ? `key: { ${keyBody} }` : 'key: {}');

        if (payload.name !== undefined) {
            entries.push(`name: ${JSON.stringify(payload.name)}`);
        }
        if (payload.unique) {
            entries.push('unique: true');
        }
        if (payload.sparse) {
            entries.push('sparse: true');
        }
        if (payload.expireAfterSeconds !== undefined) {
            entries.push(`expireAfterSeconds: ${payload.expireAfterSeconds}`);
        }
        if (payload.partialFilterExpression !== undefined) {
            entries.push(`partialFilterExpression: ${reindent(payload.partialFilterExpression)}`);
        }
        if (payload.collation !== undefined) {
            entries.push(`collation: ${reindent(payload.collation)}`);
        }
        if (wildcardProjectionObject) {
            const projBody = Object.entries(wildcardProjectionObject)
                .map(([field, value]) => `${JSON.stringify(field)}: ${value}`)
                .join(', ');
            entries.push(`wildcardProjection: { ${projBody} }`);
        }

        return `{\n${entries.map((entry) => `    ${entry}`).join(',\n')}\n}`;
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

    // Shared "custom index name" option, used by Standard and Wildcard forms.
    // The input is revealed only while the option is on.
    const nameOption = (
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
                        disabled={interactionDisabled}
                        onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                    />
                </Field>
            )}
        </OptionRow>
    );

    // Shared entry to the pushed Advanced sub-page (partial filter + collation).
    const advancedEntry = (
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
                    {advancedSummary !== '' ? advancedSummary : l10n.t('Partial filter expression, custom collation')}
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
    );

    // Shared entry to the pushed JSON preview sub-page.
    const previewEntry = (
        <button
            type="button"
            className="advancedEntry"
            disabled={interactionDisabled}
            onClick={() => setPage('preview')}
        >
            <BracesRegular className="advancedEntryIcon" />
            <span className="advancedEntryText">
                <span className="advancedEntryTitle">{l10n.t('Preview as JSON')}</span>
                <span className="advancedEntrySub">
                    {l10n.t('Review the generated index specification before creating it.')}
                </span>
            </span>
            <ChevronRightRegular className="advancedEntryChevron" />
        </button>
    );

    // Header quick actions: Back is present only on the advanced sub-page; Hide
    // (collapse) is always available since the drawer preserves its state.
    const headerActions = (
        <div className="drawerHeaderActions">
            {page !== 'main' && (
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
                    {page === 'advanced'
                        ? l10n.t('Advanced settings')
                        : page === 'preview'
                          ? l10n.t('JSON preview')
                          : l10n.t('Create Index')}
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

                        <TabList
                            aria-label={l10n.t('Index kind')}
                            className="indexKindTabs"
                            selectedValue={indexKind}
                            onTabSelect={(_event, data) => {
                                const kind = data.value;
                                if (kind === 'standard' || kind === 'wildcard' || kind === 'vector') {
                                    setIndexKind(kind);
                                }
                            }}
                        >
                            <Tab value="standard">{l10n.t('Standard')}</Tab>
                            <Tab value="wildcard">{l10n.t('Wildcard')}</Tab>
                            <Tab value="vector">{l10n.t('Vector')}</Tab>
                        </TabList>

                        {indexKind === 'standard' && (
                            <>
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
                                                    disabled={interactionDisabled}
                                                    onChange={(v) => updateField(draft.id, { field: v })}
                                                />
                                                <Dropdown
                                                    className="fieldType"
                                                    selectedOptions={[draft.type]}
                                                    value={typeLabels.find((t) => t.value === draft.type)?.label ?? ''}
                                                    disabled={interactionDisabled}
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
                                                 * With a single field there is nothing to delete, so
                                                 * offer a "clear" affordance to reset that lone row
                                                 * instead of a disabled delete button. Once a second
                                                 * field exists, every row can be deleted.
                                                 */}
                                                {fields.length <= 1 ? (
                                                    <Tooltip
                                                        content={l10n.t('Clear field')}
                                                        relationship="description"
                                                        withArrow
                                                    >
                                                        <Button
                                                            appearance="subtle"
                                                            size="small"
                                                            icon={<ArrowResetRegular />}
                                                            aria-label={l10n.t('Clear field')}
                                                            disabled={interactionDisabled}
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
                                                            disabled={interactionDisabled}
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
                                            disabled={interactionDisabled}
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
                                            checked={unique}
                                            disabled={interactionDisabled}
                                            onToggle={(checked) => setForm((prev) => ({ ...prev, unique: checked }))}
                                        />
                                        <OptionRow
                                            label={l10n.t('Sparse - only indexes documents that contain the field')}
                                            checked={sparse && !sparseDisabled}
                                            disabled={sparseDisabled || interactionDisabled}
                                            disabledReason={l10n.t(
                                                'Sparse is not available together with a partial filter expression.',
                                            )}
                                            onToggle={(checked) => setForm((prev) => ({ ...prev, sparse: checked }))}
                                        />
                                        <OptionRow
                                            label={l10n.t('TTL - auto-deletes documents after a set age')}
                                            checked={ttlActive}
                                            disabled={!isSingleBTree || interactionDisabled}
                                            disabledReason={l10n.t(
                                                'TTL requires a single ascending or descending field.',
                                            )}
                                            onToggle={(checked) =>
                                                setForm((prev) => ({ ...prev, ttlEnabled: checked }))
                                            }
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
                                        {nameOption}
                                    </div>
                                </DrawerSection>

                                {advancedEntry}
                                {previewEntry}
                            </>
                        )}

                        {indexKind === 'wildcard' && (
                            <>
                                <DrawerSection
                                    title={l10n.t('Scope')}
                                    hint={l10n.t(
                                        'Create one ascending wildcard key for all fields or for fields below a parent path.',
                                    )}
                                >
                                    <div className="wildcardSettings">
                                        <RadioGroup
                                            value={wildcardScope}
                                            disabled={interactionDisabled}
                                            aria-label={l10n.t('Wildcard index scope')}
                                            onChange={(_, data) => {
                                                const scope = data.value;
                                                if (scope === 'all' || scope === 'path') {
                                                    setForm((prev) => ({
                                                        ...prev,
                                                        wildcardScope: scope as WildcardScope,
                                                    }));
                                                }
                                            }}
                                        >
                                            <Radio value="all" label={l10n.t('All fields')} />
                                            <Radio value="path" label={l10n.t('Fields below a path')} />
                                        </RadioGroup>

                                        {/*
                                         * The parent path stays mounted for both scopes — it is only
                                         * disabled for "All fields" — so switching scope never shifts
                                         * the layout. Validation applies only while the path scope is
                                         * active.
                                         */}
                                        <Field
                                            className="wildcardScopedPath"
                                            label={l10n.t('Parent path')}
                                            validationState={
                                                wildcardScope === 'path' && wildcardPath.includes('$**')
                                                    ? 'error'
                                                    : 'none'
                                            }
                                            validationMessage={
                                                wildcardScope === 'path' && wildcardPath.includes('$**')
                                                    ? l10n.t(
                                                          'Enter a parent path without $**. It is added automatically.',
                                                      )
                                                    : undefined
                                            }
                                            hint={l10n.t(
                                                'For example, metadata creates metadata.$**. Leave empty to index all fields.',
                                            )}
                                        >
                                            <div className="fieldRow">
                                                <FieldNameCombobox
                                                    value={wildcardPath}
                                                    suggestions={fieldSuggestions}
                                                    disabled={wildcardScope !== 'path' || interactionDisabled}
                                                    onChange={(value) =>
                                                        setForm((prev) => ({ ...prev, wildcardPath: value }))
                                                    }
                                                />
                                                <Tooltip
                                                    content={l10n.t('Clear parent path')}
                                                    relationship="description"
                                                    withArrow
                                                >
                                                    <Button
                                                        appearance="subtle"
                                                        size="small"
                                                        icon={<ArrowResetRegular />}
                                                        aria-label={l10n.t('Clear parent path')}
                                                        disabled={wildcardScope !== 'path' || interactionDisabled}
                                                        onClick={() =>
                                                            setForm((prev) => ({ ...prev, wildcardPath: '' }))
                                                        }
                                                    />
                                                </Tooltip>
                                            </div>
                                        </Field>

                                        {wildcardKeyPreview !== '' && (
                                            <div className="wildcardKeyPreview">
                                                <span className="wildcardKeyPreviewLabel">
                                                    {l10n.t('Index key preview')}
                                                </span>
                                                <code className="drawerSectionExample">{wildcardKeyPreview}</code>
                                            </div>
                                        )}
                                    </div>
                                </DrawerSection>

                                {/*
                                 * A wildcard projection is only accepted on the all-fields `$**`
                                 * key. A scoped `path.$**` key already narrows the index, so the
                                 * projection controls are only offered for the "All fields" scope.
                                 */}
                                {wildcardScope === 'all' && (
                                    <DrawerSection
                                        title={l10n.t('Projection')}
                                        hint={l10n.t(
                                            'Optionally limit which fields the wildcard index covers by including or excluding specific field paths.',
                                        )}
                                    >
                                        <div className="typeOptions">
                                            <OptionRow
                                                label={l10n.t('Include or exclude specific fields')}
                                                checked={wildcardProjectionEnabled}
                                                disabled={interactionDisabled}
                                                onToggle={(checked) =>
                                                    setForm((prev) => ({ ...prev, wildcardProjectionEnabled: checked }))
                                                }
                                            >
                                                {wildcardProjectionEnabled && (
                                                    <div className="wildcardProjectionBody">
                                                        <Field
                                                            label={l10n.t('Projection mode')}
                                                            hint={
                                                                wildcardProjectionMode === 'include'
                                                                    ? l10n.t(
                                                                          'Only the selected paths, and every field nested under them, are indexed. All other fields are excluded.',
                                                                      )
                                                                    : l10n.t(
                                                                          'The selected paths, and every field nested under them, are excluded. All other fields are indexed.',
                                                                      )
                                                            }
                                                        >
                                                            <RadioGroup
                                                                value={wildcardProjectionMode}
                                                                disabled={interactionDisabled}
                                                                aria-label={l10n.t('Wildcard projection mode')}
                                                                onChange={(_, data) => {
                                                                    const mode = data.value;
                                                                    if (mode === 'include' || mode === 'exclude') {
                                                                        setForm((prev) => ({
                                                                            ...prev,
                                                                            wildcardProjectionMode:
                                                                                mode as WildcardProjectionMode,
                                                                        }));
                                                                    }
                                                                }}
                                                            >
                                                                <Radio
                                                                    value="include"
                                                                    label={l10n.t('Include selected fields')}
                                                                />
                                                                <Radio
                                                                    value="exclude"
                                                                    label={l10n.t('Exclude selected fields')}
                                                                />
                                                            </RadioGroup>
                                                        </Field>

                                                        <Field label={l10n.t('Fields')}>
                                                            <div className="projectionFieldsList">
                                                                {wildcardProjectionFields.map((draft) => (
                                                                    <div key={draft.id} className="projectionFieldRow">
                                                                        <FieldNameCombobox
                                                                            value={draft.field}
                                                                            suggestions={fieldSuggestions}
                                                                            disabled={interactionDisabled}
                                                                            onChange={(value) =>
                                                                                updateProjectionField(draft.id, value)
                                                                            }
                                                                        />
                                                                        {/*
                                                                         * With a single projection field there is
                                                                         * nothing to delete, so offer a "clear"
                                                                         * affordance to reset that lone row instead
                                                                         * of a disabled delete button — matching the
                                                                         * standard index field list.
                                                                         */}
                                                                        {wildcardProjectionFields.length <= 1 ? (
                                                                            <Tooltip
                                                                                content={l10n.t('Clear field')}
                                                                                relationship="description"
                                                                                withArrow
                                                                            >
                                                                                <Button
                                                                                    appearance="subtle"
                                                                                    size="small"
                                                                                    icon={<ArrowResetRegular />}
                                                                                    aria-label={l10n.t('Clear field')}
                                                                                    disabled={interactionDisabled}
                                                                                    onClick={() =>
                                                                                        clearProjectionField(draft.id)
                                                                                    }
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
                                                                                    disabled={interactionDisabled}
                                                                                    onClick={() =>
                                                                                        removeProjectionField(draft.id)
                                                                                    }
                                                                                />
                                                                            </Tooltip>
                                                                        )}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </Field>
                                                        <div>
                                                            <Button
                                                                appearance="subtle"
                                                                size="small"
                                                                icon={<AddRegular />}
                                                                disabled={interactionDisabled}
                                                                onClick={addProjectionField}
                                                            >
                                                                {l10n.t('Add field')}
                                                            </Button>
                                                        </div>
                                                    </div>
                                                )}
                                            </OptionRow>
                                        </div>
                                    </DrawerSection>
                                )}

                                <DrawerSection
                                    title={l10n.t('Options')}
                                    hint={l10n.t('Index-level properties applied to the whole index.')}
                                >
                                    <div className="typeOptions">{nameOption}</div>
                                </DrawerSection>

                                {advancedEntry}
                                {previewEntry}
                            </>
                        )}

                        {indexKind === 'vector' && (
                            <DrawerSection
                                title={l10n.t('Vector index')}
                                hint={l10n.t('Similarity search over vector embeddings.')}
                            >
                                <MessageBar intent="info">
                                    <MessageBarBody>
                                        <MessageBarTitle>{l10n.t('Not yet available')}</MessageBarTitle>
                                        {l10n.t('Vector index creation will be added in a future update.')}
                                    </MessageBarBody>
                                </MessageBar>
                            </DrawerSection>
                        )}
                    </div>
                ) : page === 'advanced' ? (
                    <div className="createIndexForm">
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
                ) : (
                    <div className="createIndexForm previewForm">
                        <DrawerSection
                            title={l10n.t('Index specification')}
                            hint={l10n.t('This is the specification that will be passed to createIndex().')}
                        >
                            <JsonInputEditor
                                value={buildPreviewText()}
                                readOnly
                                fill
                                onChange={() => undefined}
                                ariaLabel={l10n.t('Index specification preview')}
                            />
                        </DrawerSection>
                    </div>
                )}
            </DrawerBody>

            <DrawerFooter>
                {page !== 'main' ? (
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
            </DrawerFooter>
        </OverlayDrawer>
    );
};
