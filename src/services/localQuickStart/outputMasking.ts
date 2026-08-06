/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure (dependency-free) secret-masking + line-buffering for Quick Start
 * OutputChannel writes (decision D14). Kept free of `vscode` and the container
 * client so it is trivially unit-testable.
 *
 * The generated password must never reach the OutputChannel — not in a command
 * echo, not in stdout, not in stderr, and not even when a stream chunk splits
 * the secret across a buffer boundary. {@link MaskingLineBuffer} therefore
 * buffers by line and {@link maskSecrets} redacts every occurrence.
 */

/** Replace every non-empty secret occurrence in `text` with `***`. */
export function maskSecrets(text: string, secrets: ReadonlyArray<string>): string {
    let out = text;
    for (const secret of secrets) {
        if (secret && secret.length > 0) {
            out = out.split(secret).join('***');
        }
    }
    return out;
}

/**
 * Emit a forced (newline-less) chunk once the buffer reaches this size, so a container that streams
 * a very long line — a progress bar using `\r`, a binary blob, a runaway single-line log — cannot
 * grow the buffer without bound while `docker logs -f` keeps running.
 */
const MAX_BUFFERED_CHARS = 16 * 1024;

/**
 * Accumulates raw stream chunks, emits one masked line at a time on each
 * newline, and masks any trailing partial line on {@link flush}. Buffering by
 * line guarantees a secret split across two chunks is still fully visible to
 * {@link maskSecrets} before anything is emitted.
 */
export class MaskingLineBuffer {
    private buffer = '';
    /** Longest secret; a forced flush must retain at least this much so it cannot split a secret. */
    private readonly maxSecretLength: number;

    constructor(
        private readonly emit: (line: string) => void,
        private readonly secrets: ReadonlyArray<string>,
    ) {
        this.maxSecretLength = secrets.reduce((longest, secret) => Math.max(longest, secret.length), 0);
    }

    public push(chunk: string): void {
        this.buffer += chunk;
        let newlineIndex: number;
        while ((newlineIndex = this.buffer.indexOf('\n')) >= 0) {
            const line = this.buffer.slice(0, newlineIndex).replace(/\r$/, '');
            this.buffer = this.buffer.slice(newlineIndex + 1);
            this.emit(maskSecrets(line, this.secrets));
        }
        // No newline in sight: emit what we have, but keep a tail at least as long as the longest
        // secret so a secret straddling the cut is still whole on the next pass and gets masked.
        if (this.buffer.length > MAX_BUFFERED_CHARS) {
            const keep = Math.max(this.maxSecretLength, 1);
            const cut = this.buffer.length - keep;
            if (cut > 0) {
                this.emit(maskSecrets(this.buffer.slice(0, cut), this.secrets));
                this.buffer = this.buffer.slice(cut);
            }
        }
    }

    public flush(): void {
        if (this.buffer.length > 0) {
            this.emit(maskSecrets(this.buffer, this.secrets));
            this.buffer = '';
        }
    }
}
