/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * EXPERIMENT (dev/tnaum/quickstart-brainstorm).
 *
 * All of the Local Quick Start behaviour — Docker probing, the provisioning
 * subscription, cancellation, Advanced-option validation — extracted out of
 * {@link LocalQuickStart} so the layout prototypes can differ *only* in
 * presentation. Every prototype renders the same machine; nothing about the
 * flow, the tRPC contract, or the recovery paths changes between them.
 *
 * Ported verbatim (minus JSX) from `LocalQuickStart.tsx`; keep the two in sync
 * while the experiment runs, and collapse them once a layout is chosen.
 */

import * as l10n from '@vscode/l10n';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    type AdvancedQuickStartOptions,
    type DockerStatusResult,
    PROVISION_STAGES,
    type ProvisionStage,
    QUICK_START_PORT,
    type StageEvent,
} from '../../../../services/localQuickStart/quickStartTypes';
import { useTrpcClient } from '../../../_integration/useTrpcClient';

export type QuickStartPhase = 'loading' | 'review' | 'dockerNotReady' | 'provisioning' | 'success' | 'failed';
export type StageStatus = 'pending' | 'active' | 'done' | 'error';

export const STAGE_LABELS: Record<ProvisionStage, string> = {
    checking: l10n.t('Checking Docker'),
    pulling: l10n.t('Pulling official image'),
    creating: l10n.t('Creating container'),
    starting: l10n.t('Starting container'),
    waiting: l10n.t('Waiting for DocumentDB to accept connections'),
    done: l10n.t('Done'),
    error: l10n.t('Error'),
};

/** The stages worth showing a user; `done`/`error` are terminal bookkeeping, not steps. */
export const VISIBLE_STAGES: readonly ProvisionStage[] = ['checking', 'pulling', 'creating', 'starting', 'waiting'];

function emptyStageStatus(): Record<ProvisionStage, StageStatus> {
    return {
        checking: 'pending',
        pulling: 'pending',
        creating: 'pending',
        starting: 'pending',
        waiting: 'pending',
        done: 'pending',
        error: 'pending',
    };
}

export type AdvancedField = 'port' | 'username' | 'password' | 'tag';

export interface AdvancedState {
    readonly port: string;
    readonly username: string;
    readonly password: string;
    readonly tag: string;
    readonly loadSampleData: boolean;
    readonly setPort: (value: string) => void;
    readonly setUsername: (value: string) => void;
    readonly setPassword: (value: string) => void;
    readonly setTag: (value: string) => void;
    readonly setLoadSampleData: (value: boolean) => void;
    /** The first failing field plus its message, or undefined when the form is valid. */
    readonly validation: { field: AdvancedField; message: string } | undefined;
    /** True when any non-default value is set — drives the "Customized" badge. */
    readonly isCustomized: boolean;
}

export interface QuickStartMachine {
    readonly phase: QuickStartPhase;
    readonly docker: DockerStatusResult | undefined;
    readonly dockerReady: boolean;
    /** True when the service will reuse an existing container (credentials/image are fixed). */
    readonly isRecreate: boolean;
    readonly stageStatus: Record<ProvisionStage, StageStatus>;
    readonly activeStage: ProvisionStage | undefined;
    readonly errorMessage: string | undefined;
    readonly successMessage: string | undefined;
    readonly boundPort: number | undefined;
    readonly effectivePort: string;
    readonly elapsedLabel: string;
    readonly startingDocker: boolean;
    readonly timedOut: boolean;
    readonly advanced: AdvancedState;
    /** Live-region text for the in-flight stage; empty once a stage has errored. */
    readonly provisioningStatusMessage: string;
    readonly reloadDockerStatus: () => void;
    readonly startDockerDesktop: () => void;
    readonly start: () => void;
    readonly waitLonger: () => void;
    readonly startOver: () => void;
    readonly cancel: () => void;
    readonly backToReview: () => void;
    readonly close: () => void;
    readonly viewOutput: () => void;
    readonly openConnection: () => void;
    readonly copyConnectionString: () => void;
}

