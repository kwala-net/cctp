import { NextRequest } from 'next/server';

const ATTESTATION_BASE = 'https://iris-api-sandbox.circle.com';

/**
 * POST /api/attestation
 * Body: { txHash: "0x...", srcDomain: 0 }
 *
 * Called by Kwala (or the frontend "Check now" button) at whatever interval
 * the caller chooses. This route makes exactly one upstream fetch to Circle
 * and returns the result. No polling, no setTimeout.
 *
 * Response shape:
 *   { ready: boolean, message: hex|null, attestation: hex|"PENDING"|null, raw: CircleV2Response }
 */
export async function POST(req: NextRequest) {
  let txHash: string | undefined;
  let srcDomain: string | number | undefined;
  try {
    const body = await req.json();
    txHash = body?.txHash;
    srcDomain = body?.srcDomain;
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!txHash || srcDomain == null) {
    return Response.json(
      { error: 'Missing required fields: txHash, srcDomain' },
      { status: 400 }
    );
  }

  const upstream = `${ATTESTATION_BASE}/v2/messages/${srcDomain}?transactionHash=${txHash}`;

  let body: Record<string, unknown>;
  try {
    const r = await fetch(upstream, {
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
    });
    body = await r.json();
  } catch (err) {
    return Response.json(
      { error: 'Failed to reach Circle attestation service', detail: String(err) },
      { status: 502 }
    );
  }

  const messages = (body?.messages as Record<string, unknown>[] | undefined) ?? [];
  const msg = messages[0];

  const attestation = (msg?.attestation as string | undefined) ?? null;
  const ready =
    msg?.status === 'complete' &&
    attestation != null &&
    attestation !== 'PENDING';

  return Response.json({
    ready,
    message: (msg?.message as string | undefined) ?? null,
    attestation,
    raw: body,
  });
}
