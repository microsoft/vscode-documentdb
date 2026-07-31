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
    InfoRegular,
    KeyboardRegular,
    PanelRightContractRegular,
    SendRegular,
    SettingsRegular,
    WindowConsoleRegular,
} from '@fluentui/react-icons';
import { Collapse } from '@fluentui/react-motion-components-preview';
import * as l10n from '@vscode/l10n';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import { LARGE_COLLECTION_THRESHOLD_DOCS } from '../constants';
import {
    type CreateIndexInput,
    type FieldCreateIndexInput,
    type FieldIndexType,
    type VectorAlgorithmSpec,
    type VectorCompressionSpec,
    type VectorCreateIndexInput,
} from '../types';
import {
    buildWildcardKey,
    buildWildcardProjectionObject,
    createInitialIndexFormState,
    isBlankIndexOption,
    isWildcardParentPathValid,
    makeProjectionFieldId,
    type IndexKind,
    type VectorCompressionChoice,
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

/** Vector-algorithm options and a one-line description of each. */
function buildVectorAlgorithmOptions(): ReadonlyArray<{
    value: VectorAlgorithmSpec['kind'];
    label: string;
    hint: string;
}> {
    return [
        {
            value: 'vector-diskann',
            label: l10n.t('DiskANN'),
            hint: l10n.t('Scalable graph recommended for large collections.'),
        },
        { value: 'vector-hnsw', label: l10n.t('HNSW'), hint: l10n.t('Balanced speed and recall for most workloads.') },
        { value: 'vector-ivf', label: l10n.t('IVF'), hint: l10n.t('Fast, light build for smaller collections.') },
    ];
}

/** Wildcard scope choices and the controls each choice reveals. */
function buildWildcardScopeOptions(): ReadonlyArray<{ value: WildcardScope; label: string; hint: string }> {
    return [
        {
            value: 'all',
            label: l10n.t('All fields'),
            hint: l10n.t('Index every field in each document with a single wildcard key.'),
        },
        {
            value: 'projection',
            label: l10n.t('Projection'),
            hint: l10n.t('Include only selected fields, or exclude selected fields while indexing all others.'),
        },
        {
            value: 'path',
            label: l10n.t('Fields below a path'),
            hint: l10n.t('Index fields nested below one parent path.'),
        },
    ];
}

/** Similarity-metric options for a vector index. */
function buildVectorSimilarityOptions(): ReadonlyArray<{ value: 'COS' | 'L2' | 'IP'; label: string }> {
    return [
        { value: 'COS', label: l10n.t('Cosine (COS)') },
        { value: 'L2', label: l10n.t('Euclidean (L2)') },
        { value: 'IP', label: l10n.t('Inner product (IP)') },
    ];
}

/** Parse a non-empty string as a strictly positive integer, or `undefined`. */
function parsePositiveInt(text: string): number | undefined {
    const trimmed = text.trim();
    if (trimmed === '') {
        return undefined;
    }
    const value = Number.parseInt(trimmed, 10);
    return value > 0 && String(value) === trimmed ? value : undefined;
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
    required,
    children,
}: {
    title: string;
    hint?: string;
    /** A small, always-visible example rendered in monospace above the inputs. */
    example?: string;
    /** Marks the section's input as required with a trailing asterisk. */
    required?: boolean;
    children: ReactNode;
}): JSX.Element {
    return (
        <section className="drawerSection">
            <div className="drawerSectionTitle">
                {title}
                {required && (
                    <span className="drawerSectionRequired" aria-hidden="true">
                        *
                    </span>
                )}
            </div>
            {hint && <div className="drawerSectionHint">{hint}</div>}
            {example && <code className="drawerSectionExample">{example}</code>}
            <div className="drawerSectionBody">{children}</div>
        </section>
    );
}

/**
 * One index-level option: a compact switch with a short label, an optional
 * info icon that reveals a longer explanation on hover/focus, plus an
 * optional reason shown when the option is disabled and any revealed input.
 * Details remain mounted through their exit motion so they collapse smoothly.
 */
