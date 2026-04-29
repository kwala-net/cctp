import { NextRequest } from 'next/server';
import { createPublicClient, http, keccak256 } from 'viem';
import { sepolia, avalancheFuji } from 'wagmi/chains';
import { parseMessageSentLog } from '@/lib/format';
import { CCTP } from '@/lib/cctp';
import type { Hex } from 'viem';

/**
 * GET /api/burn-info?txHash=0x..&srcChain=sepolia
 *
 * Fetches the transaction receipt from the source chain, locates the
 * MessageSent event emitted by MessageTransmitterV2, and returns the
 * raw messageBytes + messageHash.
 *
 * srcChain must be "sepolia" or "avalancheFuji"
 */
export async function GET(req: NextRequest) {
  const txHash = req.nextUrl.searchParams.get('txHash') as Hex | null;
  const srcChain = req.nextUrl.searchParams.get('srcChain');

  if (!txHash || !srcChain) {
    return Response.json(
      { error: 'Missing required query params: txHash, srcChain' },
      { status: 400 }
    );
  }

  const chainConfig = CCTP[srcChain as keyof typeof CCTP];
  if (!chainConfig) {
    return Response.json(
      { error: `Unknown srcChain "${srcChain}". Must be: ${Object.keys(CCTP).join(', ')}` },
      { status: 400 }
    );
  }

  const client = createPublicClient({
    chain: chainConfig.chain,
    transport: http(),
  });

  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash });
  } catch (err) {
    return Response.json(
      { error: 'Could not fetch transaction receipt', detail: String(err) },
      { status: 502 }
    );
  }

  if (!receipt) {
    return Response.json({ error: 'Transaction receipt not found' }, { status: 404 });
  }

  const result = parseMessageSentLog(receipt, chainConfig.messageTransmitter);
  if (!result) {
    return Response.json(
      { error: 'No MessageSent event found in this transaction' },
      { status: 422 }
    );
  }

  return Response.json({
    messageBytes: result.messageBytes,
    messageHash: result.messageHash,
    txHash,
    srcChain,
    domainId: chainConfig.domainId,
  });
}
