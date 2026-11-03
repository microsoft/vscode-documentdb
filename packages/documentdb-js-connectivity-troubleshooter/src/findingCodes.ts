/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const builtInFindingCodes = [
    'check.timeout',
    'env.proxyConfigured',
    'env.caresRejectsCompressedSrv',
    'cs.unparseable',
    'cs.srvWithPort',
    'cs.srvMultipleHosts',
    'cs.unknownOption',
    'cs.optionIgnoredByDriver',
    'cs.conflictingTlsOptions',
    'cs.tlsVerificationDisabled',
    'cs.directConnectionWithMultipleHosts',
    'cs.unencodedReservedCharacter',
    'cs.authSourceUnusual',
    'cs.compressorUnavailable',
    'srv.notFound',
    'srv.compressedReplyRejected',
    'srv.txtUnsupportedOption',
    'srv.targetOutsideDomain',
    'dns.notFound',
    'dns.temporaryFailure',
    'dns.resolversDisagree',
    'dns.privateEndpoint',
    'dns.privateEndpointPublicAddress',
    'dns.loopback',
    'tcp.refused',
    'tcp.timeout',
    'tcp.unreachable',
    'tcp.reset',
    'tls.notTlsServer',
    'tls.handshakeRejectedByServer',
    'tls.selfSigned',
    'tls.untrustedIssuer',
    'tls.hostnameMismatch',
    'tls.expired',
    'tls.notYetValid',
    'tls.verificationBypassed',
    'hello.noReply',
    'hello.notWireProtocol',
    'hello.closedWithoutReply',
    'hello.inconclusive',
    'hello.mechanismNotOffered',
    'hello.compressorUnavailable',
    'hello.clockOffset',
] as const;

export type BuiltInFindingCode = (typeof builtInFindingCodes)[number];

export const skipReasons = [
    'notApplicable',
    'inputUnavailable',
    'dependencyFailed',
    'dependencySkipped',
    'runTimeoutExceeded',
] as const;

export type SkipReason = (typeof skipReasons)[number];

export function isBuiltInFindingCode(value: string): value is BuiltInFindingCode {
    return builtInFindingCodes.some((code): boolean => code === value);
}
