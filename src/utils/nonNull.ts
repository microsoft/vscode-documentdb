/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';

/**
 * NOTE: These helpers append a short context string to thrown errors to help with triage.
 *
 * Parameter guidelines:
 * - `message` (required): A short, human-friendly identifier for the value being checked.
 *   Use the actual member access or assignment LHS from your code:
 *   - Member access: 'selectedItem.cluster.connectionString'
 *   - Wizard context property: 'wizardContext.password'
 *   - Local variable or expression: 'connectionString.match(...)'
 *
 * - `details` (required): A short file identifier using the actual file base name from your code.
 *   Since this is an open source project, use real file names like 'ExecuteStep.ts', 'ConnectionItem.ts', etc.
 *   Keep it short and inline (do not create a constant).
 *
 * Example usage with actual code references:
 *   nonNullProp(selectedItem.cluster, 'connectionString', 'selectedItem.cluster.connectionString', 'ExecuteStep.ts')
 */

/**
 * Retrieves a property by name from an object and asserts it's not null or undefined.
 * Provides compile-time type checking for the property name.
 *
 * @param sourceObj - The object to read the property from
 * @param name - The property name (compile-time checked)
 * @param message - Short identifier describing the checked value (prefer member-access or LHS)
 * @param details - Short file identifier (file base name) used to help triage runtime errors
 * @returns The non-null property value
 * @throws Error with message format: "<propertyName>, <message> (details)" when value is missing
 */
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
 * Validates that a given value is not null or undefined.
 *
 * @param value - The value to check
 * @param propertyNameOrMessage - Property name or short human message describing the value
 *                                (prefer member-access or the LHS of the assignment)
 * @param details - Short file identifier (file base name) used to assist with triage
 * @returns The validated non-null value
 * @throws Error when value is null or undefined
 *
 * @example
 * ```typescript
 * nonNullValue(someVar, 'connectionString', 'ExecuteStep.ts')
 * ```
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
 * Validates that a given string is not null, undefined, or empty.
 *
 * @param value - The string to check
 * @param propertyNameOrMessage - Property name or message describing the value (e.g. 'database')
 * @param details - Short file identifier (file base name) to help triage issues
 * @returns The validated non-empty string
 * @throws Error when value is null, undefined, or empty string
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
