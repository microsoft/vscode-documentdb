/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';

/**
 * Retrieves a property by name from an object and checks that it's not null and not undefined.  It is strongly typed
 * for the property and will give a compile error if the given name is not a property of the source.
 */
// NOTE: when calling these helpers from source files in this open-source repo, prefer passing a
// short file identifier (for example a repo-relative path) via the optional
// `details` parameter — it makes debugging and issue triage much easier for external contributors.
export function nonNullProp<TSource, TKey extends keyof TSource>(
    sourceObj: TSource,
    name: TKey,
    message: string,
    details: string,
): NonNullable<TSource[TKey]> {
    const value: NonNullable<TSource[TKey]> = <NonNullable<TSource[TKey]>>sourceObj[name];
    return nonNullValue(value, `${<string>name}, ${message}`, details);
}

/**
 * Validates that a given value is not null and not undefined.
 */
/**
 * Validates that a given value is not null and not undefined.
 *
 * @param value The value to check.
 * @param propertyNameOrMessage Optional property name or human message.
 * @param details Optional short context (file name or identifier). Recommended for open-source issue triage.
 */
export function nonNullValue<T>(value: T | undefined | null, propertyNameOrMessage: string, details: string): T {
    if (value === undefined || value === null) {
        throw new Error(
            l10n.t('Internal error: Expected value to be neither null nor undefined') +
                (propertyNameOrMessage ? `: ${propertyNameOrMessage}` : '') +
                (details ? ` (${details})` : ''),
        );
    }

    return value;
}

/**
 * Validates that a given string is not null, undefined, nor empty
 */
/**
 * Validates that a given string is not null, undefined, nor empty
 *
 * @param value The string to check.
 * @param propertyNameOrMessage Optional property name or human message.
 * @param details Optional short context (file name or identifier). Recommended for open-source issue triage.
 */
export function nonNullOrEmptyValue(value: string | undefined, propertyNameOrMessage: string, details: string): string {
    if (!value) {
        throw new Error(
            l10n.t('Internal error: Expected value to be neither null, undefined, nor empty') +
                (propertyNameOrMessage ? `: ${propertyNameOrMessage}` : '') +
                (details ? ` (${details})` : ''),
        );
    }

    return value;
}
