/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { fromIni } from '@aws-sdk/credential-providers';
import { type AwsCredentialIdentityProvider } from '@aws-sdk/types';
import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import * as vscode from 'vscode';
import { type AwsProfile } from '../types';
import { abortError, AwsInteractionRequiredError, throwIfAborted } from './errors';

function parseIni(text: string): Map<string, Record<string, string>> {
    const sections = new Map<string, Record<string, string>>();
    let section: Record<string, string> | undefined;
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#') || line.startsWith(';')) {
            continue;
        }
        const header = /^\[([^\]]+)\]$/.exec(line);
        if (header) {
            section = Object.create(null) as Record<string, string>;
            sections.set(header[1].trim(), section);
        } else if (section && !/^\s/.test(raw)) {
            const separator = line.indexOf('=');
            if (separator > 0) {
                section[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
            }
        }
    }
    return sections;
}

async function readOptional(path: string): Promise<string> {
    try {
        return await readFile(path, 'utf8');
    } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
            return '';
        }
        throw error;
    }
}

export async function listAwsProfiles(): Promise<AwsProfile[]> {
    const [config, credentials] = await Promise.all([
        readOptional(process.env.AWS_CONFIG_FILE ?? join(homedir(), '.aws', 'config')),
        readOptional(process.env.AWS_SHARED_CREDENTIALS_FILE ?? join(homedir(), '.aws', 'credentials')),
    ]);
    const sections = parseIni(config);
    const profiles = new Map<string, Record<string, string>>();
    for (const [section, properties] of sections) {
        if (section === 'default') {
            profiles.set(section, properties);
        } else if (section.startsWith('profile ')) {
            profiles.set(section.slice(8).trim(), properties);
        }
    }
    for (const [name, properties] of parseIni(credentials)) {
        profiles.set(name, { ...profiles.get(name), ...properties });
    }
    return Array.from(profiles, ([name, properties]): AwsProfile => {
        const session = sections.get(`sso-session ${properties.sso_session ?? ''}`);
        let kind = vscode.l10n.t('Profile');
        if (properties.sso_session || properties.sso_start_url) {
            kind = 'SSO';
        } else if (properties.role_arn) {
            kind = vscode.l10n.t('Assume role');
        } else if (properties.credential_process) {
            kind = 'credential_process';
        } else if (properties.web_identity_token_file) {
            kind = vscode.l10n.t('Web identity');
        } else if (properties.aws_session_token) {
            kind = vscode.l10n.t('Temporary credentials');
        } else if (properties.aws_access_key_id) {
            kind = vscode.l10n.t('Access key');
        }
        return {
            name,
            kind,
            startUrl: properties.sso_start_url ?? session?.sso_start_url,
            ssoRegion: properties.sso_region ?? session?.sso_region,
            accountId: properties.sso_account_id,
            roleName: properties.sso_role_name,
        };
    }).sort((left, right) => left.name.localeCompare(right.name));
}

export function profileProvider(
    profile: string,
    region: string,
    interactive: boolean,
    signal?: AbortSignal,
): AwsCredentialIdentityProvider {
    return fromIni({
        profile,
        clientConfig: { region },
        mfaCodeProvider: async (): Promise<string> => {
            throwIfAborted(signal);
            if (!interactive) {
                throw new AwsInteractionRequiredError();
            }
            const cancellation = new vscode.CancellationTokenSource();
            const onAbort = (): void => cancellation.cancel();
            signal?.addEventListener('abort', onAbort, { once: true });
            try {
                const code = await vscode.window.showInputBox({
                    title: vscode.l10n.t('AWS profile verification'),
                    prompt: vscode.l10n.t('Enter the MFA code for this AWS profile.'),
                    password: true,
                    ignoreFocusOut: true,
                    validateInput: (value: string): string | undefined =>
                        /^\d{6}$/.test(value.trim()) ? undefined : vscode.l10n.t('Enter a six-digit MFA code.'),
                }, cancellation.token);
                throwIfAborted(signal);
                if (!code) {
                    throw abortError();
                }
                return code.trim();
            } finally {
                signal?.removeEventListener('abort', onAbort);
                cancellation.dispose();
            }
        },
    });
}
