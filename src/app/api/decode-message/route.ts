import { NextRequest } from 'next/server';
import { decodeV2Message } from '@/lib/format';
import type { Hex } from 'viem';

/**
 * POST /api/decode-message
 * Body: { messageBytes: "0x..." }
 *
 * Decodes a raw CCTP V2 message locally — no Circle API call.
 * Useful for showing users exactly what's inside the message before relaying.
 */
export async function POST(req: NextRequest) {
  let messageBytes: string;
  try {
    const body = await req.json();
    messageBytes = body?.messageBytes;
    if (!messageBytes || typeof messageBytes !== 'string') {
      return Response.json({ error: 'Body must be { messageBytes: "0x..." }' }, { status: 400 });
    }
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const decoded = decodeV2Message(messageBytes as Hex);
    return Response.json({ decoded });
  } catch (err) {
    return Response.json(
      { error: 'Failed to decode message bytes', detail: String(err) },
      { status: 422 }
    );
  }
}
