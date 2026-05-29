/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * **Internal developer tool — not shipped to end users.**
 *
 * A standalone sandbox webview wired to its own command
 * (`vscode-documentdb.command.testing.openMotionSandbox`) so we can
 * experiment with Fluent UI motion components in isolation, without any
 * business logic, tRPC procedures, or live data dependencies.
 *
 * The router context is the minimum the framework requires
 * (`dbExperience` + `webviewName`); the panel doesn't issue any tRPC
 * calls.
 */

import * as vscode from 'vscode';
import { API } from '../../../DocumentDBExperiences';
import { ext } from '../../../extensionVariables';
import { WebviewControllerBase } from '../../_integration/WebviewControllerBase';
import { type BaseRouterContext } from '../../_integration/appRouter';

export type MotionSandboxWebviewConfigurationType = Record<string, never>;

export class MotionSandboxController extends WebviewControllerBase<MotionSandboxWebviewConfigurationType> {
    constructor() {
        super(
            ext.context,
            'Motion Sandbox (dev)',
            'motionSandbox',
            {} as MotionSandboxWebviewConfigurationType,
            vscode.ViewColumn.Active,
        );

        const trpcContext: BaseRouterContext = {
            dbExperience: API.DocumentDB,
            webviewName: 'motionSandbox',
        };
        this.setupTrpc(trpcContext);
    }
}