// eslint-disable-next-line no-control-regex
const CREDENTIAL_FORBIDDEN = /[\u0000-\u001f\u007f]/;

export function useQuickStartMachine(): QuickStartMachine {
    const trpcClient = useTrpcClient();

    const [phase, setPhase] = useState<QuickStartPhase>('loading');
    const [docker, setDocker] = useState<DockerStatusResult | undefined>(undefined);
    const [stageStatus, setStageStatus] = useState<Record<ProvisionStage, StageStatus>>(emptyStageStatus);
    const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
    const [successMessage, setSuccessMessage] = useState<string | undefined>(undefined);
    const [boundPort, setBoundPort] = useState<number | undefined>(undefined);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [startingDocker, setStartingDocker] = useState(false);
    const [timedOut, setTimedOut] = useState(false);

    const [advPort, setAdvPort] = useState('');
    const [advUser, setAdvUser] = useState('');
    const [advPass, setAdvPass] = useState('');
    const [advTag, setAdvTag] = useState('');
    const [advLoadSampleData, setAdvLoadSampleData] = useState(true);

    const isRecreate = docker?.willReuse === true;

    const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const advancedRef = useRef<AdvancedQuickStartOptions | undefined>(undefined);
    const isWaitLongerRef = useRef(false);
    const streamGenerationRef = useRef(0);

    const advValidation = ((): { field: AdvancedField; message: string } | undefined => {
        const port = advPort.trim();
        if (port && (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535)) {
            return { field: 'port', message: l10n.t('Port must be a whole number between 1024 and 65535.') };
        }
        if (!isRecreate) {
            const user = advUser.trim();
            const pass = advPass.trim();
            const hasUser = user.length > 0;
            const hasPass = pass.length > 0;
            if (hasUser !== hasPass) {
                return {
                    field: hasUser ? 'password' : 'username',
                    message: l10n.t('Enter both a username and a password, or leave both blank to auto-generate.'),
                };
            }
            if (user.length > 128) {
                return { field: 'username', message: l10n.t('Username must be 128 characters or fewer.') };
            }
            if (pass.length > 256) {
                return { field: 'password', message: l10n.t('Password must be 256 characters or fewer.') };
            }
            if (hasUser && CREDENTIAL_FORBIDDEN.test(user)) {
                return { field: 'username', message: l10n.t('Username must not contain control characters.') };
            }
            if (hasPass && CREDENTIAL_FORBIDDEN.test(pass)) {
                return { field: 'password', message: l10n.t('Password must not contain control characters.') };
            }
            const tag = advTag.trim();
            if (tag && (tag.length > 128 || !/^[\w][\w.-]*$/.test(tag))) {
                return {
                    field: 'tag',
                    message: l10n.t('Image tag may contain only letters, numbers, dots, dashes, and underscores.'),
                };
            }
        }
        return undefined;
    })();
    const advError = advValidation?.message;

    useEffect(() => {
        // Sync the Advanced fields into a ref (repo stale-closure pattern) so the provisioning
        // subscription reads current values. Skip building options while invalid.
        if (advError) {
            advancedRef.current = undefined;
            return;
        }
        const opts: AdvancedQuickStartOptions = {};
        if (advPort.trim()) opts.port = Number(advPort.trim());
        if (!isRecreate) {
            if (advUser.trim()) opts.username = advUser.trim();
            if (advPass.trim()) opts.password = advPass.trim();
            if (advTag.trim()) opts.imageTag = advTag.trim();
        }
        if (!advLoadSampleData) opts.loadSampleData = false;
        advancedRef.current = Object.keys(opts).length > 0 ? opts : undefined;
    }, [advPort, advUser, advPass, advTag, advLoadSampleData, advError, isRecreate]);

    const activeStage = PROVISION_STAGES.find((s) => stageStatus[s] === 'active');
    const anyStageErrored = PROVISION_STAGES.some((s) => stageStatus[s] === 'error');
    const provisioningStatusMessage = activeStage && !anyStageErrored ? l10n.t('{0}…', STAGE_LABELS[activeStage]) : '';

    const reloadDockerStatus = useCallback((): void => {
        setPhase('loading');
        void trpcClient.localQuickStart.getDockerStatus
            .query()
            .then((result) => {
                setDocker(result);
                const ready = result.readiness.cliInstalled && result.readiness.daemonReachable;
                if (ready && result.status.canResumeReadiness) {
                    setStageStatus({
                        checking: 'done',
                        pulling: 'done',
                        creating: 'done',
                        starting: 'done',
                        waiting: 'error',
                        done: 'pending',
                        error: 'pending',
                    });
                    setTimedOut(true);
                    setPhase('failed');
                } else {
                    setPhase(ready ? 'review' : 'dockerNotReady');
                }
            })
            .catch((error: unknown) => {
                setErrorMessage(error instanceof Error ? error.message : String(error));
                setPhase('dockerNotReady');
            });
    }, [trpcClient]);

    const stopTimer = useCallback((): void => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const startDockerDesktop = useCallback((): void => {
        setStartingDocker(true);
        void trpcClient.localQuickStart.startDockerDesktop
            .mutate()
            .catch(() => false)
            .then(() => {
                setTimeout(() => {
                    setStartingDocker(false);
                    reloadDockerStatus();
                }, 5000);
            });
    }, [trpcClient, reloadDockerStatus]);

    useEffect(() => {
        // The initial load intentionally sets the 'loading' phase before the async docker query.
        reloadDockerStatus();
        return () => {
            subscriptionRef.current?.unsubscribe();
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [reloadDockerStatus]);

    const runStream = useCallback(
        (
            subscribe: (handlers: {
                onData: (event: StageEvent) => void;
                onError: (error: unknown) => void;
                onComplete: () => void;
            }) => { unsubscribe: () => void },
            options?: { resetStages?: boolean },
        ): void => {
            subscriptionRef.current?.unsubscribe();
            subscriptionRef.current = null;
            const myGeneration = ++streamGenerationRef.current;

            if (options?.resetStages !== false) {
                setStageStatus(emptyStageStatus());
            }
            setErrorMessage(undefined);
            setSuccessMessage(undefined);
            setTimedOut(false);
            setElapsedMs(0);
            setPhase('provisioning');

            const startedAt = Date.now();
            timerRef.current = setInterval(() => setElapsedMs(Date.now() - startedAt), 250);

            let settled = false;
            const subscription = subscribe({
                onData(event: StageEvent) {
                    if (myGeneration !== streamGenerationRef.current) return; // superseded/cancelled stream
                    if (event.stage === 'done' && event.status === 'done') {
                        settled = true;
                        stopTimer();
                        setStageStatus((prev) => ({ ...prev, [event.stage]: event.status }));
                        setSuccessMessage(event.message);
                        setBoundPort(event.boundPort);
                        setPhase('success');
                    } else if (event.status === 'error') {
                        settled = true;
                        stopTimer();
                        setStageStatus((prev) => {
                            const next = { ...prev, [event.stage]: event.status };
                            const active = PROVISION_STAGES.find((s) => prev[s] === 'active');
                            if (active) next[active] = 'error';
                            return next;
                        });
                        setErrorMessage(event.error ?? event.message ?? l10n.t('Setup failed.'));
                        setTimedOut(event.timedOut === true);
                        setPhase('failed');
                    } else {
                        setStageStatus((prev) => ({ ...prev, [event.stage]: event.status }));
                    }
                },
                onError(error: unknown) {
                    if (myGeneration !== streamGenerationRef.current) return; // superseded/cancelled stream
                    settled = true;
                    stopTimer();
                    setErrorMessage(error instanceof Error ? error.message : String(error));
                    setTimedOut(false);
                    setPhase('failed');
                    if (subscriptionRef.current === subscription) {
                        subscriptionRef.current = null;
                    }
                },
                onComplete() {
                    if (myGeneration !== streamGenerationRef.current) return; // superseded/cancelled stream
                    if (!settled) {
                        stopTimer();
                        setPhase('review');
                    }
                    if (subscriptionRef.current === subscription) {
                        subscriptionRef.current = null;
                    }
                },
            });
            subscriptionRef.current = subscription;
        },
        [stopTimer],
    );

    const start = useCallback((): void => {
        isWaitLongerRef.current = false;
        runStream((handlers) => trpcClient.localQuickStart.startQuickStart.subscribe(advancedRef.current, handlers));
    }, [trpcClient, runStream]);

    const waitLonger = useCallback((): void => {
        isWaitLongerRef.current = true;
        setStageStatus((prev) => ({ ...prev, waiting: 'active' }));
        runStream((handlers) => trpcClient.localQuickStart.waitLonger.subscribe(undefined, handlers), {
            resetStages: false,
        });
    }, [trpcClient, runStream]);

    const startOver = useCallback((): void => {
        subscriptionRef.current?.unsubscribe();
        subscriptionRef.current = null;
        streamGenerationRef.current++;
        isWaitLongerRef.current = false;
        stopTimer();
        void trpcClient.localQuickStart.discardTimedOut
            .mutate()
            .then((discarded) => {
                if (discarded) {
                    setTimedOut(false);
                    setErrorMessage(undefined);
                    setStageStatus(emptyStageStatus());
                    setPhase('review');
                } else {
                    setTimedOut(true);
                    setPhase('failed');
                }
            })
            .catch(() => {
                setTimedOut(true);
                setPhase('failed');
            });
    }, [trpcClient, stopTimer]);

    const close = useCallback((): void => {
        void trpcClient.localQuickStart.closePanel.mutate().catch(() => undefined);
    }, [trpcClient]);

    const cancel = useCallback((): void => {
        subscriptionRef.current?.unsubscribe();
        subscriptionRef.current = null;
        streamGenerationRef.current++;
        stopTimer();
        if (isWaitLongerRef.current) {
            isWaitLongerRef.current = false;
            setTimedOut(true);
            setPhase('failed');
        } else {
            setTimedOut(false);
            setPhase('review');
        }
    }, [stopTimer]);

    const backToReview = useCallback((): void => {
        isWaitLongerRef.current = false;
        setErrorMessage(undefined);
        setTimedOut(false);
        setPhase('review');
    }, []);

    const viewOutput = useCallback((): void => {
        void trpcClient.localQuickStart.showOutput.mutate().catch(() => undefined);
    }, [trpcClient]);

    const openConnection = useCallback((): void => {
        void trpcClient.localQuickStart.openConnection.mutate().catch(() => undefined);
    }, [trpcClient]);

    const copyConnectionString = useCallback((): void => {
        void trpcClient.localQuickStart.copyConnectionString.mutate().catch(() => undefined);
    }, [trpcClient]);

    const totalSeconds = Math.floor(elapsedMs / 1000);
    const elapsedLabel = `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;

    return {
        phase,
        docker,
        dockerReady: !!docker && docker.readiness.cliInstalled && docker.readiness.daemonReachable,
        isRecreate,
        stageStatus,
        activeStage,
        errorMessage,
        successMessage,
        boundPort,
        effectivePort: advPort.trim() && !advError ? advPort.trim() : String(QUICK_START_PORT),
        elapsedLabel,
        startingDocker,
        timedOut,
        advanced: {
            port: advPort,
            username: advUser,
            password: advPass,
            tag: advTag,
            loadSampleData: advLoadSampleData,
            setPort: setAdvPort,
            setUsername: setAdvUser,
            setPassword: setAdvPass,
            setTag: setAdvTag,
            setLoadSampleData: setAdvLoadSampleData,
            validation: advValidation,
            isCustomized:
                advPort.trim().length > 0 ||
                advTag.trim().length > 0 ||
                advUser.trim().length > 0 ||
                advPass.trim().length > 0 ||
                !advLoadSampleData,
        },
        provisioningStatusMessage,
        reloadDockerStatus,
        startDockerDesktop,
        start,
        waitLonger,
        startOver,
        cancel,
        backToReview,
        close,
        viewOutput,
        openConnection,
        copyConnectionString,
    };
}
