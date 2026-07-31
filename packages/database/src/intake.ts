import type { RawEvent } from "@recruiting-help/contracts";
import type { Pool } from "pg";
import { insertRawEvent } from "./repositories.js";

export type PersistSignedRawEventInput = {
  callerId: string;
  nonce: string;
  nonceExpiresAt: Date;
  event: RawEvent;
  payloadSha256: string;
};

export type PersistSignedRawEventResult =
  | {
      kind: "accepted";
      rawEventId: string;
      inserted: boolean;
    }
  | {
      kind: "replayed_nonce";
    };

export async function persistSignedRawEvent(
  pool: Pool,
  input: PersistSignedRawEventInput,
): Promise<PersistSignedRawEventResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const nonceResult = await client.query(
      `
        INSERT INTO aggregator.webhook_nonces (
          caller_id,
          nonce,
          expires_at
        )
        VALUES ($1, $2, $3)
        ON CONFLICT (caller_id, nonce) DO NOTHING
        RETURNING nonce
      `,
      [input.callerId, input.nonce, input.nonceExpiresAt],
    );

    if (nonceResult.rowCount !== 1) {
      await client.query("ROLLBACK");
      return { kind: "replayed_nonce" };
    }

    const rawEventResult = await insertRawEvent(client, {
      event: input.event,
      payloadSha256: input.payloadSha256,
      sourceConfigId: null,
    });
    await client.query("COMMIT");
    return {
      kind: "accepted",
      rawEventId: rawEventResult.record.id,
      inserted: rawEventResult.inserted,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
      // Releasing a failed connection below prevents lock retention.
    });
    throw error;
  } finally {
    client.release();
  }
}