function OptionRow({
    label,
    tooltip,
    checked,
    disabled = false,
    disabledReason,
    onToggle,
    children,
}: {
    label: string;
    /** Longer explanation shown via a tooltip on the info icon next to the label. */
    tooltip?: string;
    checked: boolean;
    disabled?: boolean;
    disabledReason?: string;
    onToggle: (checked: boolean) => void;
    children?: ReactNode;
}): JSX.Element {
    const reason = disabled && disabledReason !== undefined ? disabledReason : undefined;
    return (
        <div className="optionItem">
            <div className="optionSwitchRow">
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
                {tooltip && (
                    <Tooltip content={tooltip} relationship="description" withArrow>
                        <InfoRegular className="optionInfoIcon" tabIndex={0} aria-label={tooltip} />
                    </Tooltip>
                )}
            </div>
            <Collapse visible={reason !== undefined} unmountOnExit>
                <div className="optionDetail">
                    {reason !== undefined && <div className="optionDescription">{reason}</div>}
                </div>
            </Collapse>
            <Collapse visible={checked && children !== undefined} unmountOnExit>
                <div className="optionDetail">{children}</div>
            </Collapse>
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
        wildcardName,
        wildcardNameEnabled,
        wildcardPartialText,
        wildcardCollationText,
        wildcardScope,
        wildcardPath,
        wildcardProjectionMode,
        wildcardProjectionFields,
        vectorField,
        vectorNameEnabled,
        vectorName,
        vectorDimensions,
        vectorSimilarity,
        vectorAlgorithm,
        vectorNumLists,
        vectorM,
        vectorEfConstruction,
        vectorMaxDegree,
        vectorLBuild,
        vectorCompression,
        vectorPqCompressedDims,
        vectorPqSampleSize,
    } = form;

    const typeLabels = useMemo(() => buildTypeLabels(), []);
    const wildcardScopeOptions = useMemo(() => buildWildcardScopeOptions(), []);
    const vectorAlgorithmOptions = useMemo(() => buildVectorAlgorithmOptions(), []);
    const vectorSimilarityOptions = useMemo(() => buildVectorSimilarityOptions(), []);

    // Roving-focus targets for the algorithm radio-card group, so arrow keys can
    // move focus to the newly selected card.
    const algorithmCardRefs = useRef<Record<string, HTMLButtonElement | null>>({});
    const wildcardScopeCardRefs = useRef<Record<WildcardScope, HTMLButtonElement | null>>({
        all: null,
        projection: null,
        path: null,
    });
    const advancedEntryRef = useRef<HTMLButtonElement>(null);
    const previewEntryRef = useRef<HTMLButtonElement>(null);
    const pageTitleRef = useRef<HTMLSpanElement>(null);
    const previousPageRef = useRef<DrawerPage>(page);
    const lastMainEntryRef = useRef<Exclude<DrawerPage, 'main'>>('advanced');

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

    useEffect(() => {
        const previousPage = previousPageRef.current;
        previousPageRef.current = page;
        if (previousPage === page) {
            return;
        }
        if (page === 'main') {
            const entry = lastMainEntryRef.current === 'advanced' ? advancedEntryRef : previewEntryRef;
            entry.current?.focus();
        } else {
            pageTitleRef.current?.focus();
        }
    }, [page]);

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

    const openPushedPage = (nextPage: Exclude<DrawerPage, 'main'>): void => {
        lastMainEntryRef.current = nextPage;
        setPage(nextPage);
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
    const fieldName = indexKind === 'wildcard' ? wildcardName : name;
    const fieldNameEnabled = indexKind === 'wildcard' ? wildcardNameEnabled : nameEnabled;
    const fieldPartialText = indexKind === 'wildcard' ? wildcardPartialText : partialText;
    const fieldCollationText = indexKind === 'wildcard' ? wildcardCollationText : collationText;
    const hasPartialFilter = !isBlankIndexOption(fieldPartialText);
    const hasCollation = !isBlankIndexOption(fieldCollationText);

    // The structured projection editor collapses to a plain object; `undefined`
    // means "nothing meaningful configured" so it is treated like an omitted
    // option everywhere. The dedicated projection scope uses the all-fields
    // `$**` key and adds the configured projection object.
    const wildcardProjectionObject = useMemo(
        () =>
            indexKind === 'wildcard' && wildcardScope === 'projection'
                ? buildWildcardProjectionObject(wildcardProjectionMode, wildcardProjectionFields)
                : undefined,
        [indexKind, wildcardScope, wildcardProjectionMode, wildcardProjectionFields],
    );
    const hasWildcardProjection = wildcardProjectionObject !== undefined;

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

    // --- Vector form --------------------------------------------------------
    const vectorFieldValue = vectorField.trim();
    const parsedDimensions = parsePositiveInt(vectorDimensions);
    const vectorNameValue = vectorName.trim();

    // Compression compatibility: half precision applies to IVF/HNSW, product
    // quantization to DiskANN. If the current choice is incompatible with the
    // selected algorithm it collapses to "none", so the payload, preview, and
    // validation never carry an invalid pairing.
    const compressionAllowed: ReadonlyArray<VectorCompressionChoice> =
        vectorAlgorithm === 'vector-diskann' ? ['none', 'pq'] : ['none', 'half'];
    const effectiveCompression: VectorCompressionChoice = compressionAllowed.includes(vectorCompression)
        ? vectorCompression
        : 'none';

    const parsedNumLists = parsePositiveInt(vectorNumLists);
    const parsedM = parsePositiveInt(vectorM);
    const parsedEfConstruction = parsePositiveInt(vectorEfConstruction);
    const parsedMaxDegree = parsePositiveInt(vectorMaxDegree);
    const parsedLBuild = parsePositiveInt(vectorLBuild);

    const inRange = (value: number | undefined, min: number, max: number): value is number =>
        value !== undefined && value >= min && value <= max;

    const algorithmTuningValid =
        vectorAlgorithm === 'vector-ivf'
            ? parsedNumLists !== undefined
            : vectorAlgorithm === 'vector-hnsw'
              ? inRange(parsedM, 2, 100) &&
                inRange(parsedEfConstruction, 4, 1000) &&
                parsedEfConstruction >= 2 * parsedM
              : inRange(parsedMaxDegree, 20, 2048) && inRange(parsedLBuild, 10, 500);

    // PQ tuning is optional; a value is only validated when it is non-empty.
    const parsedPqCompressedDims =
        vectorPqCompressedDims.trim() === '' ? undefined : parsePositiveInt(vectorPqCompressedDims);
    const parsedPqSampleSize = vectorPqSampleSize.trim() === '' ? undefined : parsePositiveInt(vectorPqSampleSize);
    const pqCompressedDimsValid =
        effectiveCompression !== 'pq' ||
        vectorPqCompressedDims.trim() === '' ||
        (parsedPqCompressedDims !== undefined &&
            parsedDimensions !== undefined &&
            parsedPqCompressedDims < parsedDimensions);
    const pqSampleSizeValid =
        effectiveCompression !== 'pq' || vectorPqSampleSize.trim() === '' || inRange(parsedPqSampleSize, 1000, 100000);

    const vectorValid =
        vectorFieldValue !== '' &&
        parsedDimensions !== undefined &&
        algorithmTuningValid &&
        pqCompressedDimsValid &&
        pqSampleSizeValid;

    const vectorAlgorithmLabel = vectorAlgorithmOptions.find((o) => o.value === vectorAlgorithm)?.label ?? '';

    const moveWildcardScopeSelection = (offset: number): void => {
        const values = wildcardScopeOptions.map((option) => option.value);
        const currentIndex = values.indexOf(wildcardScope);
        const next = values[(currentIndex + offset + values.length) % values.length];
        setForm((prev) => ({ ...prev, wildcardScope: next }));
        wildcardScopeCardRefs.current[next]?.focus();
    };

    // Select the algorithm `offset` positions from the current one (wrapping) and
    // move focus to its card, so the radio-card group is keyboard navigable.
    const moveAlgorithmSelection = (offset: number): void => {
        const values = vectorAlgorithmOptions.map((option) => option.value);
        const currentIndex = values.indexOf(vectorAlgorithm);
        const next = values[(currentIndex + offset + values.length) % values.length];
        setForm((prev) => ({ ...prev, vectorAlgorithm: next }));
        algorithmCardRefs.current[next]?.focus();
    };

    const vectorCompressionLabel =
        effectiveCompression === 'half'
            ? l10n.t('Half precision')
            : effectiveCompression === 'pq'
              ? l10n.t('Product quantization')
              : '';

    const advancedHasContent =
        indexKind === 'vector' ? effectiveCompression !== 'none' : hasPartialFilter || hasCollation;

    // Which advanced settings are populated — surfaced on the entry so the user
    // can tell at a glance what is configured behind it.
    const advancedSummary =
        indexKind === 'vector'
            ? [
                  l10n.t('{0} tuning', vectorAlgorithmLabel),
                  vectorCompressionLabel === '' ? undefined : vectorCompressionLabel,
              ]
                  .filter((part): part is string => part !== undefined)
                  .join(' · ')
            : [hasPartialFilter ? l10n.t('Partial filter') : undefined, hasCollation ? l10n.t('Collation') : undefined]
                  .filter((part): part is string => part !== undefined)
                  .join(' · ');

    // The Advanced entry's default sub-label depends on which settings live
    // behind it for the active index kind.
    const advancedDefaultSub =
        indexKind === 'vector'
            ? l10n.t('Algorithm tuning, compression')
            : l10n.t('Partial filter expression, custom collation');

    const canSubmit =
        !submitting &&
        (indexKind === 'standard'
            ? completedRows.length > 0 && ttlNumberValid
            : indexKind === 'wildcard'
              ? wildcardPathValid
              : vectorValid);

    // A live, plain-language explanation of what still blocks creation, shown
    // above the footer only while the primary action is disabled. Empty when the
    // form is ready to submit (or already submitting).
    const submitRequirement =
        indexKind === 'standard'
            ? completedRows.length === 0
                ? l10n.t('Add at least one index field to create the index.')
                : !ttlNumberValid
                  ? l10n.t('Enter a valid TTL value to continue.')
                  : ''
            : indexKind === 'wildcard'
              ? !wildcardPathValid
                  ? l10n.t('Remove $** from the parent path — it is added automatically.')
                  : ''
              : vectorFieldValue === ''
                ? l10n.t('Enter a vector field to create the index.')
                : parsedDimensions === undefined
                  ? l10n.t('Enter the vector dimensions to create the index.')
                  : l10n.t('Fix the highlighted values in Advanced settings to continue.');

    // Assemble the field-keyed (Standard/Wildcard) payload.
    const buildFieldPayload = (): FieldCreateIndexInput => {
        if (indexKind === 'wildcard') {
            const payload: FieldCreateIndexInput = {
                fields: [{ field: buildWildcardKey(wildcardScope, wildcardPath), type: 'asc' }],
            };
            if (fieldNameEnabled && fieldName.trim() !== '') {
                payload.name = fieldName.trim();
            }
            if (hasPartialFilter) {
                payload.partialFilterExpression = fieldPartialText.trim();
            }
            if (hasCollation) {
                payload.collation = fieldCollationText.trim();
            }
            if (hasWildcardProjection) {
                payload.wildcardProjection = JSON.stringify(wildcardProjectionObject);
            }
            return payload;
        }

        const payload: FieldCreateIndexInput = {
            fields: completedRows.map((r) => ({ field: r.field.trim(), type: r.type })),
        };
        if (fieldNameEnabled && fieldName.trim() !== '') {
            payload.name = fieldName.trim();
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
            payload.partialFilterExpression = fieldPartialText.trim();
        }
        if (hasCollation) {
            payload.collation = fieldCollationText.trim();
        }
        return payload;
    };

    // Assemble the vector (cosmosSearch) payload. Only the selected algorithm's
    // tuning is carried, and compression is dropped unless it is compatible.
    const buildVectorPayload = (): VectorCreateIndexInput => {
        let algorithm: VectorAlgorithmSpec;
        if (vectorAlgorithm === 'vector-ivf') {
            algorithm = { kind: 'vector-ivf', numLists: parsedNumLists ?? 0 };
        } else if (vectorAlgorithm === 'vector-hnsw') {
            algorithm = { kind: 'vector-hnsw', m: parsedM ?? 0, efConstruction: parsedEfConstruction ?? 0 };
        } else {
            algorithm = { kind: 'vector-diskann', maxDegree: parsedMaxDegree ?? 0, lBuild: parsedLBuild ?? 0 };
        }

        let compression: VectorCompressionSpec | undefined;
        if (effectiveCompression === 'half') {
            compression = { kind: 'half' };
        } else if (effectiveCompression === 'pq') {
            const pq: Extract<VectorCompressionSpec, { kind: 'pq' }> = { kind: 'pq' };
            if (parsedPqCompressedDims !== undefined) {
                pq.pqCompressedDims = parsedPqCompressedDims;
            }
            if (parsedPqSampleSize !== undefined) {
                pq.pqSampleSize = parsedPqSampleSize;
            }
            compression = pq;
        }

        const payload: VectorCreateIndexInput = {
            kind: 'vector',
            field: vectorFieldValue,
            dimensions: parsedDimensions ?? 0,
            similarity: vectorSimilarity,
            algorithm,
        };
        if (vectorNameEnabled && vectorNameValue !== '') {
            payload.name = vectorNameValue;
        }
        if (compression) {
            payload.compression = compression;
        }
        return payload;
    };

    // Assemble the payload once; shared by the direct create and the
    // playground/shell hand-offs so all three produce an identical index.
    const buildPayload = (): CreateIndexInput => (indexKind === 'vector' ? buildVectorPayload() : buildFieldPayload());

    // Build a read-only, JS-style preview of the vector specification passed to
    // createIndex(). The `cosmosSearch` key and its `cosmosSearchOptions` object
    // are expanded so the preview matches the submitted command exactly.
    const buildVectorPreviewText = (): string => {
        const payload = buildVectorPayload();
        const optionLines: string[] = [
            `kind: '${payload.algorithm.kind}'`,
            `dimensions: ${payload.dimensions}`,
            `similarity: '${payload.similarity}'`,
        ];
        if (payload.algorithm.kind === 'vector-ivf') {
            optionLines.push(`numLists: ${payload.algorithm.numLists}`);
        } else if (payload.algorithm.kind === 'vector-hnsw') {
            optionLines.push(`m: ${payload.algorithm.m}`);
            optionLines.push(`efConstruction: ${payload.algorithm.efConstruction}`);
        } else {
            optionLines.push(`maxDegree: ${payload.algorithm.maxDegree}`);
            optionLines.push(`lBuild: ${payload.algorithm.lBuild}`);
        }
        if (payload.compression?.kind === 'half') {
            optionLines.push(`compression: 'half'`);
        } else if (payload.compression?.kind === 'pq') {
            optionLines.push(`compression: 'pq'`);
            if (payload.compression.pqCompressedDims !== undefined) {
                optionLines.push(`pqCompressedDims: ${payload.compression.pqCompressedDims}`);
            }
            if (payload.compression.pqSampleSize !== undefined) {
                optionLines.push(`pqSampleSize: ${payload.compression.pqSampleSize}`);
            }
        }

        const entries: string[] = [`key: { ${JSON.stringify(payload.field)}: 'cosmosSearch' }`];
        if (payload.name !== undefined) {
            entries.push(`name: ${JSON.stringify(payload.name)}`);
        }
        const optionsBody = optionLines.map((line) => `        ${line}`).join(',\n');
        entries.push(`cosmosSearchOptions: {\n${optionsBody}\n    }`);
        return `{\n${entries.map((entry) => `    ${entry}`).join(',\n')}\n}`;
    };

    // Build a read-only, JS-style preview of the specification passed to
    // createIndex(). Partial filter / collation are relaxed JSON parsed on the
    // host, so here they are embedded verbatim (continuation lines re-indented to
    // sit under their property). The wildcard projection is already a plain
    // object, so it is expanded directly.
    const buildPreviewText = (): string => {
        if (indexKind === 'vector') {
            return buildVectorPreviewText();
        }
        const payload = buildFieldPayload();
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
            label={l10n.t('Name')}
            tooltip={l10n.t('Use a custom index name.')}
            checked={fieldNameEnabled}
            disabled={interactionDisabled}
            onToggle={(checked) =>
                setForm((prev) =>
                    indexKind === 'wildcard'
                        ? { ...prev, wildcardNameEnabled: checked }
                        : { ...prev, nameEnabled: checked },
                )
            }
        >
            <Field label={l10n.t('Index name')}>
                <Input
                    value={fieldName}
                    disabled={interactionDisabled}
                    onChange={(e) =>
                        setForm((prev) =>
                            indexKind === 'wildcard'
                                ? { ...prev, wildcardName: e.target.value }
                                : { ...prev, name: e.target.value },
                        )
                    }
                />
            </Field>
        </OptionRow>
    );

    // Vector "custom index name" option. Left off, the server names the index
    // `<field>_cosmosSearch`; the input placeholder previews that default.
    const vectorNameOption = (
        <OptionRow
            label={l10n.t('Name')}
            tooltip={l10n.t('Use a custom index name.')}
            checked={vectorNameEnabled}
            disabled={interactionDisabled}
            onToggle={(checked) => setForm((prev) => ({ ...prev, vectorNameEnabled: checked }))}
        >
            <Field label={l10n.t('Index name')}>
                <Input
                    value={vectorName}
                    disabled={interactionDisabled}
                    placeholder={vectorFieldValue !== '' ? `${vectorFieldValue}_cosmosSearch` : undefined}
                    onChange={(e) => setForm((prev) => ({ ...prev, vectorName: e.target.value }))}
                />
            </Field>
        </OptionRow>
    );

    // Shared entry to the pushed Advanced sub-page (partial filter + collation).
    const advancedEntry = (
        <button
            ref={advancedEntryRef}
            type="button"
            className="advancedEntry"
            disabled={interactionDisabled}
            onClick={() => openPushedPage('advanced')}
        >
            <SettingsRegular className="advancedEntryIcon" />
            <span className="advancedEntryText">
                <span className="advancedEntryTitle">{l10n.t('Advanced settings')}</span>
                <span className="advancedEntrySub">
                    {advancedSummary !== '' ? advancedSummary : advancedDefaultSub}
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
            ref={previewEntryRef}
            type="button"
            className="advancedEntry"
            disabled={interactionDisabled}
            onClick={() => openPushedPage('preview')}
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

    // Groups the two pushed-page entries (Advanced settings, Preview as JSON)
    // under a titled section. With the option groups now unshaded, this heading
    // keeps the two entry cards from floating loose at the foot of the form.
    const advancedAndPreviewSection = (
        <DrawerSection
            title={l10n.t('More options')}
            hint={l10n.t('Optional settings and a preview of the generated index specification.')}
        >
            {advancedEntry}
            {previewEntry}
        </DrawerSection>
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
                    <span ref={pageTitleRef} className="drawerPageTitle" tabIndex={page === 'main' ? undefined : -1}>
                        {page === 'advanced'
                            ? l10n.t('Advanced settings')
                            : page === 'preview'
                              ? l10n.t('JSON preview')
                              : l10n.t('Create Index')}
                    </span>
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
                                    required
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
                                            label={l10n.t('Unique')}
                                            tooltip={l10n.t('Rejects duplicate values.')}
                                            checked={unique}
                                            disabled={interactionDisabled}
                                            onToggle={(checked) => setForm((prev) => ({ ...prev, unique: checked }))}
                                        />
                                        <OptionRow
                                            label={l10n.t('Sparse')}
                                            tooltip={l10n.t('Only indexes documents that contain the field.')}
                                            checked={sparse && !sparseDisabled}
                                            disabled={sparseDisabled || interactionDisabled}
                                            disabledReason={l10n.t(
                                                'Sparse is not available together with a partial filter expression.',
                                            )}
                                            onToggle={(checked) => setForm((prev) => ({ ...prev, sparse: checked }))}
                                        />
                                        <OptionRow
                                            label={l10n.t('TTL')}
                                            tooltip={l10n.t('Auto-deletes documents after a set age.')}
                                            checked={ttlActive}
                                            disabled={!isSingleBTree || interactionDisabled}
                                            disabledReason={l10n.t(
                                                'TTL requires a single ascending or descending field.',
                                            )}
                                            onToggle={(checked) =>
                                                setForm((prev) => ({ ...prev, ttlEnabled: checked }))
                                            }
                                        >
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
                                        </OptionRow>
                                        {nameOption}
                                    </div>
                                </DrawerSection>

                                {advancedAndPreviewSection}
                            </>
                        )}

                        {indexKind === 'wildcard' && (
                            <>
                                <DrawerSection
                                    title={l10n.t('Scope')}
                                    hint={l10n.t('Choose which fields the wildcard index covers.')}
                                >
                                    <div className="wildcardSettings">
                                        <div
                                            className="vectorAlgorithmCards"
                                            role="radiogroup"
                                            aria-label={l10n.t('Wildcard index scope')}
                                        >
                                            {wildcardScopeOptions.map((option) => {
                                                const selected = wildcardScope === option.value;
                                                return (
                                                    <button
                                                        key={option.value}
                                                        ref={(node) => {
                                                            wildcardScopeCardRefs.current[option.value] = node;
                                                        }}
                                                        type="button"
                                                        role="radio"
                                                        aria-checked={selected}
                                                        tabIndex={selected ? 0 : -1}
                                                        className={
                                                            selected
                                                                ? 'vectorAlgoCard vectorAlgoCardSelected'
                                                                : 'vectorAlgoCard'
                                                        }
                                                        disabled={interactionDisabled}
                                                        onClick={() =>
                                                            setForm((prev) => ({
                                                                ...prev,
                                                                wildcardScope: option.value,
                                                            }))
                                                        }
                                                        onKeyDown={(event) => {
                                                            if (
                                                                event.key === 'ArrowRight' ||
                                                                event.key === 'ArrowDown'
                                                            ) {
                                                                event.preventDefault();
                                                                moveWildcardScopeSelection(1);
                                                            } else if (
                                                                event.key === 'ArrowLeft' ||
                                                                event.key === 'ArrowUp'
                                                            ) {
                                                                event.preventDefault();
                                                                moveWildcardScopeSelection(-1);
                                                            }
                                                        }}
                                                    >
                                                        <span className="vectorAlgoCardTitle">{option.label}</span>
                                                        <span className="vectorAlgoCardHint">{option.hint}</span>
                                                    </button>
                                                );
                                            })}
                                        </div>

                                        <Collapse visible={wildcardScope === 'path'} unmountOnExit>
                                            <Field
                                                label={l10n.t('Parent path')}
                                                validationState={wildcardPath.includes('$**') ? 'error' : 'none'}
                                                validationMessage={
                                                    wildcardPath.includes('$**')
                                                        ? l10n.t(
                                                              'Enter a parent path without $**. It is added automatically.',
                                                          )
                                                        : undefined
                                                }
                                                hint={l10n.t('For example, metadata creates metadata.$**.')}
                                            >
                                                <div className="fieldRow">
                                                    <FieldNameCombobox
                                                        value={wildcardPath}
                                                        suggestions={fieldSuggestions}
                                                        disabled={interactionDisabled}
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
                                                            disabled={interactionDisabled}
                                                            onClick={() =>
                                                                setForm((prev) => ({ ...prev, wildcardPath: '' }))
                                                            }
                                                        />
                                                    </Tooltip>
                                                </div>
                                            </Field>
                                        </Collapse>
                                    </div>
                                </DrawerSection>

                                {/*
                                 * Projection is a dedicated scope choice: it uses the all-fields
                                 * `$**` key and reveals the include/exclude controls directly.
                                 */}
                                <Collapse visible={wildcardScope === 'projection'} unmountOnExit>
                                    <DrawerSection
                                        title={l10n.t('Projection mode')}
                                        hint={l10n.t(
                                            'Choose whether the listed fields are the only fields indexed or the fields omitted from the index.',
                                        )}
                                    >
                                        <div className="wildcardProjectionBody">
                                            <Field
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
                                                                wildcardProjectionMode: mode as WildcardProjectionMode,
                                                            }));
                                                        }
                                                    }}
                                                >
                                                    <Radio value="include" label={l10n.t('Include selected fields')} />
                                                    <Radio value="exclude" label={l10n.t('Exclude selected fields')} />
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
                                                                        onClick={() => clearProjectionField(draft.id)}
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
                                                                        onClick={() => removeProjectionField(draft.id)}
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
                                    </DrawerSection>
                                </Collapse>

                                <DrawerSection
                                    title={l10n.t('Options')}
                                    hint={l10n.t('Index-level properties applied to the whole index.')}
                                >
                                    <div className="typeOptions">{nameOption}</div>
                                </DrawerSection>

                                {advancedAndPreviewSection}
                            </>
                        )}

                        {indexKind === 'vector' && (
                            <>
                                <DrawerSection
                                    title={l10n.t('Vector field')}
                                    required
                                    hint={l10n.t(
                                        'The document field that stores the embedding array. Only one vector is indexed per path.',
                                    )}
                                >
                                    <div className="fieldRow">
                                        <FieldNameCombobox
                                            value={vectorField}
                                            suggestions={fieldSuggestions}
                                            disabled={interactionDisabled}
                                            onChange={(value) => setForm((prev) => ({ ...prev, vectorField: value }))}
                                        />
                                        <Tooltip content={l10n.t('Clear field')} relationship="description" withArrow>
                                            <Button
                                                appearance="subtle"
                                                size="small"
                                                icon={<ArrowResetRegular />}
                                                aria-label={l10n.t('Clear field')}
                                                disabled={interactionDisabled}
                                                onClick={() => setForm((prev) => ({ ...prev, vectorField: '' }))}
                                            />
                                        </Tooltip>
                                    </div>
                                </DrawerSection>

                                <DrawerSection
                                    title={l10n.t('Algorithm')}
                                    hint={l10n.t('Approximate nearest-neighbor algorithm used to build the index.')}
                                >
                                    <div
                                        className="vectorAlgorithmCards"
                                        role="radiogroup"
                                        aria-label={l10n.t('Vector algorithm')}
                                    >
                                        {vectorAlgorithmOptions.map((option) => {
                                            const selected = vectorAlgorithm === option.value;
                                            return (
                                                <button
                                                    key={option.value}
                                                    ref={(node) => {
                                                        algorithmCardRefs.current[option.value] = node;
                                                    }}
                                                    type="button"
                                                    role="radio"
                                                    aria-checked={selected}
                                                    tabIndex={selected ? 0 : -1}
                                                    className={
                                                        selected
                                                            ? 'vectorAlgoCard vectorAlgoCardSelected'
                                                            : 'vectorAlgoCard'
                                                    }
                                                    disabled={interactionDisabled}
                                                    onClick={() =>
                                                        setForm((prev) => ({ ...prev, vectorAlgorithm: option.value }))
                                                    }
                                                    onKeyDown={(event) => {
                                                        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                                                            event.preventDefault();
                                                            moveAlgorithmSelection(1);
                                                        } else if (
                                                            event.key === 'ArrowLeft' ||
                                                            event.key === 'ArrowUp'
                                                        ) {
                                                            event.preventDefault();
                                                            moveAlgorithmSelection(-1);
                                                        }
                                                    }}
                                                >
                                                    <span className="vectorAlgoCardTitle">{option.label}</span>
                                                    <span className="vectorAlgoCardHint">{option.hint}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </DrawerSection>

                                <DrawerSection
                                    title={l10n.t('Dimensions and similarity')}
                                    hint={l10n.t(
                                        'Dimensions is the fixed number of values in each vector; it comes from the embedding model. Similarity is the distance metric used to compare vectors.',
                                    )}
                                >
                                    <div className="vectorDualField">
                                        <Field
                                            label={l10n.t('Dimensions')}
                                            required
                                            validationState={
                                                vectorDimensions.trim() === '' || parsedDimensions !== undefined
                                                    ? 'none'
                                                    : 'error'
                                            }
                                            validationMessage={
                                                vectorDimensions.trim() === '' || parsedDimensions !== undefined
                                                    ? undefined
                                                    : l10n.t('Enter a positive whole number using digits only.')
                                            }
                                        >
                                            <Input
                                                type="number"
                                                min={1}
                                                value={vectorDimensions}
                                                placeholder={l10n.t('e.g. 1536')}
                                                disabled={interactionDisabled}
                                                onChange={(e) =>
                                                    setForm((prev) => ({ ...prev, vectorDimensions: e.target.value }))
                                                }
                                            />
                                        </Field>
                                        <Field label={l10n.t('Similarity')}>
                                            <Dropdown
                                                selectedOptions={[vectorSimilarity]}
                                                value={
                                                    vectorSimilarityOptions.find((o) => o.value === vectorSimilarity)
                                                        ?.label ?? ''
                                                }
                                                disabled={interactionDisabled}
                                                onOptionSelect={(_, data) => {
                                                    const value = data.optionValue;
                                                    if (value === 'COS' || value === 'L2' || value === 'IP') {
                                                        setForm((prev) => ({ ...prev, vectorSimilarity: value }));
                                                    }
                                                }}
                                                aria-label={l10n.t('Similarity metric')}
                                            >
                                                {vectorSimilarityOptions.map((option) => (
                                                    <Option key={option.value} value={option.value} text={option.label}>
                                                        {option.label}
                                                    </Option>
                                                ))}
                                            </Dropdown>
                                        </Field>
                                    </div>
                                </DrawerSection>

                                <DrawerSection
                                    title={l10n.t('Options')}
                                    hint={l10n.t('Index-level properties applied to the whole index.')}
                                >
                                    <div className="typeOptions">{vectorNameOption}</div>
                                </DrawerSection>

                                {advancedAndPreviewSection}
                            </>
                        )}
                    </div>
                ) : page === 'advanced' ? (
                    indexKind === 'vector' ? (
                        <div className="createIndexForm">
                            <DrawerSection
                                title={l10n.t('Algorithm tuning')}
                                hint={l10n.t(
                                    'Build-time settings for the selected algorithm. The defaults follow the current service recommendations.',
                                )}
                            >
                                <div className="vectorDualField">
                                    {vectorAlgorithm === 'vector-ivf' && (
                                        <Field
                                            label={l10n.t('Number of lists')}
                                            validationState={parsedNumLists !== undefined ? 'none' : 'error'}
                                            validationMessage={
                                                parsedNumLists !== undefined
                                                    ? undefined
                                                    : l10n.t('Enter a positive whole number.')
                                            }
                                        >
                                            <Input
                                                type="number"
                                                min={1}
                                                value={vectorNumLists}
                                                disabled={interactionDisabled}
                                                onChange={(e) =>
                                                    setForm((prev) => ({ ...prev, vectorNumLists: e.target.value }))
                                                }
                                            />
                                        </Field>
                                    )}
                                    {vectorAlgorithm === 'vector-hnsw' && (
                                        <>
                                            <Field
                                                label={l10n.t('Connections (m)')}
                                                validationState={inRange(parsedM, 2, 100) ? 'none' : 'error'}
                                                validationMessage={
                                                    inRange(parsedM, 2, 100)
                                                        ? undefined
                                                        : l10n.t('Enter a whole number from 2 to 100.')
                                                }
                                            >
                                                <Input
                                                    type="number"
                                                    min={2}
                                                    max={100}
                                                    value={vectorM}
                                                    disabled={interactionDisabled}
                                                    onChange={(e) =>
                                                        setForm((prev) => ({ ...prev, vectorM: e.target.value }))
                                                    }
                                                />
                                            </Field>
                                            <Field
                                                label={l10n.t('Build candidates (efConstruction)')}
                                                validationState={
                                                    inRange(parsedEfConstruction, 4, 1000) &&
                                                    (parsedM === undefined || parsedEfConstruction >= 2 * parsedM)
                                                        ? 'none'
                                                        : 'error'
                                                }
                                                validationMessage={
                                                    inRange(parsedEfConstruction, 4, 1000) &&
                                                    (parsedM === undefined || parsedEfConstruction >= 2 * parsedM)
                                                        ? undefined
                                                        : l10n.t('Enter 4 to 1000 and at least 2 × connections (m).')
                                                }
                                            >
                                                <Input
                                                    type="number"
                                                    min={4}
                                                    max={1000}
                                                    value={vectorEfConstruction}
                                                    disabled={interactionDisabled}
                                                    onChange={(e) =>
                                                        setForm((prev) => ({
                                                            ...prev,
                                                            vectorEfConstruction: e.target.value,
                                                        }))
                                                    }
                                                />
                                            </Field>
                                        </>
                                    )}
                                    {vectorAlgorithm === 'vector-diskann' && (
                                        <>
                                            <Field
                                                label={l10n.t('Maximum degree')}
                                                validationState={inRange(parsedMaxDegree, 20, 2048) ? 'none' : 'error'}
                                                validationMessage={
                                                    inRange(parsedMaxDegree, 20, 2048)
                                                        ? undefined
                                                        : l10n.t('Enter a whole number from 20 to 2048.')
                                                }
                                            >
                                                <Input
                                                    type="number"
                                                    min={20}
                                                    max={2048}
                                                    value={vectorMaxDegree}
                                                    disabled={interactionDisabled}
                                                    onChange={(e) =>
                                                        setForm((prev) => ({
                                                            ...prev,
                                                            vectorMaxDegree: e.target.value,
                                                        }))
                                                    }
                                                />
                                            </Field>
                                            <Field
                                                label={l10n.t('Build candidates (lBuild)')}
                                                validationState={inRange(parsedLBuild, 10, 500) ? 'none' : 'error'}
                                                validationMessage={
                                                    inRange(parsedLBuild, 10, 500)
                                                        ? undefined
                                                        : l10n.t('Enter a whole number from 10 to 500.')
                                                }
                                            >
                                                <Input
                                                    type="number"
                                                    min={10}
                                                    max={500}
                                                    value={vectorLBuild}
                                                    disabled={interactionDisabled}
                                                    onChange={(e) =>
                                                        setForm((prev) => ({ ...prev, vectorLBuild: e.target.value }))
                                                    }
                                                />
                                            </Field>
                                        </>
                                    )}
                                </div>
                            </DrawerSection>

                            <DrawerSection
                                title={l10n.t('Compression')}
                                hint={
                                    vectorAlgorithm === 'vector-diskann'
                                        ? l10n.t(
                                              'Product quantization compresses vectors to support higher dimensions on DiskANN indexes.',
                                          )
                                        : l10n.t(
                                              'Half precision stores index values at lower precision on IVF and HNSW indexes.',
                                          )
                                }
                            >
                                <RadioGroup
                                    value={effectiveCompression}
                                    disabled={interactionDisabled}
                                    aria-label={l10n.t('Vector index compression')}
                                    onChange={(_, data) => {
                                        const value = data.value;
                                        if (value === 'none' || value === 'half' || value === 'pq') {
                                            setForm((prev) => ({ ...prev, vectorCompression: value }));
                                        }
                                    }}
                                >
                                    <Radio value="none" label={l10n.t('None')} />
                                    {vectorAlgorithm !== 'vector-diskann' && (
                                        <Radio value="half" label={l10n.t('Half precision')} />
                                    )}
                                    {vectorAlgorithm === 'vector-diskann' && (
                                        <Radio value="pq" label={l10n.t('Product quantization')} />
                                    )}
                                </RadioGroup>

                                <Collapse visible={effectiveCompression === 'pq'} unmountOnExit>
                                    <div className="vectorDualField">
                                        <Field
                                            label={l10n.t('Compressed dimensions (optional)')}
                                            validationState={pqCompressedDimsValid ? 'none' : 'error'}
                                            validationMessage={
                                                pqCompressedDimsValid
                                                    ? undefined
                                                    : l10n.t('Enter a positive whole number below the dimensions.')
                                            }
                                        >
                                            <Input
                                                type="number"
                                                min={1}
                                                value={vectorPqCompressedDims}
                                                disabled={interactionDisabled}
                                                onChange={(e) =>
                                                    setForm((prev) => ({
                                                        ...prev,
                                                        vectorPqCompressedDims: e.target.value,
                                                    }))
                                                }
                                            />
                                        </Field>
                                        <Field
                                            label={l10n.t('Sample size (optional)')}
                                            validationState={pqSampleSizeValid ? 'none' : 'error'}
                                            validationMessage={
                                                pqSampleSizeValid
                                                    ? undefined
                                                    : l10n.t('Enter a whole number from 1000 to 100000.')
                                            }
                                        >
                                            <Input
                                                type="number"
                                                min={1000}
                                                max={100000}
                                                value={vectorPqSampleSize}
                                                disabled={interactionDisabled}
                                                onChange={(e) =>
                                                    setForm((prev) => ({ ...prev, vectorPqSampleSize: e.target.value }))
                                                }
                                            />
                                        </Field>
                                    </div>
                                </Collapse>
                            </DrawerSection>
                        </div>
                    ) : (
                        <div className="createIndexForm">
                            <DrawerSection
                                title={l10n.t('Partial filter expression')}
                                hint={l10n.t('Only index documents that match this filter. Enter a JSON object.')}
                                example={"{ status: { $eq: 'active' } }"}
                            >
                                <JsonInputEditor
                                    value={fieldPartialText}
                                    readOnly={interactionDisabled}
                                    onChange={(value) =>
                                        setForm((prev) =>
                                            indexKind === 'wildcard'
                                                ? { ...prev, wildcardPartialText: value }
                                                : { ...prev, partialText: value },
                                        )
                                    }
                                    ariaLabel={l10n.t('Partial filter expression: enter a JSON object')}
                                />
                            </DrawerSection>

                            <DrawerSection
                                title={l10n.t('Collation')}
                                hint={l10n.t('Language-specific comparison rules. Enter a JSON object.')}
                                example={"{ locale: 'en', strength: 2 }"}
                            >
                                <JsonInputEditor
                                    value={fieldCollationText}
                                    readOnly={interactionDisabled}
                                    onChange={(value) =>
                                        setForm((prev) =>
                                            indexKind === 'wildcard'
                                                ? { ...prev, wildcardCollationText: value }
                                                : { ...prev, collationText: value },
                                        )
                                    }
                                    ariaLabel={l10n.t('Collation: enter a JSON object')}
                                />
                            </DrawerSection>
                        </div>
                    )
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
                    <div className="createIndexFooterMain">
                        {!canSubmit && !submitting && submitRequirement !== '' && (
                            <div className="submitRequirement" role="status">
                                <InfoRegular className="submitRequirementIcon" />
                                <span>{submitRequirement}</span>
                            </div>
                        )}
                        <div className="createIndexFooterActions">
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
                        </div>
                    </div>
                )}
            </DrawerFooter>
        </OverlayDrawer>
    );
};
