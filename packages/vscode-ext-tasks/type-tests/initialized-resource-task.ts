/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Example starts here.
import {
    type ResourceDefinition,
    type ResourceTrackingTask,
    Task,
    type TaskOptions,
} from '@microsoft/vscode-ext-tasks';

export class ResourceTask extends Task implements ResourceTrackingTask {
    public readonly type = 'resource-task';
    public readonly name = 'Process collection';
    private items: readonly string[] = [];

    public constructor(
        private readonly resource: ResourceDefinition,
        private readonly loadItems: (signal: AbortSignal) => Promise<readonly string[]>,
        private readonly processItems: (items: readonly string[], signal: AbortSignal) => Promise<void>,
        options?: TaskOptions,
    ) {
        super(options);
    }

    public getUsedResources(): ResourceDefinition[] {
        return [this.resource];
    }

    protected async onInitialize(signal: AbortSignal): Promise<void> {
        this.items = await this.loadItems(signal);
    }

    protected async doWork(signal: AbortSignal): Promise<void> {
        if (!signal.aborted) {
            await this.processItems(this.items, signal);
        }
    }
}
