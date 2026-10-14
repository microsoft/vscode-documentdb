/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';

/**
 * Maps each webview name to the React component mounted for it.
 *
 * ## Why this exists
 *
 * Each view's root component is code-split and loaded on demand by
 * `render(viewType, acquireVsCodeApi())` (see `src/webviews/index.tsx`).
 * This registry maps the panel's `viewType` to its lazy root component.
 *
 * It is also the single source of the {@link WebviewName} union, which the host
 * side only imports as a type (`OpenAppWebviewOptions.webviewName`), so an
 * unregistered panel name is a compile error instead of a blank panel.
 *
 * ## How to add a new webview
 *
 * 1. Create the React root component (e.g. `MyView`).
 * 2. Add a `React.lazy` entry with a literal import path and map the named
 *    component export to `default`. The key is the webview's name.
 * 3. In the view's factory, pass that same key as `webviewName` to
 *    `openAppWebview({ webviewName: 'myView', ... })` (see `openCollectionWebview`).
 * 4. Register the command that opens the view.
 *
 * The key here and the `webviewName` passed to `openAppWebview` must match;
 * {@link WebviewName} enforces that at compile time.
 */
export const WebviewRegistry = {
    clusterDashboard: React.lazy(() =>
        import('../documentdb/clusterDashboard/ClusterDashboard').then((module) => ({
            default: module.ClusterDashboard,
        })),
    ),
    collectionView: React.lazy(() =>
        import('../documentdb/collectionView/CollectionView').then((module) => ({ default: module.CollectionView })),
    ),
    documentView: React.lazy(() =>
        import('../documentdb/documentView/documentView').then((module) => ({ default: module.DocumentView })),
    ),
    localQuickStart: React.lazy(() =>
        import('../documentdb/localQuickStart/LocalQuickStart').then((module) => ({ default: module.LocalQuickStart })),
    ),
    atlasCredentials: React.lazy(() =>
        import('../documentdb/atlasCredentials/AtlasCredentialsView').then((module) => ({
            default: module.AtlasCredentialsView,
        })),
    ),
} as const;

/**
 * Union of all registered webview name keys (e.g. `'collectionView'`).
 *
 * Used host-side by `openAppWebview` / `OpenAppWebviewOptions.webviewName` to
 * constrain which panels can be opened, and webview-side by `render(...)` in
 * `src/webviews/index.tsx` to type the lookup key.
 */
export type WebviewName = keyof typeof WebviewRegistry;
