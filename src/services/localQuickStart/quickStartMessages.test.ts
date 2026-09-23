/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { formatQuickStartMessage } from './quickStartMessages';
import { type QuickStartMessageKey } from './quickStartTypes';

/**
 * The service reports situations; this module owns the words. A key that renders blank, or that
 * renders only untranslated driver text, is the failure mode worth guarding — the reader is left
 * with either nothing or an English fragment with no sentence around it.
 */
describe('formatQuickStartMessage', () => {
    /** Guards the union itself: a new key with no copy behind it fails here rather than in the UI. */
    const allKeys: QuickStartMessageKey[] = [
        'setupAlreadyInProgress',
        'setupCancelled',
        'credentialsUnavailable',
        'portInUse',
        'dockerCliMissing',
        'dockerDaemonUnreachable',
        'dockerUnavailableDuringSetup',
        'imageNotFound',
        'createTimedOut',
        'containerExited',
        'credentialsRejected',
        'savedCredentialsRejected',
        'passwordNotSupported',
        'readinessTimeout',
        'instanceRunning',
        'nothingToResume',
        'stillInitializing',
        'startedButExited',
        'restartedButExited',
        'unexpectedFailure',
    ];

    it.each(allKeys)('renders %s as a non-empty sentence', (key) => {
        expect(formatQuickStartMessage({ key }).trim()).not.toBe('');
    });

    it('keeps a localized sentence around raw driver text', () => {
        const rendered = formatQuickStartMessage({ key: 'unexpectedFailure', detail: 'manifest unknown' });

        expect(rendered).toContain('manifest unknown');
        // `detail` is evidence, not copy: on its own it leaves a non-English reader with nothing.
        expect(rendered).not.toBe('manifest unknown');
    });

    // `detail?.trim()` used to leave an empty string, which `??` happily returned as the message.
    it.each(['', '   ', '\n\t'])('never renders blank for whitespace-only detail (%j)', (detail) => {
        expect(formatQuickStartMessage({ key: 'unexpectedFailure', detail }).trim()).not.toBe('');
        expect(formatQuickStartMessage({ key: 'dockerUnavailableDuringSetup', detail }).trim()).not.toBe('');
    });

    it('explains the published-port routing only inside a dev container', () => {
        expect(formatQuickStartMessage({ key: 'readinessTimeout', environment: 'devContainer' })).toContain(
            'published localhost port might not be reachable from inside the dev container',
        );
        expect(formatQuickStartMessage({ key: 'readinessTimeout', environment: 'linux' })).toBe(
            'DocumentDB did not accept connections in time. It may still be initializing.',
        );
    });

    it('names the port it is talking about', () => {
        expect(formatQuickStartMessage({ key: 'portInUse', port: 10333 })).toContain('10333');
        expect(formatQuickStartMessage({ key: 'instanceRunning', port: 10333 })).toContain('10333');
    });

    it('names the image that could not be found', () => {
        expect(formatQuickStartMessage({ key: 'imageNotFound', image: 'repo/local:0.117.0-nope' })).toContain(
            'repo/local:0.117.0-nope',
        );
    });

    it('gives the exit code and the container own explanation when it stops during setup', () => {
        expect(
            formatQuickStartMessage({
                key: 'containerExited',
                exitCode: 1,
                detail: "username 'documentdb' uses reserved prefix 'documentdb'.",
            }),
        ).toBe(
            "The DocumentDB container stopped before it was ready (exit code 1): username 'documentdb' uses reserved prefix 'documentdb'.",
        );
        expect(formatQuickStartMessage({ key: 'containerExited', exitCode: 137 })).toBe(
            'The DocumentDB container stopped before it was ready (exit code 137). View the setup log for details.',
        );
    });

    it('does not double the full stop after a server message that ends with one', () => {
        expect(formatQuickStartMessage({ key: 'credentialsRejected', detail: 'Authentication failed.' })).toBe(
            'DocumentDB did not accept the username or password: Authentication failed. Go back to Configure to change them.',
        );
    });
});
