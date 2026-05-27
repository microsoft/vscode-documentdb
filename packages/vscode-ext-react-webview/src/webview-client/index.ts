/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export { errorLink, type ErrorHandler } from './errorLink';
export { useConfiguration } from './useConfiguration';
export { useTrpcClient, type TrpcClient, type UseTrpcClientOptions } from './useTrpcClient';
export {
    vscodeLink,
    type VSCodeLinkOptions,
    type VsCodeLinkRequestMessage,
    type VsCodeLinkResponseMessage,
} from './vscodeLink';
export { WebviewContext, WithWebviewContext, type WebviewContextValue, type WebviewState } from './WebviewContext';
