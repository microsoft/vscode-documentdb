# MongoDB Atlas Authentication Layer

This module provides a pluggable authentication system for MongoDB Atlas Management API v2, supporting both OAuth 2.0 Client Credentials Flow and legacy HTTP Digest Authentication.

## Features

- **OAuth 2.0 Client Credentials Flow** (preferred)
  - Automatic token retrieval and caching
  - Token refresh before expiry
  - Comprehensive error handling
  
- **HTTP Digest Authentication** (legacy fallback)
  - Atlas API key support (public/private key pairs)
  - RFC 7616 compliant digest authentication
  - Secure credential validation

- **Secure Credential Storage**
  - Integration with VS Code's secret storage API
  - No credentials logged or exposed
  - Credential lifecycle management

- **Resilience & Error Handling**
  - HTTP retry with exponential backoff
  - Rate limiting support (429 responses)
  - User-friendly error messages

## Usage Examples

### OAuth 2.0 Authentication

```typescript
import { AuthProviderFactory, type OAuthCredentials } from './auth';

// Configure OAuth credentials
const oauthCredentials: OAuthCredentials = {
    clientId: 'your-atlas-oauth-client-id',
    clientSecret: 'your-atlas-oauth-client-secret',
    tokenEndpoint: 'https://cloud.mongodb.com/api/oauth/token',
    scope: 'atlas-api' // Optional
};

// Create OAuth provider
const authProvider = AuthProviderFactory.createOAuthProvider(oauthCredentials);

// Use provider to authenticate requests
const request = {
    method: 'GET',
    url: 'https://cloud.mongodb.com/api/atlas/v2/groups',
    headers: { 'Accept': 'application/json' }
};

const authenticatedRequest = await authProvider.authenticateRequest(request);
// authenticatedRequest.headers now includes: Authorization: Bearer <token>

// Validate credentials
const isValid = await authProvider.validateCredentials();
```

### Digest Authentication

```typescript
import { AuthProviderFactory, type DigestCredentials } from './auth';

// Configure Digest credentials
const digestCredentials: DigestCredentials = {
    publicKey: 'your-atlas-public-api-key',
    privateKey: 'your-atlas-private-api-key',
    baseUrl: 'https://cloud.mongodb.com'
};

// Create Digest provider
const authProvider = AuthProviderFactory.createDigestProvider(digestCredentials);

// Use provider to authenticate requests
const request = {
    method: 'GET',
    url: 'https://cloud.mongodb.com/api/atlas/v2/groups'
};

const authenticatedRequest = await authProvider.authenticateRequest(request);
// authenticatedRequest.headers now includes: Authorization: Digest <digest-params>
```

### Secure Credential Storage

```typescript
import { CredentialStorage, CredentialType } from './utils/credentialStorage';

// Initialize with VS Code's secret storage
const credentialStorage = new CredentialStorage(context.secrets);

// Store OAuth credentials
await credentialStorage.storeOAuthCredentials('atlas-connection-1', oauthCredentials);

// Store Digest credentials  
await credentialStorage.storeDigestCredentials('atlas-connection-2', digestCredentials);

// Retrieve credentials
const storedOAuth = await credentialStorage.getOAuthCredentials('atlas-connection-1');
const storedDigest = await credentialStorage.getDigestCredentials('atlas-connection-2');

// Check if credentials exist
const hasOAuth = await credentialStorage.hasCredentials('atlas-connection-1', CredentialType.OAuth);

// Delete credentials
await credentialStorage.deleteCredentials('atlas-connection-1', CredentialType.OAuth);
```

### HTTP Utilities with Retry

```typescript
import { HttpUtils, DEFAULT_RETRY_CONFIG } from './utils/httpUtils';

// Make request with automatic retry on transient failures
const response = await HttpUtils.fetchWithRetry(
    'https://cloud.mongodb.com/api/atlas/v2/groups',
    {
        method: 'GET',
        headers: { 'Authorization': 'Bearer token' }
    },
    DEFAULT_RETRY_CONFIG
);

// Custom retry configuration
const customRetryConfig = {
    maxAttempts: 5,
    baseDelayMs: 2000,
    maxDelayMs: 60000,
    jitterFactor: 0.2
};

const responseWithCustomRetry = await HttpUtils.fetchWithRetry(url, options, customRetryConfig);
```

## Architecture

### Core Components

- **`AuthProvider`**: Abstract base class defining the authentication interface
- **`OAuthAuthProvider`**: OAuth 2.0 Client Credentials implementation
- **`DigestAuthProvider`**: HTTP Digest authentication implementation
- **`TokenCache`**: In-memory token storage with expiry management
- **`CredentialStorage`**: Secure credential persistence using VS Code secrets
- **`HttpUtils`**: HTTP utilities with retry and backoff logic

### Factory Pattern

The `AuthProviderFactory` provides a clean way to create authentication providers:

```typescript
// Returns an AuthProvider instance
const oauthProvider = AuthProviderFactory.createOAuthProvider(oauthCredentials);
const digestProvider = AuthProviderFactory.createDigestProvider(digestCredentials);
```

### Error Handling

The authentication layer provides user-friendly error messages while maintaining security:

```typescript
try {
    const result = await authProvider.authenticateRequest(request);
} catch (error) {
    // Errors include helpful context without exposing sensitive data
    console.error('Authentication failed:', error.message);
    // Example: "Authentication failed. Please verify your Client ID and Client Secret."
}
```

## Testing

The module includes comprehensive unit tests covering:

- OAuth token lifecycle (retrieval, caching, refresh, expiry)
- Digest authentication signing and validation  
- Error handling and credential validation
- Cache management and token expiry
- HTTP retry logic and rate limiting

Run tests with:
```bash
npm run jesttest -- --testPathPatterns="service-mongodb-atlas"
```

## Security Considerations

- **No Credential Logging**: Credentials are never logged or exposed in error messages
- **Secure Storage**: Uses VS Code's encrypted secret storage API
- **Token Security**: Access tokens are cached in memory only and cleared on errors
- **Input Validation**: All credential inputs are validated before use
- **Error Sanitization**: Error messages are sanitized to prevent credential leakage