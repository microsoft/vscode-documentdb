/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Main runtime
export { DocumentDBShellRuntime } from './DocumentDBShellRuntime';

// Components (exposed for advanced usage and testing)
export { CommandInterceptor } from './CommandInterceptor';
export { DocumentDBServiceProvider, type ServiceProviderWithBus } from './DocumentDBServiceProvider';
export {
    HelpProvider,
    SHELL_HELP_DOCUMENT_KIND,
    type HelpSurface,
    type ShellHelpDocument,
    type ShellHelpDocumentLine,
    type ShellHelpTextSpan,
    type ShellHelpTextTone,
} from './HelpProvider';
export { ResultTransformer, type ShellResultLike } from './ResultTransformer';

// Types
export {
    type ShellEvalOptions,
    type ShellEvaluationResult,
    type ShellRuntimeCallbacks,
    type ShellRuntimeOptions,
} from './types';
