/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';

/**
 * Shortens a long filesystem path for display by keeping the start of the path
 * and the filename, collapsing the middle with an ellipsis
 * (e.g. `/home/user/projects/very/deep/…/config.yaml`).
 *
 * Paths at or under `maxLength` are returned unchanged. When the filename alone
 * would still exceed `maxLength`, the filename itself is middle-truncated so the
 * result never overflows a fixed-width surface such as a modal dialog.
 */
export function shortenPathMiddle(fullPath: string, maxLength = 56): string {
    if (fullPath.length <= maxLength) {
        return fullPath;
    }

    const ellipsis = '…';
    const fileName = path.basename(fullPath);

    // Degenerate case: the filename alone doesn't fit — truncate its middle so
    // the displayed text stays within maxLength.
    if (fileName.length + ellipsis.length >= maxLength) {
        const keep = Math.max(1, maxLength - ellipsis.length);
        const head = Math.ceil(keep / 2);
        const tail = keep - head;
        return fileName.slice(0, head) + ellipsis + (tail > 0 ? fileName.slice(fileName.length - tail) : '');
    }

    const headLength = maxLength - fileName.length - ellipsis.length;
    return fullPath.slice(0, headLength) + ellipsis + fileName;
}
