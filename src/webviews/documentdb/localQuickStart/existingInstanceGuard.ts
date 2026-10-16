/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstanceState } from '../../../services/localQuickStart/quickStartTypes';

/**
 * Which existing-instance guard the Configure step shows, if any (review §9.2 Q2).
 *
 * - `healthy` / `stopped`: the instance is usable, so setup is blocked and the user is offered the
 *   action they almost certainly meant (open it / start it).
 * - `credentialsMissing`: its data can never be opened again, so setup is allowed but forced onto
 *   the erase path, behind a warning.
 * - `undefined`: setup may run normally.
 */
export type ExistingInstanceGuard = 'healthy' | 'stopped' | 'credentialsMissing' | undefined;

/** The instance facts the guard depends on. `state` is undefined until the first status arrives. */
export interface GuardInput {
    readonly state: InstanceState | undefined;
    readonly missing?: boolean;
}

/**
 * Decide the guard from the instance's status.
 *
 * `missing` is checked BEFORE the state, and that ordering is the whole point: a container removed
 * outside VS Code is reported as `Stopped` with `missing` set, not as a state of its own. Reading
 * only the state offered a "Start" button for a container that no longer exists, which could not do
 * anything. A missing instance is not guarded at all, because recreating it is exactly what the
 * user came to the wizard for.
 */
export function getExistingInstanceGuard(status: GuardInput): ExistingInstanceGuard {
    if (status.state === InstanceState.CredentialsMissing) {
        return 'credentialsMissing';
    }
    if (status.missing) {
        return undefined;
    }
    if (status.state === InstanceState.Running) {
        return 'healthy';
    }
    return status.state === InstanceState.Stopped ? 'stopped' : undefined;
}

/** True when the guard blocks setup, so the primary action is disabled and the data choice hidden. */
export function guardBlocksSetup(guard: ExistingInstanceGuard): boolean {
    return guard === 'healthy' || guard === 'stopped';
}
