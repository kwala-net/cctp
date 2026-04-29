import { NextRequest } from 'next/server';
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
 * POST /api/attestation
 *
 * Two modes depending on whether a JSON body is present:
 *
 * Direct mode  — body: { txHash: "0x...", srcDomain: 0 }
 *   Bypasses the registry. Calls Circle for that single tx and returns
 *   { results: [{ txHash, ready, message, attestation, status }] }.
 *   Used by the frontend when the tx isn't in the registry (e.g. predates it).
 *
 * Registry mode — no body (or empty body)
 *   1. Reads pending requests from CCTPRegistry on Sepolia.
 *   2. Calls Circle for each, 2 s apart.
 *   3. Returns { results: [...] } — one entry per pending request.
 *   Called by Kwala on its own schedule.
 */
export async function POST(req: NextRequest) {
  // Try to parse an optional body — empty / missing body is fine
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body */ }

  const directTxHash  = body?.txHash  as string | undefined;
  const directDomain  = body?.srcDomain != null ? Number(body.srcDomain) : undefined;

  // ── Direct mode ────────────────────────────────────────────────────────────
  if (directTxHash && directDomain != null) {
    const result = await checkOneAttestation(directTxHash as `0x${string}`, directDomain);
    return Response.json({ results: [result] });
  }

  // ── Registry mode ──────────────────────────────────────────────────────────
  if (!REGISTRY_ADDRESS) {
    return Response.json(
      { error: 'NEXT_PUBLIC_REGISTRY_ADDRESS is not set. Deploy the contract first.' },
      { status: 503 }
    );
  }

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

  const results = [];
  for (let i = 0; i < txHashes.length; i++) {
    if (i > 0) await sleep(2000);
    const result = await checkOneAttestation(txHashes[i], srcDomains[i]);
    results.push(result);
  }

  return Response.json({ results });
}
