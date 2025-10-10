/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { openUrl } from '../../utils/openUrl';

/**
 * Opens a URL from the Help and Feedback view with telemetry tracking.
 *
 * @param context - Action context for telemetry
 * @param url - The URL to open
 */
export async function openHelpAndFeedbackUrl(context: IActionContext, url: string): Promise<void> {
    // Log the URL to telemetry
    context.telemetry.properties.url = url;
    context.telemetry.properties.source = 'helpAndFeedbackView';

    // Open the URL
    await openUrl(url);
}
