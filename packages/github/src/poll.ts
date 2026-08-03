import { createHash } from "node:crypto";
import type { RawEvent } from "@recruiting-help/contracts";
import {
  getSourceCursor,
  insertRawEvent,
  markSourceFailure,
  markSourceSuccess,
  saveSourceCursor,
  syncSourceObservations,
  upsertGithubSourceConfig,
  type Pool,
} from "@recruiting-help/database";
import { fetchGithubFileContent } from "./client.js";
import { expectedTableHeaders, type GithubSourceConfig } from "./config.js";
import {
  buildGithubRawEvents,
  observationKeysForRows,
  parseVanshb03MarkdownSnapshot,
  VANSHB03_MARKDOWN_TABLE_V1,
} from "./snapshot.js";

export type PollFileResult = {
  sourceId: string;
  path: string;
  disposition:
    | "not_modified"
    | "inserted"
    | "rate_limited"
    | "drift"
    | "error"
    | "disabled";
  insertedCount: number;
  duplicateCount: number;
  detail?: string;
};

function payloadHash(event: RawEvent): string {
  return createHash("sha256").update(JSON.stringify(event)).digest("hex");
}

function splitRepo(repository: string): { owner: string; repo: string } {
  const [owner, repo] = repository.split("/");
  if (owner === undefined || repo === undefined) {
    throw new Error(`invalid_repository:${repository}`);
  }
  return { owner, repo };
}

function cursorKeyForFile(path: string): string {
  return `file:${path}`;
}

function jitterMs(maxMs: number): number {
  return Math.floor(Math.random() * Math.max(0, maxMs));
}

