/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Example starts here.
import { Task } from '@microsoft/vscode-ext-tasks';

export class ExampleTask extends Task {
    public readonly type = 'example';
    public readonly name = 'Process items';

    public constructor(
        private readonly items: readonly string[],
        private readonly processItem: (item: string, signal: AbortSignal) => Promise<void>,
    ) {
        super();
    }

    protected async doWork(signal: AbortSignal): Promise<void> {
        for (const [index, item] of this.items.entries()) {
            if (signal.aborted) {
                return;
            }
            await this.processItem(item, signal);
            this.updateProgress(((index + 1) / this.items.length) * 100, `Processed ${index + 1} items`);
        }
    }
}
