import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildGithubRawEvents,
  observationKeysForRows,
  parseVanshb03MarkdownSnapshot,
} from "./snapshot.js";

const fixtureDir = resolve("packages/test-fixtures/github/vanshb03-summer2027");

async function loadFixture(name: string): Promise<string> {
  return readFile(resolve(fixtureDir, name), "utf8");
}

const expectedHeaders = [
  "Company",
  "Role",
  "Location",
  "Application/Link",
  "Date Posted",
];

describe("vanshb03 markdown snapshot parser", () => {
  it("parses complete snapshots including inherited companies", async () => {
    const markdown = await loadFixture("README.sample.md");
    const parsed = parseVanshb03MarkdownSnapshot({
      markdown,
      expectedHeaders,
    });
    expect(parsed.kind).toBe("ok");
    if (parsed.kind !== "ok") {
      return;
    }
    expect(parsed.rows).toHaveLength(4);
    expect(parsed.rows[0]?.company).toBe("Example Corp");
    expect(parsed.rows[1]?.company).toBe("Example Corp");
    expect(parsed.rows[1]?.applicationUrl).toBe(
      "https://jobs.lever.co/example/pm-1002",
    );

    const events = buildGithubRawEvents({
      repository: "vanshb03/Summer2027-Internships",
      branch: "dev",
      path: "README.md",
      commitSha: "a".repeat(40),
      capturedAt: "2026-08-03T00:00:00.000Z",
      rows: parsed.rows,
    });
    expect(events).toHaveLength(4);
    expect(events[0]?.source_event_id).toContain(
      "greenhouse.io/example/jobs/1001",
    );
  });

  it("keeps stable identities across reorders", async () => {
    const original = parseVanshb03MarkdownSnapshot({
      markdown: await loadFixture("README.sample.md"),
      expectedHeaders,
    });
    const reordered = parseVanshb03MarkdownSnapshot({
      markdown: await loadFixture("README.reordered.md"),
      expectedHeaders,
    });
    expect(original.kind).toBe("ok");
    expect(reordered.kind).toBe("ok");
    if (original.kind !== "ok" || reordered.kind !== "ok") {
      return;
    }
    const originalKeys = new Set(
      observationKeysForRows({
        repository: "vanshb03/Summer2027-Internships",
        path: "README.md",
        rows: original.rows,
      }),
    );
    const reorderedKeys = observationKeysForRows({
      repository: "vanshb03/Summer2027-Internships",
      path: "README.md",
      rows: reordered.rows,
    });
    expect(reorderedKeys.every((key) => originalKeys.has(key))).toBe(true);
  });

  it("detects edited rows as same observation keys when URL is stable", async () => {
    const edited = parseVanshb03MarkdownSnapshot({
      markdown: await loadFixture("README.edited.md"),
      expectedHeaders,
    });
    expect(edited.kind).toBe("ok");
    if (edited.kind !== "ok") {
      return;
    }
    const pm = edited.rows.find((row) =>
      row.applicationUrl?.includes("pm-1002"),
    );
    expect(pm?.rowText).toContain("Hybrid - SF");
    expect(pm?.applicationUrl).toBe("https://jobs.lever.co/example/pm-1002");
  });

  it("surfaces removed rows via observation key set difference", async () => {
    const full = parseVanshb03MarkdownSnapshot({
      markdown: await loadFixture("README.sample.md"),
      expectedHeaders,
    });
    const removed = parseVanshb03MarkdownSnapshot({
      markdown: await loadFixture("README.removed.md"),
      expectedHeaders,
    });
    expect(full.kind).toBe("ok");
    expect(removed.kind).toBe("ok");
    if (full.kind !== "ok" || removed.kind !== "ok") {
      return;
    }
    const fullKeys = observationKeysForRows({
      repository: "vanshb03/Summer2027-Internships",
      path: "README.md",
      rows: full.rows,
    });
    const removedKeys = new Set(
      observationKeysForRows({
        repository: "vanshb03/Summer2027-Internships",
        path: "README.md",
        rows: removed.rows,
      }),
    );
    const missing = fullKeys.filter((key) => !removedKeys.has(key));
    expect(missing).toEqual([
      "url:https://boards.greenhouse.io/acme/jobs/2001",
    ]);
  });

  it("flags schema drift when headers change", async () => {
    const drift = parseVanshb03MarkdownSnapshot({
      markdown: await loadFixture("README.drift.md"),
      expectedHeaders,
    });
    expect(drift).toMatchObject({
      kind: "drift",
      detail: "table_headers_mismatch",
    });
  });

  it("extracts URLs from HTML anchors without trailing quotes", () => {
    const markdown = `
| Company | Role | Location | Application/Link | Date Posted |
| --- | --- | --- | --- | --- |
| Point72 | Quantitative Developer Intern | New York, NY | <a href="https://careers.point72.com/CSJobDetail?jobCode=CSS-0012293&utm_source=github-vansh-ouckah">Apply</a> | Jul 30 |
| Aquatic | Software Engineer Intern | Chicago, IL | <a href='https://job-boards.greenhouse.io/embed/job_app?token=8489233002'>Apply</a> | Jul 29 |
`;
    const parsed = parseVanshb03MarkdownSnapshot({
      markdown,
      expectedHeaders,
    });
    expect(parsed.kind).toBe("ok");
    if (parsed.kind !== "ok") {
      return;
    }
    expect(parsed.rows[0]?.applicationUrl).toBe(
      "https://careers.point72.com/CSJobDetail?jobCode=CSS-0012293&utm_source=github-vansh-ouckah",
    );
    expect(parsed.rows[1]?.applicationUrl).toBe(
      "https://job-boards.greenhouse.io/embed/job_app?token=8489233002",
    );
    const events = buildGithubRawEvents({
      repository: "vanshb03/Summer2027-Internships",
      branch: "dev",
      path: "README.md",
      commitSha: "a".repeat(40),
      capturedAt: "2026-08-03T00:00:00.000Z",
      rows: parsed.rows,
    });
    expect(events[0]?.source_event_id.endsWith('"')).toBe(false);
    expect(events[0]?.source_event_id).toBe(
      "https://careers.point72.com/CSJobDetail?jobCode=CSS-0012293&utm_source=github-vansh-ouckah",
    );
  });

  it("dedupes observation keys for identical locked/no-URL rows", () => {
    const markdown = `
| Company | Role | Location | Application/Link | Date Posted |
| --- | --- | --- | --- | --- |
| Defense Co | Software Engineer Intern | Chantilly, VA | 🔒 | May 22 |
| ↳ | Software Engineer Intern | Chantilly, VA | 🔒 | May 22 |
| ↳ | Software Engineer Intern | Chantilly, VA | 🔒 | May 22 |
`;
    const parsed = parseVanshb03MarkdownSnapshot({
      markdown,
      expectedHeaders,
    });
    expect(parsed.kind).toBe("ok");
    if (parsed.kind !== "ok") {
      return;
    }
    expect(parsed.rows).toHaveLength(3);
    const keys = observationKeysForRows({
      repository: "vanshb03/Summer2027-Internships",
      path: "README.md",
      rows: parsed.rows,
    });
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
