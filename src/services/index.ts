/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Task Engine exports
export { Task, TaskBase, TaskStatus } from './TaskEngine';

// Copy-Paste interfaces and types
export {
    DocumentDetails,
    DocumentReader,
    DocumentWriter,
    DocumentWriterOptions,
    BulkWriteResult,
    ConflictResolutionStrategy,
    CopyPasteConfig,
} from './CopyPasteInterfaces';

// Copy-Paste task implementation
export { CopyPasteCollectionTask } from './CopyPasteCollectionTask';