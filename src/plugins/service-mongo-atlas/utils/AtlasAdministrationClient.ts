/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import {
    type AtlasAccessListEntry,
    type AtlasApiResponse,
    type AtlasCluster,
    type AtlasDatabaseUser,
    type AtlasProject,
    type CreateAccessListEntryParams,
} from '../utils/AtlasAdminApiTypes';
import { AtlasHttpClient } from './AtlasHttpClient';

/**
 * MongoDB Atlas Administration Client for managing Atlas resources
 * Provides methods for projects, clusters, database users, and IP access lists
 */
export class AtlasAdministrationClient {
    /**
     * Lists all projects (groups) accessible to the authenticated user
     *
     * @param orgId - The organization id for the Atlas credential instance
     * @param options - Optional query parameters
     * @returns Promise resolving to list of Atlas projects
     */
    public static async listProjects(
        orgId: string,
        options: {
            pageNum?: number;
            itemsPerPage?: number;
            includeCount?: boolean;
        } = {},
    ): Promise<AtlasApiResponse<AtlasProject>> {
        const queryParams = new URLSearchParams();

        if (options.pageNum !== undefined) {
            queryParams.append('pageNum', options.pageNum.toString());
        }
        if (options.itemsPerPage !== undefined) {
            queryParams.append('itemsPerPage', options.itemsPerPage.toString());
        }
        if (options.includeCount !== undefined) {
            queryParams.append('includeCount', options.includeCount.toString());
        }

        const endpoint = `/groups${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
        const response = await AtlasHttpClient.get(orgId, endpoint);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(l10n.t('Failed to list Atlas projects: {0} {1}', response.status.toString(), errorText));
        }

        return response.json() as Promise<AtlasApiResponse<AtlasProject>>;
    }

    /**
     * Lists all clusters within a specific project
     *
     * @param orgId - The organization id for the Atlas credential instance
     * @param projectId - The Atlas project ID
     * @param options - Optional query parameters
     * @returns Promise resolving to list of Atlas clusters
     */
    public static async listClusters(
        orgId: string,
        projectId: string,
        options: {
            pageNum?: number;
            itemsPerPage?: number;
            includeCount?: boolean;
        } = {},
    ): Promise<AtlasApiResponse<AtlasCluster>> {
        const queryParams = new URLSearchParams();

        if (options.pageNum !== undefined) {
            queryParams.append('pageNum', options.pageNum.toString());
        }
        if (options.itemsPerPage !== undefined) {
            queryParams.append('itemsPerPage', options.itemsPerPage.toString());
        }
        if (options.includeCount !== undefined) {
            queryParams.append('includeCount', options.includeCount.toString());
        }

        const endpoint = `/groups/${projectId}/clusters${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
        const response = await AtlasHttpClient.get(orgId, endpoint);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
                l10n.t(
                    'Failed to list clusters for project {0}: {1} {2}',
                    projectId,
                    response.status.toString(),
                    errorText,
                ),
            );
        }

