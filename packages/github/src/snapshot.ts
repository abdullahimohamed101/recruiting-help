import { createHash } from "node:crypto";
import { RawEventSchema, type RawEvent } from "@recruiting-help/contracts";

export const VANSHB03_MARKDOWN_TABLE_V1 = "vanshb03_markdown_table_v1";

export type SnapshotRow = {
  rowText: string;
  company: string | null;
  role: string | null;
  applicationUrl: string | null;
  rowIndex: number;
};

export type SnapshotParseResult =
  | {
      kind: "ok";
      rows: SnapshotRow[];
      headers: string[];
    }
  | {
      kind: "drift";
      detail: string;
      headers: string[];
    };

function splitCells(row: string): string[] {
  const cells: string[] = [];
  let current = "";
  let escaped = false;
  for (const character of row.trim().replace(/^\|/u, "").replace(/\|$/u, "")) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
      current += character;
    } else if (character === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  cells.push(current.trim());
  return cells;
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "");
}

function extractUrl(cell: string): string | null {
  const markdown = cell.match(/\((https?:\/\/[^)\s]+)\)/u)?.[1];
  if (markdown !== undefined) {
    return markdown;
  }
  const bare = cell.match(/https?:\/\/[^\s<>)|]+/u)?.[0];
  return bare ?? null;
}

export function observationKeyForRow(input: {
  repository: string;
  path: string;
  rowText: string;
  applicationUrl: string | null;
}): string {
  if (input.applicationUrl !== null) {
    return `url:${input.applicationUrl}`;
  }
  const digest = createHash("sha256")
    .update(
      [
        input.repository,
        input.path,
        input.rowText.replace(/\s+/gu, " ").trim(),
      ].join("\n"),
    )
    .digest("hex");
  return `row:${digest}`;
}

export function parseVanshb03MarkdownSnapshot(input: {
  markdown: string;
  expectedHeaders?: string[] | null;
}): SnapshotParseResult {
  const lines = input.markdown.split(/\r?\n/u);
  let headerCells: string[] | null = null;
  const rows: SnapshotRow[] = [];
  let previousCompany: string | null = null;
  let rowIndex = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      continue;
    }
    const cells = splitCells(trimmed);
    if (cells.length < 5) {
      continue;
    }
    if (cells.every((cell) => /^:?-{3,}:?$/u.test(cell))) {
      continue;
    }
    if (headerCells === null) {
      headerCells = cells;
      if (
        input.expectedHeaders !== undefined &&
        input.expectedHeaders !== null
      ) {
        const expected = input.expectedHeaders.map(normalizeHeader);
        const actual = headerCells.map(normalizeHeader);
        const matches =
          expected.length === actual.length &&
          expected.every((header, index) => header === actual[index]);
        if (!matches) {
          return {
            kind: "drift",
            detail: "table_headers_mismatch",
            headers: headerCells,
          };
        }
      }
      continue;
    }

    const companyCell = cells[0] ?? "";
    const roleCell = cells[1] ?? "";
    const applicationCell = cells[3] ?? "";
    let company: string | null;
    if (companyCell === "↳") {
      company = previousCompany;
    } else if (companyCell.trim().length === 0) {
      company = null;
    } else {
      company = companyCell.replace(/[*_`]/gu, "").trim();
      previousCompany = company;
    }
    const role =
      roleCell
        .replaceAll("🛂", "")
        .replaceAll("🇺🇸", "")
        .replaceAll("🔒", "")
        .replace(/[*_`]/gu, "")
        .trim() || null;
    const applicationUrl = extractUrl(applicationCell);
    rows.push({
      rowText: trimmed,
      company,
      role,
      applicationUrl,
      rowIndex,
    });
    rowIndex += 1;
  }

  if (headerCells === null) {
    return {
      kind: "drift",
      detail: "table_headers_missing",
      headers: [],
    };
  }

  return { kind: "ok", rows, headers: headerCells };
}

export function buildGithubRawEvents(input: {
  repository: string;
  branch: string;
  path: string;
  commitSha: string;
  capturedAt: string;
  rows: SnapshotRow[];
}): RawEvent[] {
  const commitSha = /^[a-f0-9]{40}$/iu.test(input.commitSha)
    ? input.commitSha.toLowerCase()
    : null;
  return input.rows.map((row) => {
    const sourceEventId =
      row.applicationUrl ??
      createHash("sha256")
        .update([input.repository, input.path, row.rowText].join("\n"))
        .digest("hex");
    return RawEventSchema.parse({
      schema_version: 1,
      source: "github",
      source_account: input.repository,
      source_event_id: sourceEventId.slice(0, 1024),
      source_url: `https://github.com/${input.repository}/blob/${input.branch}/${input.path}`,
      occurred_at: null,
      captured_at: input.capturedAt,
      author_display: null,
      text: row.rowText,
      attachments: [],
      metadata: {
        repository: input.repository,
        branch: input.branch,
        path: input.path,
        commit_sha: commitSha,
        row_index: row.rowIndex,
      },
    });
  });
}

export function observationKeysForRows(input: {
  repository: string;
  path: string;
  rows: SnapshotRow[];
}): string[] {
  return input.rows.map((row) =>
    observationKeyForRow({
      repository: input.repository,
      path: input.path,
      rowText: row.rowText,
      applicationUrl: row.applicationUrl,
    }),
  );
}
