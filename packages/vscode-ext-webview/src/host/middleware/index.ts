/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Instance-agnostic middleware bodies and their adapter interfaces.
 *
 * Wire a body onto your own tRPC instance with
 * `publicProcedure.use((opts) => body(opts, adapter))`.
 */

export {
    consoleProcedureLogger,
    loggingMiddlewareBody,
    type ProcedureLogEntry,
    type ProcedureLogger,
} from './loggingMiddleware';
export { telemetryMiddlewareBody, type ProcedureTelemetry, type TelemetryRunner } from './telemetryMiddleware';
export {
    type MiddlewareResultLike,
    type ProcedureErrorLike,
    type ProcedureInvocation,
    type ProcedureType,
} from './types';
