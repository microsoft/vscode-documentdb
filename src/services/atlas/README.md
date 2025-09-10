# MongoDB Atlas Authentication Service

This module provides a comprehensive authentication mechanism for the MongoDB Atlas Management API, supporting both **OAuth 2.0 Client Credentials** and **HTTP Digest Authentication**.

## Features

- ✅ **Secure credential storage** using VS Code's SecretStorage API
- ✅ **OAuth 2.0 Client Credentials flow** with automatic token management
- ✅ **HTTP Digest Authentication** using proven libraries
- ✅ **Automatic token refresh** for OAuth 2.0
- ✅ **Credential lifecycle management** (store, update, clear)
- ✅ **Simple integration hooks** with `getAuthHeader()` method
- ✅ **Comprehensive error handling** and validation
- ✅ **TypeScript support** with strict type safety

## Usage

### Basic Setup

```typescript
import { AtlasAuthService, AtlasAuthType } from './services/atlas';
import * as vscode from 'vscode';

// Initialize the service
const authService = new AtlasAuthService(context);
```

### OAuth 2.0 Authentication

```typescript
// Set up OAuth 2.0 credentials
const credentials = {
    type: AtlasAuthType.OAuth2,
    clientId: 'your-atlas-client-id',
    clientSecret: 'your-atlas-client-secret',
};

// Store and authenticate
const result = await authService.setCredentials(credentials);
if (result.success) {
    // Get auth header for API requests
    const authResult = await authService.getAuthHeader();
    if (authResult.authHeader) {
        // Use authResult.authHeader.Authorization in HTTP requests
        console.log('Bearer token:', authResult.authHeader.Authorization);
    }
}
```

### HTTP Digest Authentication

```typescript
// Set up Digest authentication credentials
const credentials = {
    type: AtlasAuthType.DigestAuth,
    publicKey: 'your-atlas-public-key',
    privateKey: 'your-atlas-private-key',
};

// Store and authenticate
const result = await authService.setCredentials(credentials);
if (result.success) {
    // Get authenticated fetch function
    const authenticatedFetch = await authService.getAuthenticatedFetch();
    
    // Use for API requests
    const response = await authenticatedFetch('https://cloud.mongodb.com/api/atlas/v2/groups');
    const data = await response.json();
}
```

### Making Atlas API Requests

```typescript
// Using the HTTP client utility
const httpClient = authService.getHttpClient();
const authResult = await authService.getAuthHeader();

if (authResult.success && authResult.authHeader) {
    const url = httpClient.buildApiUrl('/groups');
    const response = await httpClient.makeAuthenticatedRequest(
        url,
        { method: 'GET' },
        authResult.authHeader
    );
    
    const data = await httpClient.handleApiResponse(response);
    console.log('Atlas projects:', data);
}
```

### Credential Management

```typescript
// Check if credentials exist
const hasCredentials = await authService.hasCredentials();

// Get auth type
const authType = await authService.getStoredAuthType();

// Validate credentials
const validation = await authService.validateCredentials();
if (!validation.isValid) {
    console.log('Credentials invalid:', validation.error);
}

// Update credentials
const newCredentials = { /* ... */ };
await authService.updateCredentials(newCredentials);

// Clear credentials
await authService.clearCredentials();

// Always dispose when done
authService.dispose();
```

## API Reference

### AtlasAuthService

Main service class for Atlas authentication.

#### Methods

- `setCredentials(credentials: AtlasCredentials): Promise<AtlasAuthResult>`
- `loadStoredCredentials(): Promise<AtlasAuthResult | null>`
- `getAuthHeader(): Promise<AtlasAuthResult>`
- `getAuthenticatedFetch(): Promise<typeof fetch>`
- `validateCredentials(): Promise<CredentialValidationResult>`
- `updateCredentials(credentials: AtlasCredentials): Promise<AtlasAuthResult>`
- `clearCredentials(): Promise<void>`
- `hasCredentials(): Promise<boolean>`
- `getStoredAuthType(): Promise<AtlasAuthType | undefined>`
- `getHttpClient(): AtlasHttpClient`
- `dispose(): void`

### Types

#### AtlasCredentials

```typescript
// OAuth 2.0 Credentials
type AtlasOAuth2Credentials = {
    type: AtlasAuthType.OAuth2;
    clientId: string;
    clientSecret: string;
};

// Digest Authentication Credentials
type AtlasDigestCredentials = {
    type: AtlasAuthType.DigestAuth;
    publicKey: string;
    privateKey: string;
};

type AtlasCredentials = AtlasOAuth2Credentials | AtlasDigestCredentials;
```

#### AtlasAuthResult

```typescript
interface AtlasAuthResult {
    success: boolean;
    authHeader?: AtlasAuthHeader;
    error?: string;
    requiresReauthentication?: boolean;
}
```

### Configuration

```typescript
interface AtlasAuthConfig {
    apiBaseUrl?: string; // Default: 'https://cloud.mongodb.com/api/atlas/v2'
    tokenEndpoint?: string; // For OAuth 2.0
    timeoutMs?: number; // Default: 30000
    autoRefreshToken?: boolean; // Default: true
    refreshThresholdSeconds?: number; // Default: 300
}

// Use custom configuration
const authService = new AtlasAuthService(context, {
    timeoutMs: 60000,
    refreshThresholdSeconds: 600,
});
```

## Security

- **Credentials are stored securely** using VS Code's SecretStorage API
- **Tokens are cached in memory** only for the duration of the session
- **Sensitive data is cleared** on service disposal
- **No credentials are logged** or exposed in error messages

## Error Handling

The service provides comprehensive error handling:

```typescript
const result = await authService.setCredentials(credentials);
if (!result.success) {
    console.error('Authentication failed:', result.error);
    if (result.requiresReauthentication) {
        // Credentials need to be updated
    }
}
```

## MongoDB Atlas API References

- [Configure API Access](https://www.mongodb.com/docs/atlas/configure-api-access/)
- [Atlas Administration API](https://www.mongodb.com/docs/atlas/reference/api/)
- [Authentication Methods](https://www.mongodb.com/docs/atlas/configure-api-access/#authentication-methods)

## Dependencies

- `digest-fetch`: HTTP Digest authentication library
- `@vscode/l10n`: VS Code localization
- `vscode`: VS Code extension API

## License

This code is part of the Microsoft DocumentDB for VS Code extension and is licensed under the MIT License.