export async function pollGithubSource(input: {
  pool: Pool;
  source: GithubSourceConfig;
  token?: string | null;
  fetchImpl?: typeof fetch;
  jitterMaxMs?: number;
}): Promise<PollFileResult[]> {
  if (!input.source.enabled) {
    return [
      {
        sourceId: input.source.id,
        path: "*",
        disposition: "disabled",
        insertedCount: 0,
        duplicateCount: 0,
      },
    ];
  }

  await new Promise((resolve) =>
    setTimeout(resolve, jitterMs(input.jitterMaxMs ?? 5_000)),
  );

  const sourceConfig = await upsertGithubSourceConfig(input.pool, {
    externalId: input.source.id,
    displayName: input.source.display_name,
    enabled: input.source.enabled,
    pollIntervalSeconds: input.source.poll_interval_seconds,
    shadowMode: input.source.shadow_mode,
    config: {
      repository: input.source.repository,
      branch: input.source.branch,
      files: input.source.files,
      parser_options: input.source.parser_options ?? {},
    },
  });

  const { owner, repo } = splitRepo(input.source.repository);
  const results: PollFileResult[] = [];

  for (const file of input.source.files) {
    if (!file.enabled) {
      continue;
    }
    if (file.parser !== VANSHB03_MARKDOWN_TABLE_V1) {
      results.push({
        sourceId: input.source.id,
        path: file.path,
        disposition: "error",
        insertedCount: 0,
        duplicateCount: 0,
        detail: `unsupported_parser:${file.parser}`,
      });
      continue;
    }

    const cursor = await getSourceCursor(input.pool, {
      sourceConfigId: sourceConfig.id,
      cursorKey: cursorKeyForFile(file.path),
    });
    const fetchInput: Parameters<typeof fetchGithubFileContent>[0] = {
      owner,
      repo,
      path: file.path,
      ref: input.source.branch,
      etag: cursor?.etag ?? null,
    };
    if (input.token !== undefined) {
      fetchInput.token = input.token;
    }
    if (input.fetchImpl !== undefined) {
      fetchInput.fetchImpl = input.fetchImpl;
    }
    const fetchResult = await fetchGithubFileContent(fetchInput);

    if (fetchResult.kind === "not_modified") {
      await markSourceSuccess(input.pool, {
        sourceConfigId: sourceConfig.id,
        detail: `not_modified:${file.path}`,
      });
      results.push({
        sourceId: input.source.id,
        path: file.path,
        disposition: "not_modified",
        insertedCount: 0,
        duplicateCount: 0,
      });
      continue;
    }

    if (fetchResult.kind === "rate_limited") {
      await markSourceFailure(input.pool, {
        sourceConfigId: sourceConfig.id,
        state: "rate_limited",
        detailCode: "github_rate_limited",
        detail: `${file.path}:${fetchResult.retryAfterSeconds}`,
      });
      results.push({
        sourceId: input.source.id,
        path: file.path,
        disposition: "rate_limited",
        insertedCount: 0,
        duplicateCount: 0,
        detail: String(fetchResult.retryAfterSeconds),
      });
      break;
    }

    if (fetchResult.kind !== "ok") {
      const isNotFound = fetchResult.kind === "not_found";
      await markSourceFailure(input.pool, {
        sourceConfigId: sourceConfig.id,
        state: isNotFound ? "selector_broken" : "stale",
        detailCode: fetchResult.detail,
        detail: file.path,
        disableSource: isNotFound,
      });
      results.push({
        sourceId: input.source.id,
        path: file.path,
        disposition: "error",
        insertedCount: 0,
        duplicateCount: 0,
        detail: fetchResult.detail,
      });
      continue;
    }

    const snapshot = parseVanshb03MarkdownSnapshot({
      markdown: fetchResult.content,
      expectedHeaders: expectedTableHeaders(input.source),
    });
    if (snapshot.kind === "drift") {
      await markSourceFailure(input.pool, {
        sourceConfigId: sourceConfig.id,
        state: "selector_broken",
        detailCode: snapshot.detail,
        detail: `${file.path}:${snapshot.headers.join("|")}`,
        disableSource: true,
      });
      results.push({
        sourceId: input.source.id,
        path: file.path,
        disposition: "drift",
        insertedCount: 0,
        duplicateCount: 0,
        detail: snapshot.detail,
      });
      continue;
    }

    const capturedAt = new Date().toISOString();
    const events = buildGithubRawEvents({
      repository: input.source.repository,
      branch: input.source.branch,
      path: file.path,
      commitSha: fetchResult.sha,
      capturedAt,
      rows: snapshot.rows,
    });
    const observationKeys = observationKeysForRows({
      repository: input.source.repository,
      path: file.path,
      rows: snapshot.rows,
    });

    let insertedCount = 0;
    let duplicateCount = 0;
    const client = await input.pool.connect();
    try {
      await client.query("BEGIN");
      for (const event of events) {
        const result = await insertRawEvent(client, {
          event,
          payloadSha256: payloadHash(event),
          sourceConfigId: sourceConfig.id,
        });
        if (result.inserted) {
          insertedCount += 1;
        } else {
          duplicateCount += 1;
        }
      }
      await saveSourceCursor(client, {
        sourceConfigId: sourceConfig.id,
        cursorKey: cursorKeyForFile(file.path),
        cursorValue: {
          sha: fetchResult.sha,
          path: file.path,
          branch: input.source.branch,
          row_count: snapshot.rows.length,
        },
        etag: fetchResult.etag,
      });
      await syncSourceObservations(client, {
        sourceConfigId: sourceConfig.id,
        seenKeys: observationKeys,
        observedAt: capturedAt,
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      await markSourceFailure(input.pool, {
        sourceConfigId: sourceConfig.id,
        state: "stale",
        detailCode: "persist_failed",
        detail:
          error instanceof Error
            ? error.message.slice(0, 200)
            : "persist_failed",
      });
      results.push({
        sourceId: input.source.id,
        path: file.path,
        disposition: "error",
        insertedCount: 0,
        duplicateCount: 0,
        detail: "persist_failed",
      });
      continue;
    } finally {
      client.release();
    }

    await markSourceSuccess(input.pool, {
      sourceConfigId: sourceConfig.id,
      detail: `ok:${file.path}:${insertedCount}`,
    });
    results.push({
      sourceId: input.source.id,
      path: file.path,
      disposition: "inserted",
      insertedCount,
      duplicateCount,
    });
  }

  return results;
}
