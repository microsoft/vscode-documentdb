# MongoDB Atlas Service Discovery Plugin

This plugin provides programmatic access to the MongoDB Atlas Management API v2 for service discovery in VS Code DocumentDB extension.

## Features

### Programmatic API Access
- **OAuth2 Client Credentials Flow**: Preferred authentication method with automatic token refresh
- **HTTP Digest Authentication**: Legacy API key support as fallback
- **Rate Limiting**: Automatic retry with exponential backoff and jitter
- **Pagination**: Generic pagination support following Atlas v2 response patterns

### Atlas Management API v2 Operations
- List Projects (groups) and Clusters within projects
- Read cluster connection strings from cluster resources  
- List database users for projects/clusters
- Read and write IP access list (firewall) entries

## API Client Structure

### Core Classes
- `AtlasApiClient`: Main HTTP client with authentication and retry logic
- `OAuthAuthenticator`: OAuth2 Client Credentials flow implementation
- `DigestAuthenticator`: HTTP Digest authentication for API keys
- `MongoDBAtlasDiscoveryProvider`: VS Code extension integration

### Error Handling
- `AtlasApiError`: General API errors
- `AtlasAuthenticationError`: Authentication failures
- `AtlasRateLimitError`: Rate limiting with retry-after support

## Testing

### Unit Tests
Run the Jest test suite to verify API client functionality:

```bash
npm run jesttest
```

The tests cover:
- OAuth token flow and refresh logic
- HTTP Digest authentication challenge/response
- Rate limiting and retry behavior with exponential backoff
- Pagination handling
- All Atlas API operations

### Manual Testing Notes

To manually test the API client with real Atlas credentials:

1. **OAuth2 Setup**:
   - Create OAuth2 application in Atlas organization settings
   - Note the client ID, client secret, and required scopes
   - Use credentials with `OAuthCredentials` interface

2. **API Key Setup**:
   - Generate API key pair in Atlas organization access manager
   - Use public/private key pair with `DigestCredentials` interface

3. **Example Usage**:
   ```typescript
   // OAuth2 example
   const oauthCreds: OAuthCredentials = {
     clientId: 'your-client-id',
     clientSecret: 'your-client-secret',
     scopes: ['openid'] // Check Atlas docs for required scopes
   };
   
   // API Key example
   const digestCreds: DigestCredentials = {
     publicKey: 'your-public-key',
     privateKey: 'your-private-key'
   };
   
   const client = new AtlasApiClient(oauthCreds);
   const projects = await client.listProjects();
   ```

## Integration Status

### Current Implementation
- ✅ Complete HTTP client with OAuth2 and Digest authentication
- ✅ All required Atlas Management API v2 operations
- ✅ Pagination and rate limiting with retry logic
- ✅ Comprehensive unit test coverage
- ✅ Registered with VS Code extension discovery service

### Minimal UI Integration
- ✅ Basic discovery provider registration
- ✅ Tree view root item placeholder
- ⚠️ Wizard steps are minimal placeholders (as requested for programmatic focus)

The plugin focuses on the programmatic API client as specified in the requirements. Full UI integration with credential prompts and cluster selection would be the next development phase.

## Architecture Notes

The plugin follows the established VS Code DocumentDB extension patterns:
- Implements `DiscoveryProvider` interface
- Follows the existing plugin directory structure  
- Uses the same error handling and localization patterns
- Integrates with existing tree view and wizard infrastructure

The API client is designed to be thin and testable, surfacing friendly errors to the UI layer while handling the complexity of Atlas authentication and API interaction.