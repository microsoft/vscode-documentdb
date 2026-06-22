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
 * Accumulates raw stream chunks, emits one masked line at a time on each
 * newline, and masks any trailing partial line on {@link flush}. Buffering by
 * line guarantees a secret split across two chunks is still fully visible to
 * {@link maskSecrets} before anything is emitted.
 */
export class MaskingLineBuffer {
    private buffer = '';

    constructor(
        private readonly emit: (line: string) => void,
        private readonly secrets: ReadonlyArray<string>,
    ) {}

    public push(chunk: string): void {
        this.buffer += chunk;
        let newlineIndex: number;
        while ((newlineIndex = this.buffer.indexOf('\n')) >= 0) {
            const line = this.buffer.slice(0, newlineIndex).replace(/\r$/, '');
            this.buffer = this.buffer.slice(newlineIndex + 1);
            this.emit(maskSecrets(line, this.secrets));
        }
    }

    public flush(): void {
        if (this.buffer.length > 0) {
            this.emit(maskSecrets(this.buffer, this.secrets));
            this.buffer = '';
        }
    }
}
