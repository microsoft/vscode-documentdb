/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Example demonstrating MongoDB Atlas authentication for service discovery.
 * This file shows how to use the Atlas authentication system for both OAuth 2.0 
 * and HTTP Digest authentication methods.
 */

import { CredentialCache } from '../../../documentdb/CredentialCache';
import { AtlasAuthManager } from './AtlasAuthManager';
import { AtlasHttpClient } from './AtlasHttpClient';

export class AtlasServiceDiscoveryExample {
    /**
     * Example: Setting up OAuth 2.0 authentication for Atlas
     */
    public static async setupOAuthCredentials(
        clusterId: string,
        clientId: string,
        clientSecret: string,
    ): Promise<void> {
        // Store OAuth credentials securely
        CredentialCache.setAtlasOAuthCredentials(clusterId, clientId, clientSecret);
        
        console.log(`OAuth credentials stored for cluster: ${clusterId}`);
    }

    /**
     * Example: Setting up HTTP Digest authentication for Atlas
     */
    public static async setupDigestCredentials(
        clusterId: string,
        publicKey: string,
        privateKey: string,
    ): Promise<void> {
        // Store Digest credentials securely
        CredentialCache.setAtlasDigestCredentials(clusterId, publicKey, privateKey);
        
        console.log(`Digest credentials stored for cluster: ${clusterId}`);
    }

    /**
     * Example: Making authenticated requests to Atlas API
     */
    public static async discoverAtlasProjects(clusterId: string): Promise<void> {
        try {
            // Make authenticated GET request to list projects/groups
            const response = await AtlasHttpClient.get(clusterId, '/groups');
            
            if (response.ok) {
                const projects = await response.json() as { results?: unknown[] };
                console.log('Atlas projects discovered:', projects);
            } else {
                console.error('Failed to fetch Atlas projects:', response.statusText);
            }
        } catch (error) {
            console.error('Error discovering Atlas projects:', error);
        }
    }

    /**
     * Example: Creating a new Atlas project with POST request
     */
    public static async createAtlasProject(
        clusterId: string,
        projectName: string,
        organizationId: string,
    ): Promise<void> {
        try {
            const projectData = {
                name: projectName,
                orgId: organizationId,
            };

            // Make authenticated POST request to create project
            const response = await AtlasHttpClient.post(clusterId, '/groups', projectData);
            
            if (response.ok) {
                const newProject = await response.json() as { id?: string; name?: string };
                console.log('Atlas project created:', newProject);
            } else {
                console.error('Failed to create Atlas project:', response.statusText);
            }
        } catch (error) {
            console.error('Error creating Atlas project:', error);
        }
    }

    /**
     * Example: Getting authentication headers for custom requests
     */
    public static async getAuthHeadersExample(clusterId: string): Promise<void> {
        try {
            // Get authentication headers for manual requests
            const headers = await AtlasAuthManager.createAtlasHeaders(clusterId);
            
            console.log('Authentication headers ready:', Object.keys(headers));
            
            // You can now use these headers with any HTTP client
            // const customResponse = await fetch('https://cloud.mongodb.com/api/atlas/v2/groups', {
            //     method: 'GET',
            //     headers: headers
            // });
        } catch (error) {
            console.error('Error getting auth headers:', error);
        }
    }

    /**
     * Example: Token management for OAuth
     */
    public static async demonstrateTokenManagement(clusterId: string): Promise<void> {
        // Check if we have valid OAuth credentials
        const credentials = CredentialCache.getAtlasCredentials(clusterId);
        if (credentials?.authType === 'oauth') {
            console.log('OAuth credentials found');
            
            // Check token validity
            const isTokenValid = CredentialCache.isAtlasOAuthTokenValid(clusterId);
            console.log('Token is valid:', isTokenValid);
            
            if (!isTokenValid) {
                console.log('Token will be automatically refreshed on next request');
            }
        }
    }

    /**
     * Example: Clearing authentication state
     */
    public static clearAuthentication(clusterId: string): void {
        AtlasAuthManager.clearAuthentication(clusterId);
        console.log(`Authentication cleared for cluster: ${clusterId}`);
    }

    /**
     * Complete example workflow
     */
    public static async runCompleteExample(): Promise<void> {
        const clusterId = 'example-atlas-cluster';
        
        try {
            // Setup OAuth authentication
            await this.setupOAuthCredentials(
                clusterId,
                'your-client-id',
                'your-client-secret'
            );
            
            // Discover projects
            await this.discoverAtlasProjects(clusterId);
            
            // Demonstrate token management
            await this.demonstrateTokenManagement(clusterId);
            
            // Get headers for custom requests
            await this.getAuthHeadersExample(clusterId);
            
            // Clean up
            this.clearAuthentication(clusterId);
            
        } catch (error) {
            console.error('Example workflow failed:', error);
        }
    }
}