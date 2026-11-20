/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { httpStatus, networkCode } from './connectionErrorClassification';

describe('httpStatus', (): void => {
    it.each([
        [{ code: 403 }, 403],
        [{ statusCode: 404 }, 404],
        [{ status: 401 }, 401],
        [{ response: { statusCode: 503 } }, 503],
        [{ response: { status: 404 } }, 404],
        [{ response: { code: 403 } }, 403],
        [{ code: '403' }, undefined],
        [{ code: 403.5 }, undefined],
        [{ code: 99 }, undefined],
        [{ code: 600 }, undefined],
        [null, undefined],
    ])('extracts only numeric HTTP statuses from %s', (error, expected): void => {
        expect(httpStatus(error)).toBe(expected);
    });
});

describe('networkCode', (): void => {
    it.each([
        [{ code: 'ECONNREFUSED', errno: 'ECONNREFUSED' }, true],
        [{ cause: { code: 'ENOTFOUND' } }, true],
        [{ cause: { cause: { code: 'ETIMEDOUT' } } }, true],
        [{ cause: { cause: { cause: { code: 'ECONNREFUSED' } } } }, false],
        [{ message: 'ECONNREFUSED' }, false],
        [{ code: 'unknown' }, false],
        [undefined, false],
        [null, false],
    ])('recognizes bounded network codes from %s', (error, expected): void => {
        expect(networkCode(error)).toBe(expected);
    });
});
