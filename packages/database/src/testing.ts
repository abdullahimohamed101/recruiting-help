import type { RawEvent } from "@recruiting-help/contracts";
import type { Pool } from "pg";

export function createRawEventFixture(
  overrides: Partial<RawEvent> = {},
): RawEvent {
  const base: RawEvent = {
    schema_version: 1,
    source: "github",
    source_account: "vanshb03/Summer2027-Internships",
    source_event_id: "fixture-event",
    source_url:
      "https://github.com/vanshb03/Summer2027-Internships/blob/dev/README.md",
    occurred_at: "2026-07-29T22:00:00Z",
    captured_at: "2026-07-29T22:01:00Z",
    author_display: null,
    text: "| Example | Software Engineer Intern | Remote US | ... | Jul 29 |",
    attachments: [],
    metadata: {
      repository: "vanshb03/Summer2027-Internships",
      branch: "dev",
      path: "README.md",
      commit_sha: "a".repeat(40),
      row_index: 42,
    },
  };

  return { ...base, ...overrides } as RawEvent;
}

export function assertTestDatabaseUrl(connectionString: string): void {
  const databaseName = new URL(connectionString).pathname.slice(1);
  if (!databaseName.endsWith("_test")) {
    throw new Error(
      `Refusing destructive test operations on non-test database: ${databaseName || "(missing)"}`,
    );
  }
}

export async function resetTestDatabase(
  pool: Pool,
  connectionString: string,
): Promise<void> {
  assertTestDatabaseUrl(connectionString);
  await pool.query(`
    TRUNCATE TABLE
      aggregator.delivery_outbox,
      aggregator.processing_runs,
      aggregator.opportunity_sources,
      aggregator.source_observations,
      aggregator.opportunities,
      aggregator.raw_events,
      aggregator.connector_health,
      aggregator.source_cursors,
      aggregator.source_configs,
      aggregator.webhook_nonces
    CASCADE
  `);
}
