import { createPublicClient, http } from 'viem';
import { sepolia } from 'wagmi/chains';
import { cctpRegistryAbi } from '@/lib/abis';
import { REGISTRY_ADDRESS, ATTESTATION_BASE } from '@/lib/cctp';

const publicClient = createPublicClient({ chain: sepolia, transport: http() });

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function checkOneAttestation(txHash: string, srcDomain: number) {
  const upstream = `${ATTESTATION_BASE}/v2/messages/${srcDomain}?transactionHash=${txHash}`;
  try {
    const r = await fetch(upstream, { cache: 'no-store' });
    const body = await r.json() as Record<string, unknown>;
    const messages = (body?.messages as Record<string, unknown>[] | undefined) ?? [];
    const msg = messages[0];
    const attestation = (msg?.attestation as string | undefined) ?? null;
    const ready =
      msg?.status === 'complete' &&
      attestation != null &&
      attestation !== 'PENDING';
    return {
      txHash,
      ready,
      message:     (msg?.message     as string | undefined) ?? null,
      attestation,
      status:      (msg?.status      as string | undefined) ?? null,
      delayReason: (msg?.delayReason as string | undefined) ?? null,
    };
  } catch {
    return { txHash, ready: false, message: null, attestation: null, status: 'error', delayReason: null };
  }
}

/**
 * POST /api/attestation  (no body required)
 *
 * 1. Reads pending requests from CCTPRegistry on Sepolia.
 * 2. For each, calls Circle's sandbox attestation API with a 2 s gap.
 * 3. Returns an array of results — one per pending request.
 *
 * Called by Kwala on its own schedule. The frontend also calls it
 * via the "Check now" button to simulate one tick.
 */
export async function POST() {
  if (!REGISTRY_ADDRESS) {
    return Response.json(
      { error: 'NEXT_PUBLIC_REGISTRY_ADDRESS is not set. Deploy the contract first.' },
      { status: 503 }
    );
  }

  // 1. Get pending requests from the on-chain registry
  let txHashes: readonly `0x${string}`[];
  let srcDomains: readonly number[];
  try {
    const result = await publicClient.readContract({
      address: REGISTRY_ADDRESS,
      abi: cctpRegistryAbi,
      functionName: 'getPendingRequests',
    });
    [txHashes, srcDomains] = result as [`0x${string}`[], number[]];
  } catch (err) {
    return Response.json(
      { error: 'Failed to read registry contract', detail: String(err) },
      { status: 502 }
    );
  }

  if (txHashes.length === 0) {
    return Response.json({ results: [] });
  }

  // 2. Poll Circle for each pending request, 2 s apart
  const results = [];
  for (let i = 0; i < txHashes.length; i++) {
    if (i > 0) await sleep(2000);
    const result = await checkOneAttestation(txHashes[i], srcDomains[i]);
    results.push(result);
  }

  return Response.json({ results });
}
