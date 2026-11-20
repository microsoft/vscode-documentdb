/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { ConflictResolutionStrategy, type EnsureTargetExistsResult, type ErrorType } from '../types';
import { documentDbSupportedConflictStrategies } from './DocumentDbStreamingWriter';
import { StreamingDocumentWriter } from './StreamingDocumentWriter';

class TestStreamingWriter extends StreamingDocumentWriter {
    constructor() {
        super('database', 'collection');
    }

    public override async ensureTargetExists(): Promise<EnsureTargetExistsResult> {
        return { targetWasCreated: false };
    }

    protected override writeBatch(): never {
        throw new Error('Not implemented');
    }

    protected override classifyError(): ErrorType {
        return 'other';
    }

    protected override extractPartialProgress(): undefined {
        return undefined;
    }
}

describe('supported conflict strategies', () => {
    it('defaults to all four strategies and declares all four for DocumentDB', () => {
        const strategies = [
            ConflictResolutionStrategy.Abort,
            ConflictResolutionStrategy.Skip,
            ConflictResolutionStrategy.Overwrite,
            ConflictResolutionStrategy.GenerateNewIds,
        ];

        expect(new TestStreamingWriter().supportedConflictStrategies).toEqual(strategies);
        expect(documentDbSupportedConflictStrategies).toEqual(strategies);
    });
});
