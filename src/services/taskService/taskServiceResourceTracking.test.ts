/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from '@jest/globals';
import { type ResourceDefinition, hasResourceConflict } from './taskServiceResourceTracking';

describe('ResourceTracking', () => {
    describe('hasResourceConflict', () => {
        describe('connection level conflicts', () => {
            it('should detect conflict when deleting connection and task uses same connection', () => {
                const deleteRequest: ResourceDefinition = {
                    clusterId: 'conn1',
                };

                const usedResource: ResourceDefinition = {
                    clusterId: 'conn1',
                    databaseName: 'db1',
                    collectionName: 'coll1',
                };

                expect(hasResourceConflict(deleteRequest, usedResource)).toBe(true);
            });

            it('should not detect conflict when deleting different connection', () => {
                const deleteRequest: ResourceDefinition = {
                    clusterId: 'conn1',
                };

                const usedResource: ResourceDefinition = {
                    clusterId: 'conn2',
                    databaseName: 'db1',
                    collectionName: 'coll1',
                };

                expect(hasResourceConflict(deleteRequest, usedResource)).toBe(false);
            });

            it('should not detect conflict when no connection specified in request', () => {
                const deleteRequest: ResourceDefinition = {};

                const usedResource: ResourceDefinition = {
                    clusterId: 'conn1',
                    databaseName: 'db1',
                };

                expect(hasResourceConflict(deleteRequest, usedResource)).toBe(false);
            });
        });

        describe('database level conflicts', () => {
            it('should detect conflict when deleting database and task uses same database', () => {
                const deleteRequest: ResourceDefinition = {
                    clusterId: 'conn1',
                    databaseName: 'db1',
                };

                const usedResource: ResourceDefinition = {
                    clusterId: 'conn1',
                    databaseName: 'db1',
                    collectionName: 'coll1',
                };

                expect(hasResourceConflict(deleteRequest, usedResource)).toBe(true);
            });

            it('should not detect conflict when deleting different database in same connection', () => {
                const deleteRequest: ResourceDefinition = {
                    clusterId: 'conn1',
                    databaseName: 'db1',
                };

                const usedResource: ResourceDefinition = {
                    clusterId: 'conn1',
                    databaseName: 'db2',
                    collectionName: 'coll1',
                };

                expect(hasResourceConflict(deleteRequest, usedResource)).toBe(false);
            });

            it('should not detect conflict when used resource has no database', () => {
                const deleteRequest: ResourceDefinition = {
                    clusterId: 'conn1',
                    databaseName: 'db1',
                };

                const usedResource: ResourceDefinition = {
                    clusterId: 'conn1',
                };

                expect(hasResourceConflict(deleteRequest, usedResource)).toBe(false);
            });
        });

        describe('collection level conflicts', () => {
            it('should detect conflict when deleting collection and task uses same collection', () => {
                const deleteRequest: ResourceDefinition = {
                    clusterId: 'conn1',
                    databaseName: 'db1',
                    collectionName: 'coll1',
                };

                const usedResource: ResourceDefinition = {
                    clusterId: 'conn1',
                    databaseName: 'db1',
                    collectionName: 'coll1',
                };

                expect(hasResourceConflict(deleteRequest, usedResource)).toBe(true);
            });

            it('should not detect conflict when deleting different collection in same database', () => {
                const deleteRequest: ResourceDefinition = {
                    clusterId: 'conn1',
                    databaseName: 'db1',
                    collectionName: 'coll1',
                };

                const usedResource: ResourceDefinition = {
                    clusterId: 'conn1',
                    databaseName: 'db1',
                    collectionName: 'coll2',
                };

                expect(hasResourceConflict(deleteRequest, usedResource)).toBe(false);
            });

            it('should not detect conflict when used resource has no collection', () => {
                const deleteRequest: ResourceDefinition = {
                    clusterId: 'conn1',
                    databaseName: 'db1',
                    collectionName: 'coll1',
                };

                const usedResource: ResourceDefinition = {
                    clusterId: 'conn1',
                    databaseName: 'db1',
                };

                expect(hasResourceConflict(deleteRequest, usedResource)).toBe(false);
            });
        });

        describe('hierarchical precedence', () => {
            it('should prioritize connection conflict over database specificity', () => {
                const deleteRequest: ResourceDefinition = {
                    clusterId: 'conn1',
                };

                const usedResource: ResourceDefinition = {
                    clusterId: 'conn1',
                    databaseName: 'db1',
                    collectionName: 'coll1',
                };

                expect(hasResourceConflict(deleteRequest, usedResource)).toBe(true);
            });

            it('should prioritize database conflict over collection specificity', () => {
                const deleteRequest: ResourceDefinition = {
                    clusterId: 'conn1',
                    databaseName: 'db1',
                };

                const usedResource: ResourceDefinition = {
                    clusterId: 'conn1',
                    databaseName: 'db1',
                    collectionName: 'coll1',
                };

                expect(hasResourceConflict(deleteRequest, usedResource)).toBe(true);
            });
        });

        describe('edge cases', () => {
            it('should handle empty resources gracefully', () => {
                const deleteRequest: ResourceDefinition = {};
                const usedResource: ResourceDefinition = {};

                expect(hasResourceConflict(deleteRequest, usedResource)).toBe(false);
            });

            it('should handle partial resource specifications', () => {
                const deleteRequest: ResourceDefinition = {
                    clusterId: 'conn1',
                    collectionName: 'coll1', // missing database
                };

                const usedResource: ResourceDefinition = {
                    clusterId: 'conn1',
                    databaseName: 'db1',
                    collectionName: 'coll1',
                };

                // Without database specified in request, it should be treated as database deletion
                expect(hasResourceConflict(deleteRequest, usedResource)).toBe(true);
            });
        });
    });
});
