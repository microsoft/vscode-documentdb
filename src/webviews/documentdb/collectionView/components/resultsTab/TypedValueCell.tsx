/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, Tooltip } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';
import { type GridCellValue } from '../../../../../utils/documentGrid/types';
import { bsonStringToDisplayString } from '../../../../utils/documentGrid/typeToDisplayString';

const typeGlyphs: Readonly<Record<string, string>> = {
    string: 'Ab',
    number: '12',
    int32: 'i32',
    double: '.12',
    decimal128: 'd128',
    long: 'L',
    boolean: 'tf',
    object: '{ }',
    array: '[ ]',
    null: 'Ø',
    undefined: '?',
    date: 'DT',
    regexp: '/./',
    binary: '01',
    objectid: 'ID',
    symbol: 'Σ',
    timestamp: 'TS',
    minkey: 'Min',
    maxkey: 'Max',
    dbref: 'DB',
    uuid: 'U',
    'uuid-legacy': 'U~',
    code: '</>',
    codewithscope: '</>',
    map: 'map',
    _unknown_: '??',
    unknown: '??',
};

const useStyles = makeStyles({
    root: {
        display: 'flex',
        alignItems: 'baseline',
        width: '100%',
        minWidth: 0,
        minBlockSize: '1lh',
    },
    value: {
        minWidth: 0,
    },
    type: {
        flexShrink: 0,
        marginInlineStart: 'auto',
        paddingInlineStart: '3px',
        fontSize: 'smaller',
        opacity: 0.4,
    },
});

export interface TypedValueCellProps {
    readonly value: GridCellValue | undefined;
    readonly isRootId: boolean;
}

export function TypedValueCell({ value }: TypedValueCellProps): JSX.Element {
    const styles = useStyles();

    if (value === undefined) {
        const content = l10n.t('This field is not set');
        return (
            <Tooltip content={content} relationship="label">
                <span className={styles.root} role="group" />
            </Tooltip>
        );
    }

    const glyph = typeGlyphs[value.type] ?? '??';
    const typeName = bsonStringToDisplayString(value.type);

    return (
        <Tooltip content={typeName} relationship="description">
            <span className={styles.root}>
                <span className={styles.value}>{value.display}</span>
                <span className={styles.type}>{glyph}</span>
            </span>
        </Tooltip>
    );
}
