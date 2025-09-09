/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DigestAuthProvider } from '../auth/DigestAuthProvider';
import { type AuthRequest, type DigestCredentials } from '../auth/types';

// Mock fetch globally
global.fetch = jest.fn();

describe('DigestAuthProvider', () => {
    let provider: DigestAuthProvider;
    const mockCredentials: DigestCredentials = {
        publicKey: '12345678-1234-1234-1234-123456789abc',
        privateKey: 'abcdef01-2345-6789-abcd-ef0123456789',
        baseUrl: 'https://cloud.mongodb.com',
    };

    beforeEach(() => {
        provider = new DigestAuthProvider(mockCredentials);
        jest.clearAllMocks();
    });

    describe('authenticateRequest', () => {
        it('should add Digest authorization header to request', async () => {
            const request: AuthRequest = {
                method: 'GET',
                url: 'https://cloud.mongodb.com/api/atlas/v2/groups',
                headers: { 'Custom-Header': 'value' },
            };

            const authenticatedRequest = await provider.authenticateRequest(request);

            expect(authenticatedRequest.headers['Authorization']).toMatch(/^Digest /);
            expect(authenticatedRequest.headers['Authorization']).toContain('username="12345678-1234-1234-1234-123456789abc"');
            expect(authenticatedRequest.headers['Authorization']).toContain('realm="MMS Public API"');
            expect(authenticatedRequest.headers['Authorization']).toContain('uri="/api/atlas/v2/groups"');
            expect(authenticatedRequest.headers['Authorization']).toContain('response="');
            expect(authenticatedRequest.headers['Content-Type']).toBe('application/json');
            expect(authenticatedRequest.headers['Custom-Header']).toBe('value');
        });

        it('should handle URLs with query parameters', async () => {
            const request: AuthRequest = {
                method: 'GET',
                url: 'https://cloud.mongodb.com/api/atlas/v2/groups?itemsPerPage=10&pageNum=1',
            };

            const authenticatedRequest = await provider.authenticateRequest(request);

            expect(authenticatedRequest.headers['Authorization']).toContain('uri="/api/atlas/v2/groups?itemsPerPage=10&pageNum=1"');
        });

        it('should preserve existing headers while adding auth', async () => {
            const request: AuthRequest = {
                method: 'POST',
                url: 'https://cloud.mongodb.com/api/atlas/v2/groups',
                headers: {
                    'Accept': 'application/xml',
                    'X-Custom': 'test',
                },
            };

            const authenticatedRequest = await provider.authenticateRequest(request);

            expect(authenticatedRequest.headers['Authorization']).toMatch(/^Digest /);
            expect(authenticatedRequest.headers['Content-Type']).toBe('application/json');
            expect(authenticatedRequest.headers['Accept']).toBe('application/xml');
            expect(authenticatedRequest.headers['X-Custom']).toBe('test');
        });

        it('should generate different nonces for different requests', async () => {
            const request: AuthRequest = {
                method: 'GET',
                url: 'https://cloud.mongodb.com/api/atlas/v2/groups',
            };

            const auth1 = await provider.authenticateRequest(request);
            const auth2 = await provider.authenticateRequest(request);

            const noncePattern = /nonce="([^"]+)"/;
            const nonce1 = auth1.headers['Authorization'].match(noncePattern)?.[1];
            const nonce2 = auth2.headers['Authorization'].match(noncePattern)?.[1];

            expect(nonce1).toBeDefined();
            expect(nonce2).toBeDefined();
            expect(nonce1).not.toBe(nonce2);
        });
    });

    describe('validateCredentials', () => {
        it('should return true for successful API call', async () => {
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                status: 200,
            });

            const isValid = await provider.validateCredentials();
            expect(isValid).toBe(true);
            
            // Verify the correct test endpoint was called
            expect(fetch).toHaveBeenCalledWith(
                'https://cloud.mongodb.com/api/atlas/v2/groups',
                expect.objectContaining({
                    method: 'GET',
                    headers: expect.objectContaining({
                        'Authorization': expect.stringMatching(/^Digest /),
                    }),
                })
            );
        });

        it('should return true for 401 response (auth was attempted)', async () => {
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: false,
                status: 401,
            });

            const isValid = await provider.validateCredentials();
            expect(isValid).toBe(true);
        });

        it('should return false for network errors', async () => {
            (fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

            const isValid = await provider.validateCredentials();
            expect(isValid).toBe(false);
        });

        it('should return false for non-auth related errors', async () => {
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: false,
                status: 500,
            });

            const isValid = await provider.validateCredentials();
            expect(isValid).toBe(false);
        });
    });

    describe('clearCache', () => {
        it('should not throw when clearing cache', () => {
            expect(() => provider.clearCache()).not.toThrow();
        });
    });

    describe('getPublicKey', () => {
        it('should return the public key', () => {
            expect(provider.getPublicKey()).toBe(mockCredentials.publicKey);
        });
    });

    describe('getBaseUrl', () => {
        it('should return the base URL', () => {
            expect(provider.getBaseUrl()).toBe(mockCredentials.baseUrl);
        });
    });

    describe('validateCredentials static method', () => {
        it('should validate well-formed credentials', () => {
            const validCredentials: DigestCredentials = {
                publicKey: '12345678-1234-1234-1234-123456789abc',
                privateKey: 'abcdef01-2345-6789-abcd-ef0123456789',
                baseUrl: 'https://cloud.mongodb.com',
            };

            expect(DigestAuthProvider.validateCredentials(validCredentials)).toBe(true);
        });

        it('should reject credentials with missing publicKey', () => {
            const invalidCredentials = {
                privateKey: 'abcdef01-2345-6789-abcd-ef0123456789',
                baseUrl: 'https://cloud.mongodb.com',
            } as DigestCredentials;

            expect(DigestAuthProvider.validateCredentials(invalidCredentials)).toBe(false);
        });

        it('should reject credentials with missing privateKey', () => {
            const invalidCredentials = {
                publicKey: '12345678-1234-1234-1234-123456789abc',
                baseUrl: 'https://cloud.mongodb.com',
            } as DigestCredentials;

            expect(DigestAuthProvider.validateCredentials(invalidCredentials)).toBe(false);
        });

        it('should reject credentials with missing baseUrl', () => {
            const invalidCredentials = {
                publicKey: '12345678-1234-1234-1234-123456789abc',
                privateKey: 'abcdef01-2345-6789-abcd-ef0123456789',
            } as DigestCredentials;

            expect(DigestAuthProvider.validateCredentials(invalidCredentials)).toBe(false);
        });

        it('should reject credentials with invalid baseUrl', () => {
            const invalidCredentials: DigestCredentials = {
                publicKey: '12345678-1234-1234-1234-123456789abc',
                privateKey: 'abcdef01-2345-6789-abcd-ef0123456789',
                baseUrl: 'not-a-valid-url',
            };

            expect(DigestAuthProvider.validateCredentials(invalidCredentials)).toBe(false);
        });

        it('should reject credentials with invalid publicKey format', () => {
            const invalidCredentials: DigestCredentials = {
                publicKey: 'invalid-key-format',
                privateKey: 'abcdef01-2345-6789-abcd-ef0123456789',
                baseUrl: 'https://cloud.mongodb.com',
            };

            expect(DigestAuthProvider.validateCredentials(invalidCredentials)).toBe(false);
        });

        it('should reject credentials with invalid privateKey format', () => {
            const invalidCredentials: DigestCredentials = {
                publicKey: '12345678-1234-1234-1234-123456789abc',
                privateKey: 'invalid-key-format',
                baseUrl: 'https://cloud.mongodb.com',
            };

            expect(DigestAuthProvider.validateCredentials(invalidCredentials)).toBe(false);
        });

        it('should reject non-object credentials', () => {
            expect(DigestAuthProvider.validateCredentials(null as unknown)).toBe(false);
            expect(DigestAuthProvider.validateCredentials(undefined as unknown)).toBe(false);
            expect(DigestAuthProvider.validateCredentials('string' as unknown)).toBe(false);
            expect(DigestAuthProvider.validateCredentials(123 as unknown)).toBe(false);
        });
    });

    describe('digest authentication format', () => {
        it('should create properly formatted digest authorization header', async () => {
            const request: AuthRequest = {
                method: 'GET',
                url: 'https://cloud.mongodb.com/api/atlas/v2/groups',
            };

            const authenticatedRequest = await provider.authenticateRequest(request);
            const authHeader = authenticatedRequest.headers['Authorization'];

            // Verify the format contains all required components
            expect(authHeader).toMatch(/^Digest /);
            expect(authHeader).toMatch(/username="[^"]+"/);
            expect(authHeader).toMatch(/realm="MMS Public API"/);
            expect(authHeader).toMatch(/nonce="[^"]+"/);
            expect(authHeader).toMatch(/uri="[^"]+"/);
            expect(authHeader).toMatch(/response="[^"]+"/);
            expect(authHeader).toMatch(/algorithm="MD5"/);
            expect(authHeader).toMatch(/qop="auth"/);
            expect(authHeader).toMatch(/nc="00000001"/);
            expect(authHeader).toMatch(/cnonce="[^"]+"/);
        });

        it('should generate consistent response for same input', async () => {
            const request: AuthRequest = {
                method: 'GET',
                url: 'https://cloud.mongodb.com/api/atlas/v2/groups',
            };

            // Mock the nonce generation to be consistent
            const originalNonce = (provider as any).generateNonce;
            (provider as any).generateNonce = jest.fn(() => 'consistent-nonce');

            const auth1 = await provider.authenticateRequest(request);
            const auth2 = await provider.authenticateRequest(request);

            // Response should be the same when nonce is the same
            const responsePattern = /response="([^"]+)"/;
            const response1 = auth1.headers['Authorization'].match(responsePattern)?.[1];
            const response2 = auth2.headers['Authorization'].match(responsePattern)?.[1];

            expect(response1).toBe(response2);

            // Restore original function
            (provider as any).generateNonce = originalNonce;
        });
    });
});