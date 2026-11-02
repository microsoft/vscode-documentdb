/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import { ext } from '../../../extensionVariables';
import { AwsInteractionRequiredError } from '../auth/errors';
import { type AwsCredentialRecord } from '../types';

export interface AwsKeySecrets {
    kind: 'keys';
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
    expiresAt?: number;
}

export interface AwsSsoSecrets {
    kind: 'sso';
    clientId: string;
    clientSecret: string;
    clientSecretExpiresAt: number;
    accessToken: string;
    accessTokenExpiresAt: number;
    refreshToken?: string;
}

export type AwsCredentialSecrets = AwsKeySecrets | AwsSsoSecrets;

interface StoredCredential {
    record: AwsCredentialRecord;
    secretKey?: string;
}

export interface AwsCredentialStorage {
    read(): StoredCredential[];
    write(records: StoredCredential[]): Promise<void>;
    getSecret(key: string): Promise<string | undefined>;
    storeSecret(key: string, value: string): Promise<void>;
    deleteSecret(key: string): Promise<void>;
}

const STATE_KEY = 'documentDB.awsDocumentDb.credentials.v1';

function defaultStorage(): AwsCredentialStorage {
    return {
        read: (): StoredCredential[] => ext.context.globalState.get<StoredCredential[]>(STATE_KEY, []),
        write: async (records): Promise<void> => ext.context.globalState.update(STATE_KEY, records),
        getSecret: async (key): Promise<string | undefined> => ext.secretStorage.get(key),
        storeSecret: async (key, value): Promise<void> => ext.secretStorage.store(key, value),
        deleteSecret: async (key): Promise<void> => ext.secretStorage.delete(key),
    };
}

function clone(record: AwsCredentialRecord): AwsCredentialRecord {
    return { ...record, regions: [...record.regions] };
}

function parseSecrets(text: string): AwsCredentialSecrets {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null || !('kind' in value)) {
        throw new AwsInteractionRequiredError();
    }
    if (value.kind === 'keys' && 'accessKeyId' in value && typeof value.accessKeyId === 'string' &&
        'secretAccessKey' in value && typeof value.secretAccessKey === 'string' &&
        (!('sessionToken' in value) || typeof value.sessionToken === 'string') &&
        (!('expiresAt' in value) || typeof value.expiresAt === 'number')) {
        return value as AwsKeySecrets;
    }
    if (value.kind === 'sso' && 'clientId' in value && typeof value.clientId === 'string' &&
        'clientSecret' in value && typeof value.clientSecret === 'string' &&
        'accessToken' in value && typeof value.accessToken === 'string' &&
        'clientSecretExpiresAt' in value && typeof value.clientSecretExpiresAt === 'number' &&
        'accessTokenExpiresAt' in value && typeof value.accessTokenExpiresAt === 'number' &&
        (!('refreshToken' in value) || typeof value.refreshToken === 'string')) {
        return value as AwsSsoSecrets;
    }
    throw new AwsInteractionRequiredError();
}

/** Mutations are serialized; candidate secrets get a fresh slot before metadata is committed. */
export class AwsCredentialStore {
    private readonly temporary = new Map<string, { record: AwsCredentialRecord; secrets: AwsKeySecrets }>();
    private mutations: Promise<unknown> = Promise.resolve();

    constructor(private readonly storage: AwsCredentialStorage = defaultStorage()) {}

    private async serialized<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.mutations.then(operation, operation);
        this.mutations = result.catch(() => undefined);
        return result;
    }

    public async list(): Promise<AwsCredentialRecord[]> {
        await this.mutations;
        return [
            ...this.storage.read().map(({ record }) => clone(record)),
            ...Array.from(this.temporary.values(), ({ record }) => clone(record)),
        ];
    }

    public async secrets(id: string): Promise<AwsCredentialSecrets | undefined> {
        await this.mutations;
        const temporary = this.temporary.get(id);
        if (temporary) {
            return { ...temporary.secrets };
        }
        const item = this.storage.read().find(({ record }) => record.id === id);
        if (!item?.secretKey) {
            return undefined;
        }
        const text = await this.storage.getSecret(item.secretKey);
        return text ? parseSecrets(text) : undefined;
    }

    public async save(
        record: AwsCredentialRecord,
        secrets: AwsCredentialSecrets | undefined,
        assertCurrent: () => void,
    ): Promise<void> {
        await this.serialized(async (): Promise<void> => {
            assertCurrent();
            const previous = this.storage.read();
            const old = previous.find((item) => item.record.id === record.id);
            const previousSecret = old?.secretKey ? await this.storage.getSecret(old.secretKey) : undefined;
            assertCurrent();
            let secretKey: string | undefined;
            if (record.authMethod !== 'temporary' && secrets) {
                secretKey = `documentDB.awsDocumentDb.secret.${record.id}.${randomUUID()}`;
            }
            let metadataWritten = false;
            try {
                if (secretKey && secrets) {
                    await this.storage.storeSecret(secretKey, JSON.stringify(secrets));
                }
                assertCurrent();
                const next = previous.filter((item) => item.record.id !== record.id);
                if (record.authMethod !== 'temporary') {
                    const position = previous.findIndex((item) => item.record.id === record.id);
                    next.splice(position < 0 ? next.length : position, 0, { record: clone(record), secretKey });
                } else if (secrets?.kind !== 'keys') {
                    throw new AwsInteractionRequiredError();
                }
                // This is the acceptance boundary. All network verification precedes it.
                if (record.authMethod !== 'temporary' || old) {
                    await this.storage.write(next);
                    metadataWritten = true;
                }
                assertCurrent();
                if (old?.secretKey) {
                    await this.storage.deleteSecret(old.secretKey);
                }
                assertCurrent();
            } catch (error) {
                if (old?.secretKey && previousSecret !== undefined) {
                    await this.storage.storeSecret(old.secretKey, previousSecret);
                }
                if (metadataWritten) {
                    await this.storage.write(previous);
                }
                if (secretKey) {
                    await this.storage.deleteSecret(secretKey);
                }
                throw error;
            }
            this.temporary.delete(record.id);
            if (record.authMethod === 'temporary' && secrets?.kind === 'keys') {
                this.temporary.set(record.id, { record: clone(record), secrets: { ...secrets } });
            }
        });
    }

    public async remove(id: string): Promise<void> {
        await this.serialized(async (): Promise<void> => {
            const entries = this.storage.read();
            const existing = entries.find(({ record }) => record.id === id);
            const previousSecret = existing?.secretKey ? await this.storage.getSecret(existing.secretKey) : undefined;
            try {
                if (existing?.secretKey) {
                    await this.storage.deleteSecret(existing.secretKey);
                }
                if (existing) {
                    await this.storage.write(entries.filter(({ record }) => record.id !== id));
                }
            } catch (error) {
                if (existing?.secretKey && previousSecret !== undefined) {
                    await this.storage.storeSecret(existing.secretKey, previousSecret);
                }
                throw error;
            }
            this.temporary.delete(id);
        });
    }

    public dispose(): void {
        this.temporary.clear();
    }
}
