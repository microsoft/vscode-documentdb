/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare global {
    declare module '*.ejs' {
        const template = <T>(data: T): string => '';
        export default template;
    }
}

// Stylesheets are side-effect imports that Vite compiles. TypeScript 6 checks that side-effect imports
// resolve (`noUncheckedSideEffectImports`), so declare them as modules without exports.
declare module '*.scss' {}
