/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NodeDriverServiceProvider } from '@mongosh/service-provider-node-driver';
import { EventEmitter } from 'events';
import { type MongoClient } from 'mongodb';

const DEFAULT_PRODUCT_NAME = 'DocumentDB for VS Code';
const DEFAULT_PRODUCT_DOCS_LINK = 'https://github.com/microsoft/vscode-documentdb';

/**
 * Result of creating a DocumentDB service provider.
 * Returns both the provider and the event bus (needed by ShellInstanceState).
 */
export interface ServiceProviderWithBus {
    readonly serviceProvider: DocumentDBServiceProvider;
    readonly bus: EventEmitter;
}

/**
 * DocumentDB-specific service provider for @mongosh.
 *
 * Currently a thin wrapper around `NodeDriverServiceProvider` that configures
 * DocumentDB-specific product metadata.
 *
 * Future extensions:
 * - Block unsupported operations (e.g. `watch()`, `createChangeStream()`)
 *   with clear "Not supported by DocumentDB" error messages
 * - Override methods to provide DocumentDB-specific behavior
 *
 * @see future-work.md §"operator-registry.methods" for the planned
 *   unsupported-method blocking via a static method registry.
 */
export class DocumentDBServiceProvider extends NodeDriverServiceProvider {
    /**
     * Create a DocumentDB service provider from an existing MongoClient.
     *
     * Returns both the provider and the shared event bus (needed by
     * `ShellInstanceState` constructor).
     *
     * @param mongoClient - Connected MongoClient instance (caller owns lifecycle)
     * @param productName - Product name for @mongosh metadata
     * @param productDocsLink - Product documentation link for @mongosh metadata
     */
    static createForDocumentDB(
        mongoClient: MongoClient,
        productName?: string,
        productDocsLink?: string,
    ): ServiceProviderWithBus {
        const bus = new EventEmitter();
        const serviceProvider = new DocumentDBServiceProvider(mongoClient, bus, {
            productDocsLink: productDocsLink ?? DEFAULT_PRODUCT_DOCS_LINK,
            productName: productName ?? DEFAULT_PRODUCT_NAME,
        });
        return { serviceProvider, bus };
    }

    /**
     * Override close() to NOT close the underlying MongoClient.
     *
     * The caller (worker thread) owns the MongoClient lifecycle. The base
     * class's close() calls `mongoClient.close()`, which would break
     * subsequent evaluations in fresh-context mode (playground) where
     * `ShellInstanceState.close()` cascades through the service provider.
     */
    override async close(): Promise<void> {
        // Intentionally empty — the MongoClient is owned by the worker thread
        // and will be closed when the worker shuts down.
    }
}
