/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export { type BaseRouterContext, type TelemetryContext } from '../shared/BaseRouterContext';
export { TypedEventSink, type DiscriminatedEvent, type EventOfType, type UntypedEventEmitter } from '../shared/TypedEventSink';
export {
    createCallerFactory,
    createMiddleware,
    publicProcedure,
    publicProcedureWithTelemetry,
    router,
    type AnyRouter,
    type WithTelemetry,
} from './trpc';
export { WebviewController, type WebviewControllerOptions, type WebviewSourceLayout } from './WebviewController';
