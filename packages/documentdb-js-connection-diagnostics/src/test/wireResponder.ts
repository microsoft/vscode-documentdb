/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deserialize, serialize } from 'bson';

import { type Duplex } from 'node:stream';

export interface WireRequest {
    readonly requestId: number;
    readonly opcode: number;
    readonly flags: number;
    readonly namespace?: string;
    readonly numberToSkip?: number;
    readonly numberToReturn?: number;
    readonly kind?: number;
    readonly document: Record<string, unknown>;
}

export function replyFrame(
    requestId: number,
    document: Readonly<Record<string, unknown>>,
    opcode: 1 | 2013 = 1,
    checksum = false,
): Buffer {
    const bson = serialize(document);
    const prefix = Buffer.alloc(opcode === 1 ? 36 : 21);
    prefix.writeInt32LE(prefix.length + bson.length + (checksum ? 4 : 0), 0);
    prefix.writeInt32LE(42, 4);
    prefix.writeInt32LE(requestId, 8);
    prefix.writeInt32LE(opcode, 12);
    if (opcode === 1) {
        prefix.writeInt32LE(1, 32);
    } else if (checksum) {
        prefix.writeUInt32LE(1, 16);
    }
    return Buffer.concat([prefix, bson, ...(checksum ? [Buffer.alloc(4)] : [])]);
}

export function wireResponder(
    socket: Duplex,
    respond: (request: WireRequest, socket: Duplex) => void,
    requests: WireRequest[],
): void {
    let pending = Buffer.alloc(0);
    socket.on('error', (): void => {});
    socket.on('data', (chunk: Buffer): void => {
        pending = Buffer.concat([pending, chunk]);
        if (pending.length < 16 || pending.length < pending.readInt32LE(0)) {
            return;
        }
        const frame = pending.subarray(0, pending.readInt32LE(0));
        const opcode = frame.readInt32LE(12);
        let start = 21;
        let namespace: string | undefined;
        if (opcode === 2004) {
            const end = frame.indexOf(0, 20);
            namespace = frame.subarray(20, end).toString();
            start = end + 9;
        }
        const request: WireRequest = {
            requestId: frame.readInt32LE(4),
            opcode,
            flags: frame.readInt32LE(16),
            ...(namespace === undefined
                ? { kind: frame[20] }
                : {
                      namespace,
                      numberToSkip: frame.readInt32LE(start - 8),
                      numberToReturn: frame.readInt32LE(start - 4),
                  }),
            document: deserialize(frame.subarray(start)),
        };
        requests.push(request);
        respond(request, socket);
    });
}

export async function writeReply(
    socket: Duplex,
    frame: Buffer,
    options: { fragment?: boolean; trailing?: Buffer } = {},
): Promise<void> {
    if (options.fragment) {
        for (const byte of frame) {
            if (socket.destroyed) {
                return;
            }
            socket.write(Buffer.from([byte]));
            await new Promise<void>((resolve): void => {
                setImmediate(resolve);
            });
        }
    } else {
        socket.write(Buffer.concat([frame, options.trailing ?? Buffer.alloc(0)]));
    }
}
