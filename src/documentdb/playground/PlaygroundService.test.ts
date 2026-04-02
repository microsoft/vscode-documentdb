/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PlaygroundService } from './PlaygroundService';
import { type PlaygroundConnection } from './types';

// Access the vscode mock (auto-mock from __mocks__/vscode.js)
import * as vscode from 'vscode';

describe('PlaygroundService', () => {
    let service: PlaygroundService;

    beforeEach(() => {
        // Reset singleton between tests
        service = PlaygroundService.getInstance();
    });

    afterEach(() => {
        service.dispose();
    });

    describe('singleton', () => {
        it('returns the same instance on repeated calls', () => {
            const second = PlaygroundService.getInstance();
            expect(second).toBe(service);
        });

        it('creates a new instance after dispose', () => {
            service.dispose();
            const fresh = PlaygroundService.getInstance();
            expect(fresh).not.toBe(service);
            service = fresh; // reassign for afterEach cleanup
        });
    });

    describe('connection management', () => {
        const connection: PlaygroundConnection = {
            clusterId: 'cluster-123',
            clusterDisplayName: 'MyCluster',
            databaseName: 'orders',
        };

        it('starts disconnected', () => {
            expect(service.isConnected()).toBe(false);
            expect(service.getConnection()).toBeUndefined();
            expect(service.getDisplayName()).toBeUndefined();
        });

        it('setConnection stores the connection', () => {
            service.setConnection(connection);
            expect(service.isConnected()).toBe(true);
            expect(service.getConnection()).toBe(connection);
        });

        it('getDisplayName returns formatted string', () => {
            service.setConnection(connection);
            expect(service.getDisplayName()).toBe('MyCluster / orders');
        });

        it('clearConnection resets to disconnected', () => {
            service.setConnection(connection);
            service.clearConnection();
            expect(service.isConnected()).toBe(false);
            expect(service.getConnection()).toBeUndefined();
        });

        it('fires onDidChangeState on setConnection', () => {
            const listener = jest.fn();
            service.onDidChangeState(listener);
            service.setConnection(connection);
            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('fires onDidChangeState on clearConnection', () => {
            service.setConnection(connection);
            const listener = jest.fn();
            service.onDidChangeState(listener);
            service.clearConnection();
            expect(listener).toHaveBeenCalledTimes(1);
        });
    });

    describe('execution state', () => {
        it('starts not executing', () => {
            expect(service.isExecuting).toBe(false);
        });

        it('setExecuting updates state and fires event', () => {
            const listener = jest.fn();
            service.onDidChangeState(listener);
            service.setExecuting(true);
            expect(service.isExecuting).toBe(true);
            expect(listener).toHaveBeenCalledTimes(1);
        });
    });

    describe('StatusBarItem', () => {
        it('creates a StatusBarItem with the connect command', () => {
            // The StatusBarItem is created in the constructor; verify it was configured
            expect(vscode.window.createStatusBarItem).toHaveBeenCalledWith(vscode.StatusBarAlignment.Left, 100);
        });
    });
});
