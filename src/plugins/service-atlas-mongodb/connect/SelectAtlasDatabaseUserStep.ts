/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { AuthMethodId } from '../../../documentdb/auth/AuthMethod';
import { type AuthenticateWizardContext } from '../../../documentdb/wizards/authenticate/AuthenticateWizardContext';
import { atlasTrace, atlasWarn } from '../atlasTrace';
import { type AtlasDatabaseUserCandidate } from './atlasDatabaseUsers';

/** How long the database-user lookup is allowed to take before the wizard gives up on it. */
const USER_LOOKUP_TIMEOUT_MS = 8_000;

/** Loads the database users that apply to one cluster. */
export type AtlasDatabaseUserLoader = (signal: AbortSignal) => Promise<AtlasDatabaseUserCandidate[]>;

interface UserQuickPickItem extends vscode.QuickPickItem {
    readonly candidate?: AtlasDatabaseUserCandidate;
    readonly isCustomOption?: boolean;
}

/**
 * Offers the cluster's known database users instead of an empty username box.
 *
 * Atlas already knows which users exist, so making somebody retype one from memory is busywork,
 * and a typo here only surfaces later as an authentication failure. The lookup needs just
 * `Project Read Only`, which the credential that discovered the cluster already has.
 *
 * The step is unobtrusive and never becomes a dead end:
 *
 * - **Several users** are offered as a pick list, with **Enter a username** first so a user that
 *   is not in the list is always one keystroke away.
 * - **Exactly one usable user and nothing else** skips the list and simply prefills the normal
 *   username prompt, which stays editable.
 * - **No users, no permission, a slow server or any other failure** skips this step silently and
 *   leaves the normal username prompt exactly as it was. A convenience must never block sign-in.
 *
 * Users that authenticate through X.509, AWS IAM, LDAP or OIDC are listed under their own heading
 * rather than hidden. The connect flow has only a username and a password to offer, so it cannot
 * use them, but hiding them would answer "my username is missing" with silence when the honest
 * answer is "it is there, and its method is not supported yet". Selecting one says so and returns
 * to the list.
 *
 * The lookup runs in `configureBeforePrompt`, the only hook that runs before the wizard asks
 * whether to prompt, so its outcome can pick between the three shapes above. It is bounded by a
 * timeout and reports progress in the status bar, because a slow Atlas response must not leave
 * the wizard looking frozen between steps.
 */
export class SelectAtlasDatabaseUserStep extends AzureWizardPromptStep<AuthenticateWizardContext> {
    private candidates: AtlasDatabaseUserCandidate[] = [];

    constructor(
        private readonly loadUsers: AtlasDatabaseUserLoader,
        private readonly clusterName: string,
    ) {
        super();
    }

    public async configureBeforePrompt(context: AuthenticateWizardContext): Promise<void> {
        this.candidates = [];

        if (!this.isNativeAuthPending(context)) {
            return;
        }

        const users = await this.loadUsersWithProgress(context);

        if (users.length === 0) {
            context.telemetry.properties.atlasDatabaseUserSource ??= 'unavailable';
            return;
        }

        if (users.length === 1 && users[0].supported) {
            // A single usable user does not deserve a pick list. Prefilling the normal prompt keeps
            // the value editable, which matters because the one user Atlas knows about is not
            // necessarily the one this person wants to connect as.
            context.adminUserName = users[0].username;
            context.telemetry.properties.atlasDatabaseUserSource = 'prefilled';
            atlasTrace(`cluster "${this.clusterName}": one database user found, prefilling the username prompt`);
            return;
        }

        this.candidates = users;
        context.telemetry.measurements.atlasDatabaseUserCount = users.length;
        context.telemetry.measurements.atlasDatabaseUserUnsupportedCount = users.filter(
            (user) => !user.supported,
        ).length;
    }

