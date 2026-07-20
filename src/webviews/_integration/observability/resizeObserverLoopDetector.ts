/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Dev-only detector for a **genuine** ResizeObserver feedback loop.
 *
 * The webview's Content Security Policy forbids `unsafe-eval`, so we cannot use
 * webpack-dev-server's per-error `runtimeErrors` *function* to filter only the
 * benign "ResizeObserver loop …" warning out of the overlay (the client rebuilds
 * such a function with `new Function(...)`, which the CSP blocks). Instead the
 * runtime-error overlay is disabled wholesale in `webpack.config.views.js`. That
 * benign warning is non-fatal anyway — the spec defers, rather than drops, the
 * pending notifications.
 *
 * With the runtime overlay off, we lose the overlay's cue for a *real*,
 * continuous loop (a per-frame resize that pegs layout/CPU) too — a blip and a
 * runaway loop emit the identical message; only the **rate** differs. This
 * restores a signal for the real thing: it listens to `window` 'error' events
 * and warns **once per burst**, and only when they arrive faster than any human
 * interaction could produce. A single interaction (e.g. opening a Combobox)
 * emits one or two events and stays silent; a runaway loop trips the threshold.
 *
 * It is passive (never calls `preventDefault` / `stopPropagation`), so the raw
 * message still reaches the devtools console. It is intended to be installed
 * **only in development** — the sole caller guards it with
 * `process.env.NODE_ENV !== 'production'`, so the whole thing is
 * dead-code-eliminated from the production bundle.
 */

const RESIZE_OBSERVER_LOOP = /^ResizeObserver loop/;

/** Sliding measurement window. */
const WINDOW_MS = 1000;

/** More than this many loop errors within one window is no longer a benign blip. */
const BURST_THRESHOLD = 5;

/**
 * Install the sustained-loop detector on `window`. Safe to call once at webview
 * bootstrap; a no-op when there is no `window` (e.g. under tests).
 */
export function installResizeObserverLoopDetector(): void {
    if (typeof window === 'undefined') {
        return;
    }

    let windowStart = 0;
    let count = 0;
    let warnedThisWindow = false;

    window.addEventListener(
        'error',
        (event: ErrorEvent) => {
            if (typeof event.message !== 'string' || !RESIZE_OBSERVER_LOOP.test(event.message)) {
                return;
            }

            const now = performance.now();
            if (now - windowStart > WINDOW_MS) {
                // Start a fresh window: reset the counter and the once-per-burst latch.
                windowStart = now;
                count = 0;
                warnedThisWindow = false;
            }

            count += 1;
            if (count > BURST_THRESHOLD && !warnedThisWindow) {
                warnedThisWindow = true;
                console.warn(
                    `[DocumentDB] Sustained ResizeObserver loop detected (> ${BURST_THRESHOLD}/s). ` +
                        'This is NOT the benign one-shot warning — something is resizing every frame. ' +
                        'Open DevTools ▸ Performance monitor and watch "Layouts / sec" at idle to find it.',
                );
            }
        },
        /* capture */ true,
    );
}
