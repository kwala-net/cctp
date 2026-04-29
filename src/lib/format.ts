import { keccak256, decodeAbiParameters } from 'viem';
import type { TransactionReceipt, Hex } from 'viem';

export function addressToBytes32(addr: `0x${string}`): `0x${string}` {
  return `0x${addr.slice(2).padStart(64, '0')}` as `0x${string}`;
}

// keccak256("MessageSent(bytes)") — the canonical event signature topic
const MESSAGE_SENT_SIG = keccak256(
  new TextEncoder().encode('MessageSent(bytes)')
) as Hex;

export function parseMessageSentLog(
  receipt: TransactionReceipt,
  messageTransmitterAddr: `0x${string}`
): { messageBytes: Hex; messageHash: Hex } | null {
  const normalizedAddr = messageTransmitterAddr.toLowerCase();
  for (const log of receipt.logs) {
    if (
      log.address.toLowerCase() === normalizedAddr &&
      log.topics[0] === MESSAGE_SENT_SIG
    ) {
      // data is ABI-encoded bytes (offset + length + content)
      const [messageBytes] = decodeAbiParameters(
        [{ name: 'message', type: 'bytes' }],
        log.data
      );
      const hex = messageBytes as Hex;
      return {
        messageBytes: hex,
        messageHash: keccak256(hex),
      };
    }
  }
  return null;
}

// V2 message header layout (148 bytes total before burn body):
// 4   bytes: version
// 4   bytes: sourceDomain
// 4   bytes: destinationDomain
// 8   bytes: nonce
// 32  bytes: sender
// 32  bytes: recipient
// 32  bytes: destinationCaller
// 4   bytes: minFinalityThreshold
// 4   bytes: finalityThresholdExecuted
// rest: messageBody
//
// Burn body layout:
// 32 bytes: burnToken  (address padded)
// 32 bytes: mintRecipient (address padded)
// 32 bytes: amount
// 32 bytes: messageSender
// 32 bytes: maxFee
// 32 bytes: feeExecuted
// 32 bytes: expirationBlock
// rest: hookData
export function decodeV2Message(messageBytes: Hex) {
  const hex = messageBytes.startsWith('0x') ? messageBytes.slice(2) : messageBytes;
  const b = Buffer.from(hex, 'hex');

  const readUint32 = (offset: number) => b.readUInt32BE(offset);
  const readBigUint64 = (offset: number) => {
    const hi = BigInt(b.readUInt32BE(offset));
    const lo = BigInt(b.readUInt32BE(offset + 4));
    return (hi << 32n) | lo;
  };
  const readBytes32 = (offset: number): Hex => `0x${b.subarray(offset, offset + 32).toString('hex')}`;
  const readAddr = (offset: number): string => {
    const padded = b.subarray(offset, offset + 32).toString('hex');
    return `0x${padded.slice(24)}`;
  };
  const readUint256 = (offset: number): bigint => {
    let val = 0n;
    for (let i = 0; i < 32; i++) val = (val << 8n) | BigInt(b[offset + i]);
    return val;
  };

  const header = {
    version: readUint32(0),
    sourceDomain: readUint32(4),
    destinationDomain: readUint32(8),
    nonce: readBigUint64(12).toString(),
    sender: readBytes32(20),
    recipient: readBytes32(52),
    destinationCaller: readBytes32(84),
    minFinalityThreshold: readUint32(116),
    finalityThresholdExecuted: readUint32(120),
  };

  const bodyOffset = 124;
  let body: Record<string, string> | null = null;
  if (b.length >= bodyOffset + 7 * 32) {
    body = {
      burnToken: readAddr(bodyOffset),
      mintRecipient: readAddr(bodyOffset + 32),
      amount: readUint256(bodyOffset + 64).toString(),
      messageSender: readAddr(bodyOffset + 96),
      maxFee: readUint256(bodyOffset + 128).toString(),
      feeExecuted: readUint256(bodyOffset + 160).toString(),
      expirationBlock: readUint256(bodyOffset + 192).toString(),
    };
  }

  return { header, body };
}
