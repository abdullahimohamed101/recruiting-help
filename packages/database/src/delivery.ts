import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

export type DeliveryWorkItem = {
  deliveryId: string;
  opportunityId: string;
  destinationType: "discord_feed" | "discord_review" | "notion";
  destinationKey: string;
  payload: Record<string, unknown>;
  attemptCount: number;
  leaseToken: string;
};

export class DeliveryLeaseLostError extends Error {
  constructor() {
    super("The delivery outbox lease is no longer owned by this worker.");
    this.name = "DeliveryLeaseLostError";
  }
}

const RETRY_DELAY_SECONDS = [30, 120, 600, 3_600, 21_600] as const;
const MAX_RETRY_HORIZON_SECONDS = 24 * 60 * 60;

async function withTransaction<T>(
  pool: Pool,
  action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await action(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function deliveryRetryDelaySeconds(
  attemptCount: number,
  retryAfterSeconds?: number,
): number {
  if (
    retryAfterSeconds !== undefined &&
    Number.isFinite(retryAfterSeconds) &&
    retryAfterSeconds > 0
  ) {
    return Math.min(Math.ceil(retryAfterSeconds), MAX_RETRY_HORIZON_SECONDS);
  }
  const index = Math.min(
    Math.max(attemptCount - 1, 0),
    RETRY_DELAY_SECONDS.length - 1,
  );
  return RETRY_DELAY_SECONDS[index] ?? 21_600;
}

async function assertDeliveryLease(
  client: PoolClient,
  input: Pick<DeliveryWorkItem, "deliveryId" | "leaseToken">,
): Promise<void> {
  const result = await client.query(
    `
      SELECT id
      FROM aggregator.delivery_outbox
      WHERE id = $1
        AND status = 'delivering'
        AND lease_token = $2
      FOR UPDATE
    `,
    [input.deliveryId, input.leaseToken],
  );
  if (result.rowCount !== 1) {
    throw new DeliveryLeaseLostError();
  }
}

export async function claimNextDelivery(
  pool: Pool,
  options: {
    leaseSeconds?: number;
    maxAttempts?: number;
  } = {},
): Promise<DeliveryWorkItem | null> {
  const leaseSeconds = options.leaseSeconds ?? 60;
  const maxAttempts = options.maxAttempts ?? 10;
  const leaseToken = randomUUID();

  return withTransaction(pool, async (client) => {
    const claimed = await client.query<{
      id: string;
      opportunity_id: string;
      destination_type: DeliveryWorkItem["destinationType"];
      destination_key: string;
      payload: Record<string, unknown>;
      attempt_count: number;
    }>(
      `
        WITH candidate AS (
          SELECT id
          FROM aggregator.delivery_outbox
          WHERE attempt_count < $1
            AND (
              (
                status IN ('pending', 'retry')
                AND next_attempt_at <= now()
              )
              OR (
                status = 'delivering'
                AND lease_expires_at <= now()
              )
            )
          ORDER BY created_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE aggregator.delivery_outbox AS delivery
        SET
          status = 'delivering',
          attempt_count = delivery.attempt_count + 1,
          lease_expires_at = now() + make_interval(secs => $2),
          lease_token = $3,
          last_error = NULL
        FROM candidate
        WHERE delivery.id = candidate.id
        RETURNING
          delivery.id,
          delivery.opportunity_id,
          delivery.destination_type,
          delivery.destination_key,
          delivery.payload,
          delivery.attempt_count
      `,
      [maxAttempts, leaseSeconds, leaseToken],
    );

    const row = claimed.rows[0];
    if (row === undefined) {
      return null;
    }

    return {
      deliveryId: row.id,
      opportunityId: row.opportunity_id,
      destinationType: row.destination_type,
      destinationKey: row.destination_key,
      payload: row.payload,
      attemptCount: row.attempt_count,
      leaseToken,
    };
  });
}

export async function markDeliveryDelivered(
  pool: Pool,
  input: Pick<DeliveryWorkItem, "deliveryId" | "leaseToken"> & {
    externalMessageId: string;
  },
): Promise<void> {
  await withTransaction(pool, async (client) => {
    await assertDeliveryLease(client, input);
    const updated = await client.query(
      `
        UPDATE aggregator.delivery_outbox
        SET
          status = 'delivered',
          external_message_id = $3,
          lease_expires_at = NULL,
          lease_token = NULL,
          last_error = NULL
        WHERE id = $1 AND lease_token = $2
      `,
      [input.deliveryId, input.leaseToken, input.externalMessageId],
    );
    if (updated.rowCount !== 1) {
      throw new DeliveryLeaseLostError();
    }
  });
}

export async function markDeliveryRetry(
  pool: Pool,
  input: Pick<
    DeliveryWorkItem,
    "deliveryId" | "leaseToken" | "attemptCount"
  > & {
    error: string;
    retryAfterSeconds?: number;
  },
): Promise<void> {
  const delaySeconds = deliveryRetryDelaySeconds(
    input.attemptCount,
    input.retryAfterSeconds,
  );
  await withTransaction(pool, async (client) => {
    await assertDeliveryLease(client, input);
    const updated = await client.query(
      `
        UPDATE aggregator.delivery_outbox
        SET
          status = 'retry',
          lease_expires_at = NULL,
          lease_token = NULL,
          next_attempt_at = now() + make_interval(secs => $3),
          last_error = $4
        WHERE id = $1 AND lease_token = $2
      `,
      [
        input.deliveryId,
        input.leaseToken,
        delaySeconds,
        input.error.slice(0, 1_000),
      ],
    );
    if (updated.rowCount !== 1) {
      throw new DeliveryLeaseLostError();
    }
  });
}

export async function markDeliveryDead(
  pool: Pool,
  input: Pick<DeliveryWorkItem, "deliveryId" | "leaseToken"> & {
    error: string;
  },
): Promise<void> {
  await withTransaction(pool, async (client) => {
    await assertDeliveryLease(client, input);
    const updated = await client.query(
      `
        UPDATE aggregator.delivery_outbox
        SET
          status = 'dead',
          lease_expires_at = NULL,
          lease_token = NULL,
          last_error = $3
        WHERE id = $1 AND lease_token = $2
      `,
      [input.deliveryId, input.leaseToken, input.error.slice(0, 1_000)],
    );
    if (updated.rowCount !== 1) {
      throw new DeliveryLeaseLostError();
    }
  });
}