    public async prompt(context: AuthenticateWizardContext): Promise<void> {
        // Selecting an unsupported user explains why and comes back here, so the list stays the
        // single place where this decision is made.
        for (;;) {
            const selected = await context.ui.showQuickPick(this.buildItems(), {
                stepName: 'selectAtlasDatabaseUser',
                placeHolder: l10n.t('Select a database user for "{cluster}"', { cluster: this.clusterName }),
                matchOnDetail: true,
                suppressPersistence: true,
            });

            if (selected.isCustomOption || !selected.candidate) {
                context.telemetry.properties.atlasDatabaseUserSource = 'custom';
                return;
            }

            if (!selected.candidate.supported) {
                context.telemetry.properties.atlasDatabaseUserUnsupportedPicked = 'true';
                await this.explainUnsupported(context, selected.candidate);
                continue;
            }

            // Mirrors what ProvideUserNameStep records, so that step is skipped from here on.
            context.nativeAuthConfig = {
                connectionUser: selected.candidate.username,
                connectionPassword: context.nativeAuthConfig?.connectionPassword ?? context.password ?? '',
            };
            context.selectedUserName = selected.candidate.username;
            context.valuesToMask.push(selected.candidate.username);
            context.isUserNameUpdated = true;
            context.telemetry.properties.atlasDatabaseUserSource = 'picked';
            return;
        }
    }

    public shouldPrompt(context: AuthenticateWizardContext): boolean {
        return this.isNativeAuthPending(context) && this.candidates.length > 0;
    }

    /**
     * Builds the list: the manual escape hatch first, then the users we can sign in as, then the
     * ones we cannot. The headings carry the explanation once instead of repeating it on every
     * row, which leaves the description column free to name the method.
     */
    private buildItems(): UserQuickPickItem[] {
        const supported = this.candidates.filter((candidate) => candidate.supported);
        const unsupported = this.candidates.filter((candidate) => !candidate.supported);

        const items: UserQuickPickItem[] = [
            {
                label: l10n.t('Enter a username'),
                detail: l10n.t('Type a username that is not in this list'),
                iconPath: new vscode.ThemeIcon('edit'),
                isCustomOption: true,
            },
        ];

        if (supported.length > 0) {
            items.push({ label: l10n.t('Username and password (SCRAM)'), kind: vscode.QuickPickItemKind.Separator });
            items.push(
                ...supported.map((candidate) => ({
                    label: candidate.username,
                    iconPath: new vscode.ThemeIcon('account'),
                    candidate,
                })),
            );
        }

        if (unsupported.length > 0) {
            items.push({ label: l10n.t('Not supported yet'), kind: vscode.QuickPickItemKind.Separator });
            items.push(
                ...unsupported.map((candidate) => ({
                    label: candidate.username,
                    description: candidate.authMethodLabel,
                    iconPath: new vscode.ThemeIcon('circle-slash'),
                    candidate,
                })),
            );
        }

        return items;
    }

    private async explainUnsupported(
        context: AuthenticateWizardContext,
        candidate: AtlasDatabaseUserCandidate,
    ): Promise<void> {
        try {
            await context.ui.showWarningMessage(
                l10n.t('Authentication method not supported'),
                {
                    modal: true,
                    detail:
                        l10n.t('"{user}" signs in with {method}.', {
                            user: candidate.username,
                            method: candidate.authMethodLabel,
                        }) +
                        '\n' +
                        l10n.t('This extension can only connect with a username and a password.'),
                },
                { title: l10n.t('Back to the list') },
            );
        } catch (error) {
            // Dismissing a purely informational modal must not tear down the sign-in flow. Both
            // answers mean the same thing here, so either one returns to the list; the quick pick
            // itself remains the way to cancel.
            if (!(error instanceof UserCancelledError)) {
                throw error;
            }
        }
    }

    /** True while the wizard still needs a username for native authentication. */
    private isNativeAuthPending(context: AuthenticateWizardContext): boolean {
        if (context.selectedUserName !== undefined) {
            return false;
        }

        return context.availableAuthMethods ? context.selectedAuthMethod === AuthMethodId.NativeAuth : true;
    }

    /**
     * Runs the lookup with a status-bar progress message and a hard timeout, and turns every
     * failure into an empty list. Losing the convenience is acceptable; blocking sign-in is not.
     */
    private async loadUsersWithProgress(context: AuthenticateWizardContext): Promise<AtlasDatabaseUserCandidate[]> {
        try {
            return await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Window,
                    title: l10n.t('Loading database users for "{cluster}"…', { cluster: this.clusterName }),
                },
                async () => this.loadUsers(AbortSignal.timeout(USER_LOOKUP_TIMEOUT_MS)),
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            context.telemetry.properties.atlasDatabaseUserSource = 'failed';
            context.telemetry.properties.atlasDatabaseUserLookupError = error instanceof Error ? error.name : 'unknown';
            atlasWarn(`cluster "${this.clusterName}": could not list database users (${message}); asking for one`);
            return [];
        }
    }
}
