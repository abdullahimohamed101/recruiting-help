import type { Pool, PoolClient } from "pg";

type Queryable = Pool | PoolClient;

export type SourceConfigRecord = {
  id: string;
  sourceType: string;
  displayName: string;
  config: Record<string, unknown>;
  enabled: boolean;
  pollIntervalSeconds: number;
  shadowMode: boolean;
};

export type SourceCursorRecord = {
  sourceConfigId: string;
  cursorKey: string;
  cursorValue: Record<string, unknown>;
  etag: string | null;
};

export async function upsertGithubSourceConfig(
  database: Queryable,
  input: {
    externalId: string;
    displayName: string;
    enabled: boolean;
    pollIntervalSeconds: number;
    shadowMode: boolean;
    config: Record<string, unknown>;
  },
): Promise<SourceConfigRecord> {
  const config = {
    ...input.config,
    external_id: input.externalId,
    shadow_mode: input.shadowMode,
  };
  const result = await database.query<{
    id: string;
    source_type: string;
    display_name: string;
    config: Record<string, unknown>;
    enabled: boolean;
    poll_interval_seconds: number;
  }>(
    `
      INSERT INTO aggregator.source_configs (
        source_type,
        display_name,
        config,
        enabled,
        poll_interval_seconds
      )
      VALUES ('github', $1, $2::jsonb, $3, $4)
      ON CONFLICT ((lower(display_name))) DO UPDATE
      SET
        config = EXCLUDED.config,
        enabled = EXCLUDED.enabled,
        poll_interval_seconds = EXCLUDED.poll_interval_seconds,
        updated_at = now()
      RETURNING id, source_type, display_name, config, enabled, poll_interval_seconds
    `,
    [
      input.displayName,
      JSON.stringify(config),
      input.enabled,
      input.pollIntervalSeconds,
    ],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("source_config upsert returned no row");
  }
  await database.query(
    `
      INSERT INTO aggregator.connector_health (source_config_id, state)
      VALUES ($1, CASE WHEN $2 THEN 'healthy' ELSE 'disabled' END)
      ON CONFLICT (source_config_id) DO NOTHING
    `,
    [row.id, input.enabled],
  );
  return {
    id: row.id,
    sourceType: row.source_type,
    displayName: row.display_name,
    config: row.config,
    enabled: row.enabled,
    pollIntervalSeconds: row.poll_interval_seconds,
    shadowMode: row.config.shadow_mode === true,
  };
}

export async function getSourceCursor(
  database: Queryable,
  input: { sourceConfigId: string; cursorKey: string },
): Promise<SourceCursorRecord | null> {
  const result = await database.query<{
    source_config_id: string;
    cursor_key: string;
    cursor_value: Record<string, unknown>;
    etag: string | null;
  }>(
    `
      SELECT source_config_id, cursor_key, cursor_value, etag
      FROM aggregator.source_cursors
      WHERE source_config_id = $1 AND cursor_key = $2
    `,
    [input.sourceConfigId, input.cursorKey],
  );
  const row = result.rows[0];
  if (row === undefined) {
    return null;
  }
  return {
    sourceConfigId: row.source_config_id,
    cursorKey: row.cursor_key,
    cursorValue: row.cursor_value,
    etag: row.etag,
  };
}

export async function saveSourceCursor(
  database: Queryable,
  input: {
    sourceConfigId: string;
    cursorKey: string;
    cursorValue: Record<string, unknown>;
    etag: string | null;
  },
): Promise<void> {
  await database.query(
    `
      INSERT INTO aggregator.source_cursors (
        source_config_id,
        cursor_key,
        cursor_value,
        etag
      )
      VALUES ($1, $2, $3::jsonb, $4)
      ON CONFLICT (source_config_id, cursor_key) DO UPDATE
      SET
        cursor_value = EXCLUDED.cursor_value,
        etag = EXCLUDED.etag,
        updated_at = now()
    `,
    [
      input.sourceConfigId,
      input.cursorKey,
      JSON.stringify(input.cursorValue),
      input.etag,
    ],
  );
}

export async function markSourceSuccess(
  database: Queryable,
  input: { sourceConfigId: string; detail?: string | null },
): Promise<void> {
  await database.query(
    `
      UPDATE aggregator.source_configs
      SET last_success_at = now(), updated_at = now()
      WHERE id = $1
    `,
    [input.sourceConfigId],
  );
  await database.query(
    `
      INSERT INTO aggregator.connector_health (
        source_config_id,
        state,
        last_attempt_at,
        last_success_at,
        consecutive_failures,
        detail_code,
        detail
      )
      VALUES ($1, 'healthy', now(), now(), 0, NULL, $2)
      ON CONFLICT (source_config_id) DO UPDATE
      SET
        state = 'healthy',
        last_attempt_at = now(),
        last_success_at = now(),
        consecutive_failures = 0,
        detail_code = NULL,
        detail = EXCLUDED.detail,
        updated_at = now()
    `,
    [input.sourceConfigId, input.detail ?? null],
  );
}

