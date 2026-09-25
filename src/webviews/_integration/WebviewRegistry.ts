/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AtlasCredentialsView } from '../documentdb/atlasCredentials/AtlasCredentialsView';
import { CollectionView } from '../documentdb/collectionView/CollectionView';
import { DocumentView } from '../documentdb/documentView/documentView';
import { LocalQuickStart } from '../documentdb/localQuickStart/LocalQuickStart';

/**
 * Maps each webview name to the React component mounted for it.
 *
 * ## Why this exists
 *
 * The whole webview side ships as a single bundle (`views.js`). When a panel
 * opens, the framework's generated HTML calls
 * `render(viewType, acquireVsCodeApi())` (see `src/webviews/index.tsx`), passing
 * the `viewType` the panel was created with. This registry is the lookup that
 * turns that string key into the correct root component to render; without it a
 * single bundle could not serve more than one panel type.
 *
 * It is also the single source of the {@link WebviewName} union, which the host
 * side (`openAppWebview` / `OpenAppWebviewOptions.webviewName`) uses so a panel
 * can only be opened with a name that has a registered component. A typo becomes
 * a compile error instead of a blank panel at runtime.
 *
 * ## How to add a new webview
 *
 * 1. Create the React root component (e.g. `MyView`).
 * 2. Add a line here: `myView: MyView`. The key is the webview's name.
 * 3. In the view's factory, pass that same key as `webviewName` to
 *    `openAppWebview({ webviewName: 'myView', ... })` (see `openCollectionWebview`).
 * 4. Register the command that opens the view.
 *
 * The key here and the `webviewName` passed to `openAppWebview` must match;
 * {@link WebviewName} enforces that at compile time.
 */
export const WebviewRegistry = {
    collectionView: CollectionView,
    documentView: DocumentView,
    localQuickStart: LocalQuickStart,
    atlasCredentials: AtlasCredentialsView,
} as const;

/**
 * Union of all registered webview name keys (e.g. `'collectionView'`).
 *
 * Used host-side by `openAppWebview` / `OpenAppWebviewOptions.webviewName` to
 * constrain which panels can be opened, and webview-side by `render(...)` in
 * `src/webviews/index.tsx` to type the lookup key.
 */
export type WebviewName = keyof typeof WebviewRegistry;
