/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Combobox,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Dropdown,
    Field,
    Input,
    MessageBar,
    MessageBarBody,
    MessageBarTitle,
    Option,
    Switch,
    Textarea,
    Tooltip,
} from '@fluentui/react-components';
import { AddRegular, DeleteRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useMemo, useState, type JSX } from 'react';
import { ASC_DIRECTION, DESC_DIRECTION, LARGE_COLLECTION_THRESHOLD_DOCS } from '../constants';
import { type CreateIndexInput, type CreateIndexType, type SortDirection } from '../types';

/**
 * Per-field type/direction choice. Each row in the "Index fields" section
 * picks one of these. The dialog later collapses the list of per-row
 * choices into an index-level `CreateIndexType` for the backend payload.
 *
 * - `asc` / `desc` → single-field (or compound) B-tree index, with the
 *   direction recorded for that specific key.
 * - `text` / `geospatial` / `ttl` → applies to the field that owns the
 *   row; the index inherits that type at submit time.
 */
type IndexTypeChoice = 'asc' | 'desc' | 'ttl' | 'geospatial' | 'text';

/**
 * Local row state for the editable fields list. Each row gets a stable id so
 * React can key it across reorders without relying on the field name (which
 * can be empty mid-edit). `typeChoice` is undefined until the user picks
 * one, so we can disable submission until every populated row has a type.
 */
interface FieldDraft {
    id: string;
    field: string;
    typeChoice: IndexTypeChoice | undefined;
}

function makeFieldId(): string {
    return `field-${Math.random().toString(36).slice(2, 10)}`;
}

const INITIAL_FIELD = (): FieldDraft => ({ id: makeFieldId(), field: '', typeChoice: undefined });

/**
 * Build the localised type-picker options lazily inside the component so
 * `l10n.t()` is invoked after the localisation bundle has loaded.
 */
function buildTypeLabels(): ReadonlyArray<{ value: IndexTypeChoice; label: string }> {
    return [
        { value: 'asc', label: l10n.t('Asc (1)') },
        { value: 'desc', label: l10n.t('Desc (-1)') },
        { value: 'ttl', label: l10n.t('TTL') },
        { value: 'geospatial', label: l10n.t('Geospatial') },
        { value: 'text', label: l10n.t('Text') },
    ];
}

/** Convert a per-row type choice into the wire-level sort direction (1 / -1). */
function choiceToDirection(choice: IndexTypeChoice): SortDirection {
    return choice === 'desc' ? DESC_DIRECTION : ASC_DIRECTION;
}

/**
 * Collapse the per-row type choices into a single index-level
 * `CreateIndexType` for the backend payload. Precedence reflects what
 * DocumentDB itself supports — a "text" field forces the whole index to
 * be a text index, geo wins over ttl, etc. When every row is asc/desc we
 * fall back to a (possibly compound) single-field index.
 */
function resolveIndexType(choices: ReadonlyArray<IndexTypeChoice>): CreateIndexType {
    if (choices.includes('text')) {
        return 'text';
    }
    if (choices.includes('geospatial')) {
        return 'geospatial';
    }
    if (choices.includes('ttl')) {
        return 'ttl';
    }
    return 'singleField';
}

export interface CreateIndexDialogProps {
    open: boolean;
    /** Suggested field names from the schema scanner. */
    fieldSuggestions: ReadonlyArray<string>;
    /** Document count used to decide whether to surface the large-collection banner. */
    documentCount: number;
    onCancel: () => void;
    onSubmit: (input: CreateIndexInput) => Promise<void>;
}

