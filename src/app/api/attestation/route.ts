import { NextRequest } from 'next/server';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'wagmi/chains';
import { cctpRegistryAbi } from '@/lib/abis';
import { REGISTRY_ADDRESS, ATTESTATION_BASE } from '@/lib/cctp';

const publicClient = createPublicClient({ chain: sepolia, transport: http() });

// Server-side relayer key — set REGISTRY_RELAYER_PRIVATE_KEY in .env.local
// This wallet only needs enough Sepolia ETH to cover gas for markAttested calls.
function getRelayerWalletClient() {
  const raw = process.env.REGISTRY_RELAYER_PRIVATE_KEY;
  if (!raw) return null;
  const key = raw.startsWith('0x') ? raw as `0x${string}` : `0x${raw}` as `0x${string}`;
  const account = privateKeyToAccount(key);
  return createWalletClient({ account, chain: sepolia, transport: http() });
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function checkOneAttestation(txHash: string, srcDomain: number) {
  const upstream = `${ATTESTATION_BASE}/v2/messages/${srcDomain}?transactionHash=${txHash}`;
  try {
    console.log('[attestation] iris request', { txHash, srcDomain, upstream });
    const r = await fetch(upstream, { cache: 'no-store' });
    console.log('[attestation] iris response status', {
      txHash,
      srcDomain,
      status: r.status,
      ok: r.ok,
    });
    const body = await r.json() as Record<string, unknown>;
    console.log('[attestation] iris response body', {
      txHash,
      srcDomain,
      body,
    });
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
    console.log('[attestation] mode=direct', { txHash: directTxHash, srcDomain: directDomain });
    const result = await checkOneAttestation(directTxHash as `0x${string}`, directDomain);
    const relayer = getRelayerWalletClient();
    if (!relayer) {
      console.warn('[attestation] direct mode: REGISTRY_RELAYER_PRIVATE_KEY missing, skipping markAttested');
    }
    if (result.ready && result.message && result.attestation && REGISTRY_ADDRESS && relayer) {
      try {
        const markTxHash = await relayer.writeContract({
          address: REGISTRY_ADDRESS,
          abi: cctpRegistryAbi,
          functionName: 'markAttested',
          args: [directTxHash as `0x${string}`, result.message as `0x${string}`, result.attestation as `0x${string}`],
        });
        console.log('[attestation] direct mode markAttested submitted', {
          burnTxHash: directTxHash,
          markTxHash,
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash: markTxHash });
        console.log('[attestation] direct mode markAttested mined', {
          burnTxHash: directTxHash,
          markTxHash,
          status: receipt.status,
          blockNumber: receipt.blockNumber.toString(),
          gasUsed: receipt.gasUsed.toString(),
        });
      } catch (err) {
        console.error('[attestation] direct mode markAttested failed', {
          txHash: directTxHash,
          err,
        });
      }
    }
    return Response.json({ results: [result] });
  }

  // ── Registry mode ──────────────────────────────────────────────────────────
  if (!REGISTRY_ADDRESS) {
    return Response.json(
      { error: 'NEXT_PUBLIC_REGISTRY_ADDRESS is not set. Deploy the contract first.' },
      { status: 503 }
    );
  }
  console.log('[attestation] mode=registry', { registry: REGISTRY_ADDRESS });

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
    console.log('[attestation] registry has no pending requests');
    return Response.json({ results: [] });
  }

  const relayer = getRelayerWalletClient();
  if (!relayer) {
    console.warn('REGISTRY_RELAYER_PRIVATE_KEY not set — markAttested will be skipped');
  }
  const results = [];
  for (let i = 0; i < txHashes.length; i++) {
    if (i > 0) await sleep(2000);
    const result = await checkOneAttestation(txHashes[i], srcDomains[i]);
    results.push(result);

    if (result.ready && result.message && result.attestation && REGISTRY_ADDRESS && relayer) {
      try {
        const markTxHash = await relayer.writeContract({
          address: REGISTRY_ADDRESS,
          abi: cctpRegistryAbi,
          functionName: 'markAttested',
          args: [txHashes[i], result.message as `0x${string}`, result.attestation as `0x${string}`],
        });
        console.log('[attestation] markAttested submitted', {
          burnTxHash: txHashes[i],
          markTxHash,
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash: markTxHash });
        console.log('[attestation] markAttested mined', {
          burnTxHash: txHashes[i],
          markTxHash,
          status: receipt.status,
          blockNumber: receipt.blockNumber.toString(),
          gasUsed: receipt.gasUsed.toString(),
        });
      } catch (err) {
        console.error('markAttested failed', { txHash: txHashes[i], err });
      }
    }
  }

  return Response.json({ results });
}
