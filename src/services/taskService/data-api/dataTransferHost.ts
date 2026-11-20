/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TaskLogger } from '../taskHost';

export interface DataTransferStrings {
    keepAliveTimeoutExceeded: string;
    failedAfterAttempts: (attempts: string) => string;
    writeOperationFailed: (message: string) => string;
    unknownError: string;
    inserted: (count: string) => string;
    skipped: (count: string) => string;
    replaced: (count: string) => string;
    created: (count: string) => string;
}

export const defaultDataTransferStrings: DataTransferStrings = {
    keepAliveTimeoutExceeded: 'Keep-alive timeout exceeded',
    failedAfterAttempts: (attempts: string): string => `Failed to complete operation after ${attempts} attempts`,
    writeOperationFailed: (message: string): string => `Write operation failed: ${message}`,
    unknownError: 'Unknown error',
    inserted: (count: string): string => `${count} inserted`,
    skipped: (count: string): string => `${count} skipped`,
    replaced: (count: string): string => `${count} replaced`,
    created: (count: string): string => `${count} created`,
};

export interface DataTransferOptions {
    logger?: TaskLogger;
    strings?: Partial<DataTransferStrings>;
}

export const noopDataTransferLogger: TaskLogger = {
    appendLine: (): void => {},
    trace: (): void => {},
    debug: (): void => {},
    info: (): void => {},
    warn: (): void => {},
    error: (): void => {},
};
