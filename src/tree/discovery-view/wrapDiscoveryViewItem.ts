/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DiscoveryService } from '../../services/discoveryServices';
import { type TreeElement } from '../TreeElement';

// Symbol to mark wrapped items (allows us to check if an item is already wrapped)
const WrappedSymbol = Symbol('_xWrappedInDiscoveryHandling');

// Use a WeakMap to track wrapped items without preventing garbage collection
const wrappedItemsCache = new WeakMap<TreeElement, TreeElement>();

// Use a WeakMap for reverse mapping (wrapped → original)
const unwrapCache = new WeakMap<TreeElement, TreeElement>();

export function wrapDiscoveryViewItem<T extends TreeElement>(originalItem: T, providerId: string): T {
    // Check if item is already wrapped
    if (originalItem[WrappedSymbol]) {
        throw new Error('Element is already wrapped in discovery handling');
    }

    // Return cached wrapper if it exists
    const cached = wrappedItemsCache.get(originalItem) as T | undefined;
    if (cached) {
        return cached;
    }

    // Create a proxy that intercepts property access and method calls
    const wrapped = new Proxy(originalItem, {
        // Handle property access
        get(target, prop, receiver) {
            // Special case for our wrapped symbol check
            if (prop === WrappedSymbol) {
                return true;
            }

            // Handle getTreeItem method specifically
            if (prop === 'getTreeItem') {
                return async () => {
                    // Retrieve provider from registry when needed
                    const currentProvider = DiscoveryService.getProvider(providerId);
                    if (!currentProvider) {
                        throw new Error(`Provider ${providerId} no longer available`);
                    }

                    return currentProvider.getDiscoveryTreeDataProvider().getTreeItem(originalItem);
                };
            }

            if (prop === 'getChildren') {
                return async () => {
                    // Retrieve provider from registry when needed
                    const currentProvider = DiscoveryService.getProvider(providerId);
                    if (!currentProvider) {
                        throw new Error(`Provider ${providerId} no longer available`);
                    }

                    // Call the provider's getChildren method
                    const children = await currentProvider.getDiscoveryTreeDataProvider().getChildren(originalItem);
                    // Wrap each child in discovery handling
                    return children?.map((child) => wrapDiscoveryViewItem(child, providerId)) ?? [];
                };
            }

            // Default behavior for all other properties
            return Reflect.get(target, prop, receiver);
        },
    }) as T;

    // DEBUGGING ONLY: Add a real property to the proxy object
    Object.defineProperty(wrapped, '_xWrappedInDiscoveryHandling_DEBUGGING', {
        value: true,
        enumerable: true,
        configurable: true,
        writable: false,
    });

    // Cache the wrapped item
    wrappedItemsCache.set(originalItem, wrapped);
    unwrapCache.set(wrapped, originalItem);

    return wrapped;
}

/**
 * Returns the original (unwrapped) item if the given item is a wrapped proxy,
 * otherwise returns the item itself.
 */
export function unwrapDiscoveryViewItem<T extends TreeElement>(item: T): T {
    // If the item is wrapped, look up the original in our reverse cache
    if (item && item[WrappedSymbol]) {
        const original = unwrapCache.get(item) as T | undefined;
        if (original) {
            return original;
        }
    }
    // Not wrapped, or not found in cache
    return item;
}
