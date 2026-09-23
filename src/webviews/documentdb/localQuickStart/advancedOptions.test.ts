/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { QUICK_START_DEFAULT_TAG } from '../../../services/localQuickStart/quickStartTypes';
import { buildAdvancedOptions, getEffectivePort } from './advancedOptions';

const defaults = {
    port: '10261',
    suggestedPort: 10261,
    username: '',
    password: '',
    imageTag: QUICK_START_DEFAULT_TAG,
    loadSampleData: true,
    isRecreate: false,
    useCustomCredentials: false,
    startFresh: false,
};

describe('getEffectivePort', () => {
    it('uses the typed port', () => {
        expect(getEffectivePort(' 12000 ', 10261)).toBe('12000');
    });

    it('falls back to the suggested port while the field is empty', () => {
        expect(getEffectivePort('', 10261)).toBe('10261');
        expect(getEffectivePort('  ', 10261)).toBe('10261');
    });
});

describe('buildAdvancedOptions', () => {
    // The summary showed localhost:<suggested> but nothing was sent, so setup bound 10260, which
    // was the port the suggestion had avoided because it was busy.
    it('sends the suggested port when the port field is empty', () => {
        expect(buildAdvancedOptions({ ...defaults, port: '' })).toEqual({ port: 10261 });
    });

    it('sends the typed port', () => {
        expect(buildAdvancedOptions({ ...defaults, port: '12000' }).port).toBe(12000);
    });

    it('sends custom credentials exactly as typed', () => {
        const options = buildAdvancedOptions({
            ...defaults,
            useCustomCredentials: true,
            username: 'devuser',
            password: 'a b',
        });
        expect(options).toMatchObject({ username: 'devuser', password: 'a b' });
    });

    it('never sends hidden credentials once they are auto-generated again', () => {
        const options = buildAdvancedOptions({ ...defaults, username: 'devuser', password: 'Passw0rd' });
        expect(options.username).toBeUndefined();
        expect(options.password).toBeUndefined();
    });

    it('omits credentials and the image tag when reusing an existing instance', () => {
        const options = buildAdvancedOptions({
            ...defaults,
            isRecreate: true,
            useCustomCredentials: true,
            username: 'devuser',
            password: 'Passw0rd',
            imageTag: '0.116.0',
        });
        expect(options).toEqual({ port: 10261 });
    });

    it('sends only non-default choices', () => {
        expect(
            buildAdvancedOptions({ ...defaults, imageTag: ' 0.116.0 ', loadSampleData: false, startFresh: true }),
        ).toEqual({ port: 10261, imageTag: '0.116.0', loadSampleData: false, startFresh: true });
    });
});