export async function markSourceFailure(
  database: Queryable,
  input: {
    sourceConfigId: string;
    state?: "stale" | "rate_limited" | "selector_broken" | "disabled";
    detailCode: string;
    detail?: string | null;
    disableSource?: boolean;
  },
): Promise<void> {
  if (input.disableSource === true) {
    await database.query(
      `
        UPDATE aggregator.source_configs
        SET enabled = false, updated_at = now()
        WHERE id = $1
      `,
      [input.sourceConfigId],
    );
  }
  await database.query(
    `
      INSERT INTO aggregator.connector_health (
        source_config_id,
        state,
        last_attempt_at,
        consecutive_failures,
        detail_code,
        detail
      )
      VALUES ($1, $2, now(), 1, $3, $4)
      ON CONFLICT (source_config_id) DO UPDATE
      SET
        state = EXCLUDED.state,
        last_attempt_at = now(),
        consecutive_failures = aggregator.connector_health.consecutive_failures + 1,
        detail_code = EXCLUDED.detail_code,
        detail = EXCLUDED.detail,
        updated_at = now()
    `,
    [
      input.sourceConfigId,
      input.state ?? "stale",
      input.detailCode,
      input.detail ?? null,
    ],
  );
}

function applicationUrlsFromKeys(keys: string[]): string[] {
  return keys
    .filter((key) => key.startsWith("url:"))
    .map((key) => key.slice("url:".length));
}

export async function syncSourceObservations(
  database: Queryable,
  input: {
    sourceConfigId: string;
    seenKeys: string[];
    observedAt: string;
  },
): Promise<{ possiblyRemoved: string[]; closed: string[] }> {
  const possiblyRemoved: string[] = [];
  const closed: string[] = [];
  // Postgres rejects ON CONFLICT DO UPDATE when the same key appears twice in
  // one INSERT (common for identical locked/no-URL rows in internship tables).
  const seenKeys = [...new Set(input.seenKeys)];

  if (seenKeys.length > 0) {
    await database.query(
      `
        INSERT INTO aggregator.source_observations (
          source_config_id,
          observation_key,
          last_seen_at,
          consecutive_misses
        )
        SELECT $1, key, $2::timestamptz, 0
        FROM unnest($3::text[]) AS key
        ON CONFLICT (source_config_id, observation_key) DO UPDATE
        SET
          last_seen_at = EXCLUDED.last_seen_at,
          consecutive_misses = 0,
          updated_at = now()
      `,
      [input.sourceConfigId, input.observedAt, seenKeys],
    );
  }

  const missed = await database.query<{
    observation_key: string;
    consecutive_misses: number;
  }>(
    `
      UPDATE aggregator.source_observations
      SET
        consecutive_misses = consecutive_misses + 1,
        updated_at = now()
      WHERE source_config_id = $1
        AND (
          cardinality($2::text[]) = 0
          OR NOT (observation_key = ANY ($2::text[]))
        )
      RETURNING observation_key, consecutive_misses
    `,
    [input.sourceConfigId, seenKeys],
  );

  for (const row of missed.rows) {
    if (row.consecutive_misses === 1) {
      possiblyRemoved.push(row.observation_key);
    } else if (row.consecutive_misses >= 2) {
      closed.push(row.observation_key);
    }
  }

  const possiblyRemovedUrls = applicationUrlsFromKeys(possiblyRemoved);
  if (possiblyRemovedUrls.length > 0) {
    await database.query(
      `
        UPDATE aggregator.opportunities
        SET status = 'possibly_removed', updated_at = now()
        WHERE status = 'active'
          AND application_url = ANY ($1::text[])
      `,
      [possiblyRemovedUrls],
    );
  }

  const closedUrls = applicationUrlsFromKeys(closed);
  if (closedUrls.length > 0) {
    await database.query(
      `
        UPDATE aggregator.opportunities
        SET status = 'closed', updated_at = now()
        WHERE status IN ('active', 'possibly_removed')
          AND application_url = ANY ($1::text[])
      `,
      [closedUrls],
    );
  }

  return { possiblyRemoved, closed };
}

export async function isSourceShadowMode(
  database: Queryable,
  sourceConfigId: string | null,
): Promise<boolean> {
  if (sourceConfigId === null) {
    return false;
  }
  const result = await database.query<{ shadow: boolean }>(
    `
      SELECT COALESCE((config->>'shadow_mode')::boolean, false) AS shadow
      FROM aggregator.source_configs
      WHERE id = $1
    `,
    [sourceConfigId],
  );
  return result.rows[0]?.shadow === true;
}
