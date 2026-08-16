/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Harness surface: a typed, host-free way to drive a webview.
 *
 * Re-exported through the package's `./testing` subpath.
 */

export {
    createFakeTransport,
    type FakeTransport,
    type FakeTransportOptions,
    type FixtureError,
    type ProcedureFixture,
    type ProcedureOutput,
    type ProcedurePath,
    type RecordedCall,
    type Scenario,
} from './fakeTransport';
