/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type QueryInsightsStage3Response } from './queryInsights';

/**
 * Domain-language events emitted by the Stage 3 streaming subscription
 * (`collectionView.queryInsights.streamStage3`). The webview maps these
 * events to its UI elements — the protocol intentionally speaks in domain
 * terms (`status`, `result`, …) and never in UI terms (`card`, `slot`, …),
 * per plan D7.
 *
 * WI-5 only emits the coarse subset (`status` for pre-stream / in-stream
 * progress, and `result` once at completion carrying the same payload the
 * existing buffered `getQueryInsightsStage3` returns). WI-8 will extend
 * the union with the structured `summary` / `educational` /
 * `recommendationStarted` / `recommendation` / `verification` / `complete`
 * events fed by the incremental parser added in WI-7.
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
          type: 'result';
          /**
           * Final transformed payload, identical in shape and content to
           * what `getQueryInsightsStage3.query(...)` returns today. WI-8
           * will replace this single-payload event with per-domain events.
           */
          data: QueryInsightsStage3Response;
      };
