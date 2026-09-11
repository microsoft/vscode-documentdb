/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * A React-free store that counts VS Code theme color changes, for derivations that must snapshot
 * colors rather than reference them.
 *
 * Fluent does not need this: its adapted tokens are `var(--vscode-*)` strings the browser
 * re-resolves by itself. A consumer that reads colors into fixed values - Monaco being the one
 * that exists - has no such luxury, and watching `data-vscode-theme-kind` alone is not enough:
 * switching between two dark themes leaves the kind unchanged while every color moves.
 *
 * Observing the root `style` attribute is the trigger, because that is where VS Code writes the
 * custom properties. It holds regardless of which body attributes a given VS Code version sets,
 * and it also catches `workbench.colorCustomizations` edits, which change no theme at all.
 */

const THEME_ATTRIBUTES = ['data-vscode-theme-kind', 'data-vscode-theme-id', 'data-vscode-theme-name', 'class'];

let version = 0;
let observer: MutationObserver | undefined;
let hasObserved = false;
const listeners = new Set<() => void>();

function start(): void {
    if (observer || typeof MutationObserver === 'undefined') {
        return;
    }

    // Nothing was watching between the last unsubscribe and now, so the theme may have moved
    // uncounted. Bump, or a consumer caching on the version would serve a stale snapshot.
    if (hasObserved) {
        version++;
    }

    hasObserved = true;

    // A single observer across both nodes, so one theme switch is one callback no matter how
    // many properties and attributes it rewrote.
    observer = new MutationObserver(() => {
        version++;
        listeners.forEach((listener) => listener());
    });

    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    observer.observe(document.body, { attributes: true, attributeFilter: THEME_ATTRIBUTES });
}

/** Subscribes to theme color changes. Pair with {@link getVSCodeThemeColorsVersion}. */
export function subscribeToVSCodeThemeColors(listener: () => void): () => void {
    listeners.add(listener);
    start();

    return () => {
        listeners.delete(listener);

        if (listeners.size === 0) {
            observer?.disconnect();
            observer = undefined;
        }
    };
}

/**
 * A counter that increments whenever the active theme's colors may have changed.
 *
 * The value is meaningless on its own - it is a cache key, and the snapshot for
 * `useSyncExternalStore`.
 */
export function getVSCodeThemeColorsVersion(): number {
    return version;
}
