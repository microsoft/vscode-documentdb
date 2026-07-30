/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Persistent store for MongoDB Atlas discovery credentials.
 *
 * Each credential is one {@link StorageItem} under
 * `StorageService.get('atlas-mongodb-discovery')` in the `credentials` workspace, mirroring the
 * Kubernetes `sourceStore` shape. Non-secret metadata lives in `properties`; the secret material
 * (API key pair, or Service Account client id/secret plus its cached access token) lives in the
 * item's `secrets` array, which the storage service backs with VS Code SecretStorage.
 *
 * Design points that the rest of the Atlas plugin depends on:
 *
 * - **Stable record ID.** A `randomUUID()` generated once per credential. It is never derived
 *   from the secret, so rotating a key keeps the same record ID, the same tree paths, and the
 *   same saved connections.
 * - **Independent secret slots.** Every credential owns its own storage item, so restoring or
 *   removing one credential can never overwrite another one's secrets.
 * - **Non-secret identity hint.** A short prefix of the API public key / Service Account client
 *   ID is persisted in `properties` so credential labels can be rendered without reading
 *   SecretStorage.
 */

import { randomUUID } from 'crypto';
import { StorageService, type StorageItem } from '../../../services/storageService';
import { type AtlasAuthMethod } from '../auth/AtlasSession';

/** StorageService lookup name for Atlas discovery data. */
export const ATLAS_STORAGE_NAME = 'atlas-mongodb-discovery';

/** Workspace holding one item per credential. */
export const ATLAS_CREDENTIALS_WORKSPACE = 'credentials';

/** Schema version stamped on every stored credential item. */
const CREDENTIAL_ITEM_VERSION = '1';

/** Number of leading characters kept as a non-secret identity hint. */
const IDENTITY_HINT_LENGTH = 8;

/**
 * Non-secret metadata persisted next to every credential.
 */
interface AtlasCredentialItemProperties extends Record<string, unknown> {
    readonly authMethod: AtlasAuthMethod;
    /** User-supplied friendly name. Wins over every other label source when present. */
    readonly label?: string;
    /** Organization id cached from the first successful `listOrganizations()`. */
    readonly orgId?: string;
    /** Organization name cached from the first successful `listOrganizations()`. */
    readonly orgName?: string;
    /** Short, non-secret prefix of the public key / client id, used for label fallbacks. */
    readonly identityHint?: string;
    /** Stable display order. */
    readonly order: number;
    readonly version: typeof CREDENTIAL_ITEM_VERSION;
}

/**
 * A credential as the rest of the plugin sees it: identity and metadata only, never secrets.
 */
export interface AtlasCredentialRecord {
    readonly id: string;
    readonly authMethod: AtlasAuthMethod;
    readonly label?: string;
    readonly orgId?: string;
    readonly orgName?: string;
    readonly identityHint?: string;
    readonly order: number;
}

/** Secret material for an API Key credential. */
export interface AtlasApiKeySecrets {
    readonly authMethod: 'apikey';
    readonly publicKey: string;
    readonly privateKey: string;
}

/** Secret material for a Service Account credential, including its cached access token. */
export interface AtlasServiceAccountSecrets {
    readonly authMethod: 'serviceaccount';
    readonly clientId: string;
    readonly clientSecret: string;
    readonly accessToken?: string;
    /** Epoch milliseconds, as a string, matching the storage representation. */
    readonly expiresAt?: string;
}

export type AtlasCredentialSecrets = AtlasApiKeySecrets | AtlasServiceAccountSecrets;

/** Metadata that may be updated without touching the secret material. */
export interface AtlasCredentialMetadataUpdate {
    readonly label?: string;
    readonly orgId?: string;
    readonly orgName?: string;
}

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

let cache: AtlasCredentialRecord[] | undefined;
let inflightLoad: Promise<AtlasCredentialRecord[]> | undefined;

function invalidateCache(): void {
    cache = undefined;
    inflightLoad = undefined;
}

/**
 * Drops the in-memory cache. Production code never needs this; the store invalidates itself on
 * every write. Tests use it to start from a clean slate.
 *
 * @internal
 */
export function resetAtlasCredentialStoreCache(): void {
    invalidateCache();
}

async function loadFromStorage(): Promise<AtlasCredentialRecord[]> {
    const items =
        await StorageService.get(ATLAS_STORAGE_NAME).getItems<AtlasCredentialItemProperties>(
            ATLAS_CREDENTIALS_WORKSPACE,
        );

    return items
        .filter(isValidCredentialItem)
        .sort((a, b) => orderOf(a) - orderOf(b))
        .map(toRecord);
}

