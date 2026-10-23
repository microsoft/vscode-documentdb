/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { entraErrorRules } from './entraErrorRules';

export interface EntraErrorClassification {
    readonly ruleId: string;
    readonly code?: string;
    readonly brokered: boolean;
}

const PREAUTHORIZATION_PHRASE = 'must be configured via preauthorization';

export function classifyEntraError(text: string): EntraErrorClassification | undefined {
    const brokered = text.includes('platform_broker_error');
    if (!text.includes('AADSTS') && !brokered && !text.includes(PREAUTHORIZATION_PHRASE)) {
        return undefined;
    }

    const codes = Array.from(text.matchAll(/AADSTS(\d{5,7})/g), (match): string => match[1]);
    for (const rule of entraErrorRules) {
        const code = rule.aadsts?.find((candidate): boolean => codes.includes(candidate));
        if (code) {
            return { ruleId: rule.id, code, brokered };
        }
    }

    const decoded = text.replace(/&amp;#39;|&#39;/g, "'");
    if (decoded.includes(PREAUTHORIZATION_PHRASE)) {
        return { ruleId: 'firstPartyPreauthorization', code: '65002', brokered };
    }

    const msalRule = entraErrorRules.find((rule): boolean => !!rule.msal?.some((code): boolean => text.includes(code)));
    if (msalRule) {
        return { ruleId: msalRule.id, brokered };
    }

    if (codes.length > 0) {
        return { ruleId: 'unknownAadsts', code: codes[0], brokered };
    }
    return undefined;
}
