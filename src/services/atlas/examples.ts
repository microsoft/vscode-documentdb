/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Example usage of the Atlas Authentication Service
 * 
 * This file demonstrates how to use the AtlasAuthService for MongoDB Atlas API authentication.
 * It's not part of the main codebase but serves as documentation for developers.
 */

import type * as vscode from 'vscode';
import { AtlasAuthService, AtlasAuthType, type AtlasCredentials } from './index';

/**
 * Example: Setting up OAuth 2.0 authentication
 */
async function setupOAuth2Authentication(context: vscode.ExtensionContext): Promise<void> {
    const authService = new AtlasAuthService(context);

    // OAuth 2.0 credentials
    const credentials: AtlasCredentials = {
        type: AtlasAuthType.OAuth2,
        clientId: 'your-atlas-client-id',
        clientSecret: 'your-atlas-client-secret',
    };

    try {
        // Store and authenticate with credentials
        const result = await authService.setCredentials(credentials);
        
        if (result.success) {
            console.log('Authentication successful!');
            
            // Get auth header for API requests
            const authResult = await authService.getAuthHeader();
            if (authResult.success && authResult.authHeader) {
                console.log('Auth header:', authResult.authHeader);
                // Use authResult.authHeader.Authorization in your HTTP requests
            }
        } else {
            console.error('Authentication failed:', result.error);
        }
    } catch (error) {
        console.error('Error setting up authentication:', error);
    }
}

/**
 * Example: Setting up HTTP Digest authentication
 */
async function setupDigestAuthentication(context: vscode.ExtensionContext): Promise<void> {
    const authService = new AtlasAuthService(context);

    // Digest authentication credentials
    const credentials: AtlasCredentials = {
        type: AtlasAuthType.DigestAuth,
        publicKey: 'your-atlas-public-key',
        privateKey: 'your-atlas-private-key',
    };

    try {
        // Store and authenticate with credentials
        const result = await authService.setCredentials(credentials);
        
        if (result.success) {
            console.log('Digest authentication successful!');
            
            // Get authenticated fetch function for API requests
            const authenticatedFetch = await authService.getAuthenticatedFetch();
            
            // Use the authenticated fetch for API calls
            const response = await authenticatedFetch('https://cloud.mongodb.com/api/atlas/v2/groups');
            const data = await response.json() as unknown;
            console.log('Projects:', data);
        } else {
            console.error('Authentication failed:', result.error);
        }
    } catch (error) {
        console.error('Error setting up authentication:', error);
    }
}

/**
 * Example: Using the HTTP client for Atlas API requests
 */
async function makeAtlasApiRequest(context: vscode.ExtensionContext): Promise<void> {
    const authService = new AtlasAuthService(context);
    
    try {
        // Load stored credentials (if any)
        const loadResult = await authService.loadStoredCredentials();
        
        if (!loadResult || !loadResult.success) {
            console.log('No stored credentials found or authentication failed');
            return;
        }

        // Get HTTP client
        const httpClient = authService.getHttpClient();
        
        // Get auth header
        const authResult = await authService.getAuthHeader();
        if (!authResult.success || !authResult.authHeader) {
            console.error('Failed to get auth header:', authResult.error);
            return;
        }

        // Make authenticated request to Atlas API
        const url = httpClient.buildApiUrl('/groups');
        const response = await httpClient.makeAuthenticatedRequest(
            url,
            { method: 'GET' },
            authResult.authHeader
        );

        if (response.ok) {
            const data = await httpClient.handleApiResponse(response);
            console.log('Atlas projects:', data);
        } else {
            console.error('API request failed:', response.status, response.statusText);
        }
    } catch (error) {
        console.error('Error making Atlas API request:', error);
    }
}

/**
 * Example: Credential lifecycle management
 */
async function manageCredentials(context: vscode.ExtensionContext): Promise<void> {
    const authService = new AtlasAuthService(context);

    try {
        // Check if credentials exist
        const hasCredentials = await authService.hasCredentials();
        console.log('Has stored credentials:', hasCredentials);

        if (hasCredentials) {
            // Get auth type
            const authType = await authService.getStoredAuthType();
            console.log('Stored auth type:', authType);

            // Validate stored credentials
            const validation = await authService.validateCredentials();
            console.log('Credentials valid:', validation.isValid);
            
            if (!validation.isValid) {
                console.log('Validation error:', validation.error);
                
                // Clear invalid credentials
                await authService.clearCredentials();
                console.log('Cleared invalid credentials');
            }
        }

        // Update credentials example
        const newCredentials: AtlasCredentials = {
            type: AtlasAuthType.OAuth2,
            clientId: 'new-client-id',
            clientSecret: 'new-client-secret',
        };

        const updateResult = await authService.updateCredentials(newCredentials);
        if (updateResult.success) {
            console.log('Credentials updated successfully');
        } else {
            console.error('Failed to update credentials:', updateResult.error);
        }
    } catch (error) {
        console.error('Error managing credentials:', error);
    }

    // Always dispose the service when done
    authService.dispose();
}

// Export example functions for documentation purposes
export {
    setupOAuth2Authentication,
    setupDigestAuthentication,
    makeAtlasApiRequest,
    manageCredentials,
};