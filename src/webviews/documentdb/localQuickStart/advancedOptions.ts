/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type AdvancedQuickStartOptions,
    QUICK_START_DEFAULT_TAG,
} from '../../../services/localQuickStart/quickStartTypes';

/** The port the Configure summary shows and setup binds: the typed one, or the suggestion when the field is empty. */
export function getEffectivePort(portField: string, suggestedPort: number): string {
    return portField.trim() || String(suggestedPort);
}

/** The options the Configure step sends to `startQuickStart`. Only call it once the settings are valid. */
export function buildAdvancedOptions(settings: {
    readonly port: string;
    readonly suggestedPort: number;
    readonly username: string;
    readonly password: string;
    readonly imageTag: string;
    readonly loadSampleData: boolean;
    readonly isRecreate: boolean;
    readonly useCustomCredentials: boolean;
    readonly startFresh: boolean;
}): AdvancedQuickStartOptions {
    // The port is ALWAYS sent (review L3): the service binds exactly the port the user was shown
    // rather than relocating on a conflict. An empty field shows the suggested port, and leaving it
    // out would make the service bind the default instead, which may be the busy one.
    const options: AdvancedQuickStartOptions = {
        port: Number(getEffectivePort(settings.port, settings.suggestedPort)),
    };
    // Credentials and image tag are ignored by the service when reusing an existing instance, so
    // don't send them (the fields are hidden in that case anyway). Credentials go exactly as
    // typed: validation rejects the whitespace that trimming used to remove silently.
    if (!settings.isRecreate) {
        if (settings.useCustomCredentials && settings.username) options.username = settings.username;
        if (settings.useCustomCredentials && settings.password) options.password = settings.password;
        const tag = settings.imageTag.trim();
        if (tag && tag !== QUICK_START_DEFAULT_TAG) options.imageTag = tag;
    }
    if (!settings.loadSampleData) options.loadSampleData = false;
    // The recreate-vs-fresh decision is sent EXPLICITLY (review M4): the service no longer
    // infers it from the presence of stored credentials, so nothing can go stale between the
    // choice the user was shown and the volume the provision drops.
    if (settings.startFresh) options.startFresh = true;
    return options;
}