        return response.json() as Promise<AtlasApiResponse<AtlasCluster>>;
    }

    /**
     * Gets detailed information about a specific cluster, including connection strings
     *
     * @param orgId - The organization id for the Atlas credential instance
     * @param projectId - The Atlas project ID
     * @param clusterName - The name of the cluster
     * @returns Promise resolving to cluster details with connection strings
     */
    public static async getCluster(orgId: string, projectId: string, clusterName: string): Promise<AtlasCluster> {
        const endpoint = `/groups/${projectId}/clusters/${clusterName}`;
        const response = await AtlasHttpClient.get(orgId, endpoint);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
                l10n.t(
                    'Failed to get cluster {0} in project {1}: {2} {3}',
                    clusterName,
                    projectId,
                    response.status.toString(),
                    errorText,
                ),
            );
        }

        return response.json() as Promise<AtlasCluster>;
    }

    /**
     * Lists all database users for a specific project
     *
     * @param orgId - The organization id for the Atlas credential instance
     * @param projectId - The Atlas project ID
     * @param options - Optional query parameters
     * @returns Promise resolving to list of database users
     */
    public static async listDatabaseUsers(
        orgId: string,
        projectId: string,
        options: {
            pageNum?: number;
            itemsPerPage?: number;
            includeCount?: boolean;
        } = {},
    ): Promise<AtlasApiResponse<AtlasDatabaseUser>> {
        const queryParams = new URLSearchParams();

        if (options.pageNum !== undefined) {
            queryParams.append('pageNum', options.pageNum.toString());
        }
        if (options.itemsPerPage !== undefined) {
            queryParams.append('itemsPerPage', options.itemsPerPage.toString());
        }
        if (options.includeCount !== undefined) {
            queryParams.append('includeCount', options.includeCount.toString());
        }

        const endpoint = `/groups/${projectId}/databaseUsers${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
        const response = await AtlasHttpClient.get(orgId, endpoint);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
                l10n.t(
                    'Failed to list database users for project {0}: {1} {2}',
                    projectId,
                    response.status.toString(),
                    errorText,
                ),
            );
        }

        return response.json() as Promise<AtlasApiResponse<AtlasDatabaseUser>>;
    }

    /**
     * Gets the IP access list (firewall entries) for a specific project
     *
     * @param orgId - The organization id for the Atlas credential instance
     * @param projectId - The Atlas project ID
     * @param options - Optional query parameters
     * @returns Promise resolving to list of access list entries
     */
    public static async getAccessList(
        orgId: string,
        projectId: string,
        options: {
            pageNum?: number;
            itemsPerPage?: number;
            includeCount?: boolean;
        } = {},
    ): Promise<AtlasApiResponse<AtlasAccessListEntry>> {
        const queryParams = new URLSearchParams();

        if (options.pageNum !== undefined) {
            queryParams.append('pageNum', options.pageNum.toString());
        }
        if (options.itemsPerPage !== undefined) {
            queryParams.append('itemsPerPage', options.itemsPerPage.toString());
        }
        if (options.includeCount !== undefined) {
            queryParams.append('includeCount', options.includeCount.toString());
        }

        const endpoint = `/groups/${projectId}/accessList${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
        const response = await AtlasHttpClient.get(orgId, endpoint);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
                l10n.t(
                    'Failed to get access list for project {0}: {1} {2}',
                    projectId,
                    response.status.toString(),
                    errorText,
                ),
            );
        }

        return response.json() as Promise<AtlasApiResponse<AtlasAccessListEntry>>;
    }

    /**
     * Creates one or more IP access list entries for a project
     *
     * @param orgId - The organization id for the Atlas credential instance
     * @param projectId - The Atlas project ID
     * @param entries - Array of access list entries to create
     * @returns Promise resolving to created access list entries
     */
    public static async createAccessListEntries(
        orgId: string,
        projectId: string,
        entries: CreateAccessListEntryParams[],
    ): Promise<AtlasApiResponse<AtlasAccessListEntry>> {
        const endpoint = `/groups/${projectId}/accessList`;
        const response = await AtlasHttpClient.post(orgId, endpoint, entries);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
                l10n.t(
                    'Failed to create access list entries for project {0}: {1} {2}',
                    projectId,
                    response.status.toString(),
                    errorText,
                ),
            );
        }

        return response.json() as Promise<AtlasApiResponse<AtlasAccessListEntry>>;
    }

    /**
     * Deletes a specific IP access list entry from a project
     *
     * @param orgId - The organization id for the Atlas credential instance
     * @param projectId - The Atlas project ID
     * @param entryId - The ID of the access list entry to delete (IP address or CIDR block)
     * @returns Promise resolving when deletion is complete
     */
    public static async deleteAccessListEntry(orgId: string, projectId: string, entryId: string): Promise<void> {
        // URL encode the entry ID to handle IP addresses and CIDR blocks properly
        const encodedEntryId = encodeURIComponent(entryId);
        const endpoint = `/groups/${projectId}/accessList/${encodedEntryId}`;

        try {
            const response = await AtlasHttpClient.delete(orgId, endpoint);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(
                    l10n.t(
                        'Failed to delete access list entry {0} from project {1}: {2} {3}',
                        entryId,
                        projectId,
                        response.status.toString(),
                        errorText,
                    ),
                );
            }
        } catch (error) {
            // Re-throw known errors or wrap unknown ones
            if (error instanceof Error) {
                throw error;
            }
            throw new Error(
                l10n.t(
                    'Failed to delete access list entry {0} from project {1}: {2}',
                    entryId,
                    projectId,
                    String(error),
                ),
            );
        }
    }
}
