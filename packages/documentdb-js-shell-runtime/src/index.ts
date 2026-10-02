/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Main runtime
export { DocumentDBShellRuntime } from './DocumentDBShellRuntime.js';

// Components (exposed for advanced usage and testing)
export { CommandInterceptor } from './CommandInterceptor.js';
export { DocumentDBServiceProvider, type ServiceProviderWithBus } from './DocumentDBServiceProvider.js';
export {
    HelpProvider,
    SHELL_HELP_DOCUMENT_KIND,
    type HelpSurface,
    type ShellHelpDocument,
    type ShellHelpDocumentLine,
    type ShellHelpTextSpan,
    type ShellHelpTextTone,
} from './HelpProvider.js';
export { ResultTransformer, type ShellResultLike } from './ResultTransformer.js';

// Types
export {
    type ShellEvalOptions,
    type ShellEvaluationResult,
    type ShellRuntimeCallbacks,
    type ShellRuntimeOptions,
} from './types.js';
