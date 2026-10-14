/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type SurveyPolicyConfig } from './surveyTypes';

/**
 * Shared kill switch (D0021). Enabled in all extension modes; ordinary permission and
 * eligibility rules still apply.
 */
export const SURVEY_ENABLED = true;

/** The one external survey (D0002). Never append identifiers or a rating to it. */
export const SURVEY_FORM_URL = 'https://aka.ms/DocumentDBSurvey';

/** D0004. */
export const REQUIRED_ACTIVE_DAYS = 3;
/** D0005. */
export const ASK_LATER_COOLDOWN_DAYS = 14;
/** D0007: its own constant, deliberately equal to the "Ask me later" cooldown. */
export const DISMISSED_COOLDOWN_DAYS = 14;
/** D0006. */
export const OPENED_COOLDOWN_DAYS = 180;
/** D0008: emergency throttle, kept at 1.0 at launch. */
export const SAMPLING_FRACTION = 1.0;

/** Upper bound on reported `survey.openForm` attempts per invitation or per command call. */
export const MAX_OPEN_FORM_TELEMETRY_ATTEMPTS = 3;

export const DEFAULT_SURVEY_POLICY_CONFIG: SurveyPolicyConfig = {
    campaignId: 'documentdb-satisfaction-1',
    policyVersion: '1',
    requiredActiveDays: REQUIRED_ACTIVE_DAYS,
    samplingFraction: SAMPLING_FRACTION,
    askLaterCooldownDays: ASK_LATER_COOLDOWN_DAYS,
    dismissedCooldownDays: DISMISSED_COOLDOWN_DAYS,
    openedCooldownDays: OPENED_COOLDOWN_DAYS,
};

/** `globalState` key of the versioned `SurveyPersistedState`. */
export const SURVEY_STATE_KEY = 'documentdb.survey.state';

/**
 * Keys written by the old survey implementation. Never read (D0011); deleted after the new
 * state has been saved successfully.
 */
export const LEGACY_SURVEY_STATE_KEYS: readonly string[] = [
    'ms-azuretools.vscode-documentdb.survey/sessionCount',
    'ms-azuretools.vscode-documentdb.survey/lastSessionDate',
    'ms-azuretools.vscode-documentdb.survey/skipVersion',
    'ms-azuretools.vscode-documentdb.survey/surveyTaken',
    'ms-azuretools.vscode-documentdb.survey/surveyOptOut',
];