async function ensureCache(): Promise<AtlasCredentialRecord[]> {
    if (cache) {
        return cache;
    }
    if (!inflightLoad) {
        inflightLoad = loadFromStorage();
    }
    // Capture the in-flight promise locally so an `invalidateCache()` racing this load cannot
    // trick us into committing a now-stale snapshot back into `cache`.
    const currentLoad = inflightLoad;
    const loaded = await currentLoad;
    if (inflightLoad === currentLoad) {
        cache = loaded;
        inflightLoad = undefined;
    }
    return loaded;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reads every stored credential in stable display order.
 */
export async function readAtlasCredentials(): Promise<AtlasCredentialRecord[]> {
    return [...(await ensureCache())];
}

/**
 * Reads a single credential by its stable record ID.
 */
export async function getAtlasCredential(id: string): Promise<AtlasCredentialRecord | undefined> {
    return (await ensureCache()).find((record) => record.id === id);
}

/**
 * Reads the secret material for a credential, or `undefined` when the record is missing or its
 * secrets have been cleared.
 */
export async function readAtlasCredentialSecrets(id: string): Promise<AtlasCredentialSecrets | undefined> {
    const item = await StorageService.get(ATLAS_STORAGE_NAME).getItem<AtlasCredentialItemProperties>(
        ATLAS_CREDENTIALS_WORKSPACE,
        id,
    );

    if (!item?.properties) {
        return undefined;
    }

    const secrets = item.secrets ?? [];

    if (item.properties.authMethod === 'apikey') {
        const [publicKey, privateKey] = secrets;
        if (!publicKey || !privateKey) {
            return undefined;
        }
        return { authMethod: 'apikey', publicKey, privateKey };
    }

    const [clientId, clientSecret, accessToken, expiresAt] = secrets;
    if (!clientId || !clientSecret) {
        return undefined;
    }
    return {
        authMethod: 'serviceaccount',
        clientId,
        clientSecret,
        accessToken: accessToken && accessToken.length > 0 ? accessToken : undefined,
        expiresAt: expiresAt && expiresAt.length > 0 ? expiresAt : undefined,
    };
}

/**
 * Result of {@link upsertAtlasCredential}: the persisted record plus whether the call created a
 * brand-new credential or replaced the secret of an existing one.
 */
export interface UpsertAtlasCredentialResult {
    readonly record: AtlasCredentialRecord;
    /** `true` when a new credential record was created, `false` when an existing one was updated. */
    readonly created: boolean;
}

/**
 * Adds a credential, or replaces the secret material of the credential that already carries the
 * same Atlas identity (API public key, or Service Account client id).
 *
 * Matching on the Atlas identity - rather than always creating a new record - keeps the store
 * free of accidental duplicates when a user re-enters the same key to fix an Atlas-side access
 * problem, and it keeps the record ID (and therefore tree paths and saved connections) stable
 * across a secret rotation.
 */
export async function upsertAtlasCredential(
    secrets: AtlasCredentialSecrets,
    metadata: AtlasCredentialMetadataUpdate = {},
): Promise<UpsertAtlasCredentialResult> {
    const records = await ensureCache();
    const existing = await findCredentialByIdentity(records, secrets);

    if (existing) {
        const updated: AtlasCredentialRecord = {
            ...existing,
            label: metadata.label ?? existing.label,
            orgId: metadata.orgId ?? existing.orgId,
            orgName: metadata.orgName ?? existing.orgName,
        };
        await pushItem(updated, secrets);
        invalidateCache();
        return { record: updated, created: false };
    }

    const record: AtlasCredentialRecord = {
        id: randomUUID(),
        authMethod: secrets.authMethod,
        label: metadata.label,
        orgId: metadata.orgId,
        orgName: metadata.orgName,
        identityHint: identityHint(identityOf(secrets)),
        order: nextOrder(records),
    };

    await pushItem(record, secrets);
    invalidateCache();
    return { record, created: true };
}

/**
 * Replaces the secret material of an existing credential in place, keeping its ID, order, and
 * metadata. Used by the "update credentials" flow, which only calls this once the replacement
 * secret has been validated, so a failed update never destroys a working credential.
 *
 * Returns `undefined` when the credential no longer exists.
 */
export async function replaceAtlasCredentialSecrets(
    id: string,
    secrets: AtlasCredentialSecrets,
    metadata: AtlasCredentialMetadataUpdate = {},
): Promise<AtlasCredentialRecord | undefined> {
    const records = await ensureCache();
    const existing = records.find((record) => record.id === id);
    if (!existing) {
        return undefined;
    }

    const currentSecrets = await readAtlasCredentialSecrets(id);
    if (
        !currentSecrets ||
        currentSecrets.authMethod !== secrets.authMethod ||
        identityOf(currentSecrets) !== identityOf(secrets)
    ) {
        throw new Error('Atlas credential identity cannot be changed');
    }

    const updated: AtlasCredentialRecord = {
        ...existing,
        label: metadata.label ?? existing.label,
        orgId: metadata.orgId ?? existing.orgId,
        orgName: metadata.orgName ?? existing.orgName,
    };

    await pushItem(updated, secrets);
    invalidateCache();
    return updated;
}

/**
 * Updates non-secret metadata (user label, cached organization) without touching the secrets.
 */
export async function updateAtlasCredentialMetadata(
    id: string,
    metadata: AtlasCredentialMetadataUpdate,
): Promise<AtlasCredentialRecord | undefined> {
    const records = await ensureCache();
    const existing = records.find((record) => record.id === id);
    if (!existing) {
        return undefined;
    }

    const updated: AtlasCredentialRecord = {
        ...existing,
        label: metadata.label ?? existing.label,
        orgId: metadata.orgId ?? existing.orgId,
        orgName: metadata.orgName ?? existing.orgName,
    };

    const secrets = await readAtlasCredentialSecrets(id);
    await pushItem(updated, secrets);
    invalidateCache();
    return updated;
}

/**
 * Caches the Service Account access token and its expiry alongside the credential so a reload
 * does not force an immediate re-mint. Only touches the credential identified by `id`.
 */
export async function cacheServiceAccountToken(id: string, accessToken: string, expiresAtMs: number): Promise<void> {
    const secrets = await readAtlasCredentialSecrets(id);
    if (!secrets || secrets.authMethod !== 'serviceaccount') {
        return;
    }

    const records = await ensureCache();
    const record = records.find((candidate) => candidate.id === id);
    if (!record) {
        return;
    }

    await pushItem(record, {
        ...secrets,
        accessToken,
        expiresAt: String(expiresAtMs),
    });
    invalidateCache();
}

/**
 * Deletes one credential and its secrets. Other credentials are untouched.
 */
export async function removeAtlasCredential(id: string): Promise<AtlasCredentialRecord | undefined> {
    const records = await ensureCache();
    const target = records.find((record) => record.id === id);
    if (!target) {
        return undefined;
    }

    await StorageService.get(ATLAS_STORAGE_NAME).delete(ATLAS_CREDENTIALS_WORKSPACE, id);
    invalidateCache();
    return target;
}

/**
 * Deletes every credential. Backs the "sign out of all" action.
 */
export async function removeAllAtlasCredentials(): Promise<number> {
    const records = await ensureCache();
    for (const record of records) {
        await StorageService.get(ATLAS_STORAGE_NAME).delete(ATLAS_CREDENTIALS_WORKSPACE, record.id);
    }
    invalidateCache();
    return records.length;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function identityOf(secrets: AtlasCredentialSecrets): string {
    return secrets.authMethod === 'apikey' ? secrets.publicKey : secrets.clientId;
}

function identityHint(identity: string): string {
    return identity.slice(0, IDENTITY_HINT_LENGTH);
}

async function findCredentialByIdentity(
    records: readonly AtlasCredentialRecord[],
    secrets: AtlasCredentialSecrets,
): Promise<AtlasCredentialRecord | undefined> {
    const identity = identityOf(secrets);
    for (const record of records) {
        if (record.authMethod !== secrets.authMethod) {
            continue;
        }

        const storedSecrets = await readAtlasCredentialSecrets(record.id);
        if (storedSecrets?.authMethod === secrets.authMethod && identityOf(storedSecrets) === identity) {
            return record;
        }
    }
    return undefined;
}

function secretsToArray(secrets: AtlasCredentialSecrets | undefined): string[] | undefined {
    if (!secrets) {
        return undefined;
    }
    if (secrets.authMethod === 'apikey') {
        return [secrets.publicKey, secrets.privateKey];
    }
    return [secrets.clientId, secrets.clientSecret, secrets.accessToken ?? '', secrets.expiresAt ?? ''];
}

async function pushItem(record: AtlasCredentialRecord, secrets: AtlasCredentialSecrets | undefined): Promise<void> {
    const item: StorageItem<AtlasCredentialItemProperties> = {
        id: record.id,
        name: record.label ?? record.orgName ?? record.identityHint ?? record.id,
        version: CREDENTIAL_ITEM_VERSION,
        properties: {
            authMethod: record.authMethod,
            label: record.label,
            orgId: record.orgId,
            orgName: record.orgName,
            identityHint: record.identityHint,
            order: record.order,
            version: CREDENTIAL_ITEM_VERSION,
        },
        secrets: secretsToArray(secrets),
    };

    await StorageService.get(ATLAS_STORAGE_NAME).push(ATLAS_CREDENTIALS_WORKSPACE, item, /* overwrite */ true);
}

function nextOrder(records: readonly AtlasCredentialRecord[]): number {
    if (records.length === 0) {
        return 0;
    }
    let highest = -1;
    for (const record of records) {
        if (Number.isFinite(record.order) && record.order > highest) {
            highest = record.order;
        }
    }
    return highest + 1;
}

function orderOf(item: StorageItem<AtlasCredentialItemProperties>): number {
    const order = item.properties?.order;
    return typeof order === 'number' && Number.isFinite(order) ? order : Number.MAX_SAFE_INTEGER;
}

function isValidCredentialItem(item: StorageItem<AtlasCredentialItemProperties>): boolean {
    if (typeof item.id !== 'string' || item.id.length === 0) {
        return false;
    }
    const authMethod = item.properties?.authMethod;
    return authMethod === 'apikey' || authMethod === 'serviceaccount';
}

function toRecord(item: StorageItem<AtlasCredentialItemProperties>): AtlasCredentialRecord {
    const properties = item.properties!;
    return {
        id: item.id,
        authMethod: properties.authMethod,
        label: properties.label,
        orgId: properties.orgId,
        orgName: properties.orgName,
        identityHint: properties.identityHint,
        order: orderOf(item),
    };
}