export const CreateIndexDialog = ({
    open,
    fieldSuggestions,
    documentCount,
    onCancel,
    onSubmit,
}: CreateIndexDialogProps): JSX.Element => {
    const [fields, setFields] = useState<FieldDraft[]>([INITIAL_FIELD()]);
    const [name, setName] = useState('');
    const [notes, setNotes] = useState('');
    const [unique, setUnique] = useState(false);
    const [sparse, setSparse] = useState(false);
    const [ttlSeconds, setTtlSeconds] = useState<string>('');
    const [submitting, setSubmitting] = useState(false);

    const typeLabels = useMemo(() => buildTypeLabels(), []);

    const reset = (): void => {
        setFields([INITIAL_FIELD()]);
        setName('');
        setNotes('');
        setUnique(false);
        setSparse(false);
        setTtlSeconds('');
        setSubmitting(false);
    };

    const handleCancel = (): void => {
        if (submitting) {
            return;
        }
        reset();
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

    /**
     * A row is "complete" only when both the field name and the type have
     * been chosen. We only ship complete rows to the backend so users can
     * leave blank scaffolding rows in the form without breaking submit.
     */
    const completedRows = useMemo(
        () => fields.filter((f) => f.field.trim().length > 0 && f.typeChoice !== undefined),
        [fields],
    );

    const resolvedType = useMemo(
        () => resolveIndexType(completedRows.map((r) => r.typeChoice as IndexTypeChoice)),
        [completedRows],
    );

    const ttlValid = resolvedType !== 'ttl' || (ttlSeconds.trim() !== '' && Number.parseInt(ttlSeconds, 10) > 0);
    const canSubmit = completedRows.length > 0 && ttlValid && !submitting;

    const handleSubmit = async (): Promise<void> => {
        if (!canSubmit) {
            return;
        }
        setSubmitting(true);
        try {
            const payload: CreateIndexInput = {
                fields: completedRows.map((r) => ({
                    field: r.field.trim(),
                    direction: choiceToDirection(r.typeChoice as IndexTypeChoice),
                })),
                type: resolvedType,
                name: name.trim() || undefined,
                notes: notes.trim() || undefined,
            };
            if (resolvedType === 'singleField') {
                payload.unique = unique;
                payload.sparse = sparse;
            }
            if (resolvedType === 'ttl') {
                payload.expireAfterSeconds = Number.parseInt(ttlSeconds, 10);
            }
            await onSubmit(payload);
            reset();
        } catch {
            // The caller surfaces errors via displayErrorMessage; we just keep the
            // dialog open so the user can adjust input and retry.
            setSubmitting(false);
        }
    };

    const showLargeCollectionWarning = documentCount > LARGE_COLLECTION_THRESHOLD_DOCS;
    // Sparse/Unique switches only make sense for plain b-tree indexes.
    const showSingleFieldOptions = resolvedType === 'singleField' && completedRows.length > 0;
    const showTtlOptions = resolvedType === 'ttl';

    return (
        <Dialog open={open} onOpenChange={(_, data) => !data.open && handleCancel()}>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>{l10n.t('Create Index')}</DialogTitle>
                    <DialogContent>
                        <div className="createIndexDialog">
                            {showLargeCollectionWarning && (
                                <MessageBar intent="warning">
                                    <MessageBarBody>
                                        <MessageBarTitle>{l10n.t('Large collection')}</MessageBarTitle>
                                        {l10n.t('Index creation may impact write performance during build.')}
                                    </MessageBarBody>
                                </MessageBar>
                            )}

                            {/*
                             * "Index fields" — one row per key in the index. Each row
                             * pairs a field-name combobox with a per-field type
                             * dropdown (Asc / Desc / TTL / Geospatial / Text). The
                             * delete control only appears when there is more than one
                             * row, since at least one field is required.
                             */}
                            <Field label={l10n.t('Index fields')} required>
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
                                                className="fieldGrow"
                                                placeholder={l10n.t('Select a type')}
                                                selectedOptions={draft.typeChoice ? [draft.typeChoice] : []}
                                                value={
                                                    draft.typeChoice
                                                        ? (typeLabels.find((t) => t.value === draft.typeChoice)
                                                              ?.label ?? '')
                                                        : ''
                                                }
                                                onOptionSelect={(_, data) =>
                                                    updateField(draft.id, {
                                                        typeChoice:
                                                            (data.optionValue as IndexTypeChoice | undefined) ??
                                                            undefined,
                                                    })
                                                }
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
                            </Field>

                            <div>
                                <Button appearance="subtle" size="small" icon={<AddRegular />} onClick={addField}>
                                    {l10n.t('Add field (compound)')}
                                </Button>
                            </div>

                            {showSingleFieldOptions && (
                                <div className="typeOptions">
                                    <Switch
                                        checked={unique}
                                        onChange={(_, data) => setUnique(data.checked)}
                                        label={l10n.t('Unique')}
                                    />
                                    <Switch
                                        checked={sparse}
                                        onChange={(_, data) => setSparse(data.checked)}
                                        label={l10n.t('Sparse')}
                                    />
                                </div>
                            )}

                            {showTtlOptions && (
                                <div className="typeOptions">
                                    <Field
                                        label={l10n.t('Expire after (seconds)')}
                                        required
                                        validationState={ttlValid ? 'none' : 'error'}
                                        validationMessage={
                                            ttlValid ? undefined : l10n.t('Enter a positive number of seconds.')
                                        }
                                    >
                                        <Input
                                            type="number"
                                            min={1}
                                            value={ttlSeconds}
                                            onChange={(e) => setTtlSeconds(e.target.value)}
                                        />
                                    </Field>
                                </div>
                            )}

                            <Field
                                label={l10n.t('Index Name (optional)')}
                                hint={l10n.t('If left empty, the server generates a name from the field list.')}
                            >
                                <Input value={name} onChange={(e) => setName(e.target.value)} />
                            </Field>

                            <Field label={l10n.t('Notes (optional)')}>
                                <Textarea value={notes} onChange={(_, data) => setNotes(data.value)} rows={2} />
                            </Field>
                        </div>
                    </DialogContent>
                    <DialogActions>
                        <Button appearance="primary" onClick={() => void handleSubmit()} disabled={!canSubmit}>
                            {submitting ? l10n.t('Creating…') : l10n.t('Create Index')}
                        </Button>
                        <Button appearance="secondary" onClick={handleCancel} disabled={submitting}>
                            {l10n.t('Cancel')}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};
