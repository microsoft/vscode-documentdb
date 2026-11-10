/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BlockList, isIP } from 'node:net';

export type AddressClass = 'public' | 'private' | 'loopback' | 'linkLocal';

export interface Address {
    readonly address: string;
    readonly family: 4 | 6;
}

interface AddressFact extends Address {
    readonly class: AddressClass | undefined;
}

function ranges(subnets: readonly [string, number][]): BlockList {
    const list = new BlockList();
    for (const [address, prefix] of subnets) {
        list.addSubnet(address, prefix, isIP(address) === 4 ? 'ipv4' : 'ipv6');
    }
    return list;
}

const loopback = ranges([
    ['127.0.0.0', 8],
    ['::1', 128],
]);
const linkLocal = ranges([
    ['169.254.0.0', 16],
    ['fe80::', 10],
]);
const privateAddresses = ranges([
    ['10.0.0.0', 8],
    ['172.16.0.0', 12],
    ['192.168.0.0', 16],
    ['100.64.0.0', 10],
    ['fc00::', 7],
]);

export function addressFact(address: Address): AddressFact {
    if (isIP(address.address) !== address.family) {
        return { address: address.address, family: address.family, class: undefined };
    }
    const family = address.family === 4 ? 'ipv4' : 'ipv6';
    let classification: AddressClass = 'public';
    if (loopback.check(address.address, family)) {
        classification = 'loopback';
    } else if (linkLocal.check(address.address, family)) {
        classification = 'linkLocal';
    } else if (privateAddresses.check(address.address, family)) {
        classification = 'private';
    }
    return { address: address.address, family: address.family, class: classification };
}
