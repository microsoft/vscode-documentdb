# MongoDB Atlas Service Discovery Authentication

This module implements authentication support for MongoDB Atlas Service Discovery, enabling programmatic access to the Atlas Management API v2.

## Features

- **OAuth 2.0 Authentication** with client credentials flow
- **HTTP Digest Authentication** using Atlas API keys
- **Automatic token caching and renewal** for OAuth
- **Secure credential storage** using VS Code's secret storage
- **Comprehensive error handling** and validation

## Authentication Methods

### OAuth 2.0 (Client Credentials)

Uses client ID and client secret to obtain Bearer tokens for API requests.

```typescript
import { CredentialCache, AtlasHttpClient } from '...';

// Store OAuth credentials
CredentialCache.setAtlasOAuthCredentials(
    'cluster-id',
    'your-client-id', 
    'your-client-secret'
);

// Make authenticated requests (token handled automatically)
const response = await AtlasHttpClient.get('cluster-id', '/groups');
```

**Token Management:**
- Access tokens are valid for 1 hour (3600 seconds)
- Tokens are automatically cached and renewed when expired
- No manual token refresh required

### HTTP Digest Authentication

Uses Atlas API public/private key pair for digest authentication.

```typescript
import { CredentialCache, AtlasHttpClient } from '...';

// Store Digest credentials
CredentialCache.setAtlasDigestCredentials(
    'cluster-id',
    'your-public-key',
    'your-private-key'
);

// Make authenticated requests (digest handled automatically)
const response = await AtlasHttpClient.post('cluster-id', '/groups', {
    name: 'New Project',
    orgId: 'organization-id'
});
```

## API Reference

### CredentialCache

#### Atlas OAuth Methods
- `setAtlasOAuthCredentials(clusterId, clientId, clientSecret)` - Store OAuth credentials
- `updateAtlasOAuthToken(clusterId, accessToken, expiresInSeconds)` - Update token cache
- `isAtlasOAuthTokenValid(clusterId)` - Check token validity

#### Atlas Digest Methods  
- `setAtlasDigestCredentials(clusterId, publicKey, privateKey)` - Store Digest credentials

#### General Atlas Methods
- `getAtlasCredentials(clusterId)` - Retrieve Atlas credentials
- `clearAtlasCredentials(clusterId)` - Clear authentication state

### AtlasAuthManager

#### Authentication Headers
- `getAuthorizationHeader(clusterId)` - Get auth header for requests
- `createAtlasHeaders(clusterId, additionalHeaders?)` - Get complete headers
- `clearAuthentication(clusterId)` - Clear credentials

#### OAuth Utilities
- `getOAuthBasicAuthHeader(clientId, clientSecret)` - Generate Basic auth header
- `requestOAuthToken(clientId, clientSecret)` - Request new access token

### AtlasHttpClient

#### HTTP Methods
- `get(clusterId, endpoint)` - Make authenticated GET request
- `post(clusterId, endpoint, body?)` - Make authenticated POST request

## Security

- **Sensitive credentials** (client_secret, privateKey) are stored using VS Code's secure storage
- **Token caching** prevents unnecessary authentication requests
- **Error handling** ensures credentials are not exposed in logs
- **Automatic cleanup** when credentials are cleared

## Usage Examples

See `AtlasServiceDiscoveryExample.ts` for complete examples including:

- Setting up OAuth and Digest authentication
- Making authenticated API requests
- Token management and validation
- Error handling patterns
- Credential cleanup

## Atlas API Endpoints

Common Atlas Management API v2 endpoints:

- `GET /groups` - List projects/groups
- `POST /groups` - Create new project
- `GET /groups/{groupId}/clusters` - List clusters in project
- `POST /groups/{groupId}/clusters` - Create new cluster

Base URL: `https://cloud.mongodb.com/api/atlas/v2`

## Error Handling

The authentication system provides detailed error messages for:

- Invalid credentials
- Expired tokens
- Network failures
- Unsupported authentication types
- Missing authentication configuration

All errors are localized using VS Code's l10n system.