/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TreeElement } from '../TreeElement';
import { isClusterTreeElement } from './clusterItemTypeGuard';

describe('clusterItemTypeGuard', () => {
    describe('isClusterTreeElement', () => {
        it('should return true for element with valid cluster object and cluster contextValue', () => {
            const element = {
                id: 'test-id',
                getTreeItem: jest.fn(),
                contextValue: 'treeItem_documentdbcluster;experience_MongoDB',
                cluster: {
                    clusterId: 'test-cluster-id',
                    name: 'Test Cluster',
                },
            } as unknown as TreeElement;

            expect(isClusterTreeElement(element)).toBe(true);
        });

        it('should return false for element with cluster but non-cluster contextValue (database item)', () => {
            const element = {
                id: 'test-id',
                getTreeItem: jest.fn(),
                contextValue: 'treeItem_database;experience_MongoDB',
                cluster: {
                    clusterId: 'test-cluster-id',
                    name: 'Test Cluster',
                },
            } as unknown as TreeElement;

            expect(isClusterTreeElement(element)).toBe(false);
        });

        it('should return false for element with cluster but collection contextValue', () => {
            const element = {
                id: 'test-id',
                getTreeItem: jest.fn(),
                contextValue: 'treeItem_collection;experience_MongoDB',
                cluster: {
                    clusterId: 'test-cluster-id',
                    name: 'Test Cluster',
                },
            } as unknown as TreeElement;

            expect(isClusterTreeElement(element)).toBe(false);
        });

        it('should return false for element without cluster property', () => {
            const element = {
                id: 'test-id',
                getTreeItem: jest.fn(),
                contextValue: 'treeItem_documentdbcluster',
            } as TreeElement;

            expect(isClusterTreeElement(element)).toBe(false);
        });

        it('should return false for element with null cluster', () => {
            const element = {
                id: 'test-id',
                getTreeItem: jest.fn(),
                contextValue: 'treeItem_documentdbcluster',
                cluster: null,
            } as unknown as TreeElement;

            expect(isClusterTreeElement(element)).toBe(false);
        });

        it('should return false for element with cluster missing clusterId', () => {
            const element = {
                id: 'test-id',
                getTreeItem: jest.fn(),
                contextValue: 'treeItem_documentdbcluster',
                cluster: { name: 'Test Cluster' },
            } as unknown as TreeElement;

            expect(isClusterTreeElement(element)).toBe(false);
        });

        it('should return false for element with non-string clusterId', () => {
            const element = {
                id: 'test-id',
                getTreeItem: jest.fn(),
                contextValue: 'treeItem_documentdbcluster',
                cluster: { clusterId: 123, name: 'Test Cluster' },
            } as unknown as TreeElement;

            expect(isClusterTreeElement(element)).toBe(false);
        });

        it('should return false for element without contextValue', () => {
            const element = {
                id: 'test-id',
                getTreeItem: jest.fn(),
                cluster: {
                    clusterId: 'test-cluster-id',
                    name: 'Test Cluster',
                },
            } as unknown as TreeElement;

            expect(isClusterTreeElement(element)).toBe(false);
        });

        it('should handle case-insensitive contextValue matching', () => {
            const element = {
                id: 'test-id',
                getTreeItem: jest.fn(),
                contextValue: 'TREEITEM_DOCUMENTDBCLUSTER;EXPERIENCE_MONGODB',
                cluster: {
                    clusterId: 'test-cluster-id',
                    name: 'Test Cluster',
                },
            } as unknown as TreeElement;

            expect(isClusterTreeElement(element)).toBe(true);
        });
    });
});
