/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AIIndexRecommendation } from '../../../../services/ai/types';

/**
 * Best-effort Copilot token-usage measurements, mirrored here in a
 * webview-safe shape so the streaming event union does not need to import
 * the server-only `CopilotTokenUsage` definition from
 * `src/services/copilotService.ts`. Field semantics match the original
 * 1:1.
 */
export interface QueryInsightsStreamUsage {
    promptTokens?: number;
    responseTokens?: number;
    totalTokens?: number;
    maxInputTokens?: number;
    promptUtilizationPct?: number;
}

/**
 * Domain-language events emitted by the Stage 3 streaming subscription
 * (`collectionView.queryInsights.streamStage3`). The webview maps these
 * events to its UI elements — the protocol intentionally speaks in domain
 * terms (`status`, `summary`, `recommendation`, …) and never in UI terms
 * (`card`, `slot`, …), per plan D7.
 *
 * Event lifecycle (target shape after WI-8):
 *  - `status` events fire as the stream progresses (pre-first-fragment
 *    "connecting", per-fragment "receiving", post-stream "parsing").
 *  - `summary` / `educational` events carry **cumulative** markdown for
 *    the `analysis` and `educationalContent` JSON keys as they grow, with
 *    `complete: false` until the value's closing `"` is observed.
 *  - `recommendationStarted` fires the moment a new improvement object
 *    opens in the stream (UI renders a shell); the matching
 *    `recommendation` carries the fully parsed domain object (UI fills
 *    the shell). `index` is monotonic per stream.
 *  - `complete` is the terminal event, carrying model + token metadata
 *    that the buffered procedure used to return inline.
 *
 * WI-5 deliberately emits only the coarse subset (`status` + the
 * transitional `result` event). The parser added in WI-7 produces the
 * structured `summary` / `educational` / `recommendationStarted` /
 * `recommendation` events; WI-8 wires the parser into
 * the subscription, replacing `result` with the structured events plus a
 * final `complete`.
 */
export type QueryInsightsStreamEvent =
    | {
          type: 'status';
          /**
           * Coarse lifecycle phase. The subscription emits `connecting`
           * before the LLM call returns its first fragment, `receiving`
           * while fragments are arriving, and `parsing` once the stream
           * has finished and the final JSON is being processed.
           */
          phase: 'connecting' | 'receiving' | 'parsing';
          /** Wall-clock time since the subscription started, in milliseconds. */
          elapsedMs: number;
          /** Cumulative number of characters received from the LLM so far. */
          charsReceived?: number;
      }
    | {
          /**
           * Cumulative markdown for the `analysis` JSON key. Emitted at
           * line boundaries (`\n`) while the value is growing
           * (`complete: false`) and once more when the value's closing
           * `"` is observed (`complete: true`).
           */
          type: 'summary';
          markdown: string;
          complete: boolean;
      }
    | {
          /**
           * Cumulative markdown for the `educationalContent` JSON key.
           * Same emission rules as `summary`.
           */
          type: 'educational';
          markdown: string;
          complete: boolean;
      }
    | {
          /**
           * A new improvement object opened in the `improvements[]`
           * stream. The webview uses this to render an empty
           * recommendation shell (per D3/D5/D11) before the fields fill
           * in. `index` is the position within the array (0-based,
           * monotonic per stream).
           */
          type: 'recommendationStarted';
          index: number;
      }
    | {
          /**
           * A completed improvement object, fully parsed. The webview
           * uses `index` to fill the matching shell created by the
           * earlier `recommendationStarted`.
           */
          type: 'recommendation';
          index: number;
          recommendation: AIIndexRecommendation;
      }
    | {
          /**
           * Terminal event carrying model + token metadata that the
           * buffered Stage 3 procedure used to return inline. Always the
           * last event of a successful subscription run.
           */
          type: 'complete';
          modelDisplayName?: string;
          modelId?: string;
          modelFamily?: string;
          usage?: QueryInsightsStreamUsage;
      };
