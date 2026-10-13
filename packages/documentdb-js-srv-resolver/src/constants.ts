/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Timing constants for the SRV fallback (D0016). Kept in one place so they can be tuned from
 * `fallbackDurationMs` telemetry.
 */

/** Per-attempt timeout for a UDP query to one DNS server. */
export const FALLBACK_UDP_TIMEOUT_MS = 5_000;

/** Per-attempt timeout for a TCP query to one DNS server (after a truncated UDP reply). */
export const FALLBACK_TCP_TIMEOUT_MS = 10_000;

/**
 * Upper bound of the single shared deadline covering the SRV query, the TXT query and any TCP
 * retries. The effective deadline is `min(FALLBACK_MAX_DEADLINE_MS, connectionTimeout)` (R4).
 */
export const FALLBACK_MAX_DEADLINE_MS = 20_000;

/** Default DNS port, used when a server from `dns.getServers()` has no explicit port. */
export const DNS_DEFAULT_PORT = 53;
