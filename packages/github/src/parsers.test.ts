import { describe, expect, it } from "vitest";
import {
  getSnapshotParser,
  listSnapshotParsers,
  registerSnapshotParser,
} from "./parsers.js";
import { MARKDOWN_TABLE_V1, VANSHB03_MARKDOWN_TABLE_V1 } from "./snapshot.js";

describe("snapshot parser registry", () => {
  it("registers built-in internship table parsers", () => {
    const ids = listSnapshotParsers().map((parser) => parser.id);
    expect(ids).toContain(MARKDOWN_TABLE_V1);
    expect(ids).toContain(VANSHB03_MARKDOWN_TABLE_V1);
  });

  it("resolves vanshb03 parser for the default source", () => {
    const parser = getSnapshotParser(VANSHB03_MARKDOWN_TABLE_V1);
    expect(parser).not.toBeNull();
    if (parser === null) {
      return;
    }
    const parsed = parser.parse({
      markdown: [
        "| Company | Role | Location | Application/Link | Date Posted |",
        "| --- | --- | --- | --- | --- |",
        "| Example | Intern | Remote | https://example.com/a | Jul 1 |",
      ].join("\n"),
      parserOptions: {},
    });
    expect(parsed.kind).toBe("ok");
    if (parsed.kind === "ok") {
      expect(parsed.rows).toHaveLength(1);
      expect(parsed.rows[0]?.applicationUrl).toBe("https://example.com/a");
    }
  });

  it("allows registering additional parsers for new internship inputs", () => {
    const id = `test_custom_parser_${Date.now()}`;
    registerSnapshotParser({
      id,
      description: "test-only parser",
      parse: () => ({ kind: "ok", rows: [], headers: [] }),
    });
    expect(getSnapshotParser(id)?.description).toBe("test-only parser");
    expect(() =>
      registerSnapshotParser({
        id,
        description: "duplicate",
        parse: () => ({ kind: "ok", rows: [], headers: [] }),
      }),
    ).toThrow(/duplicate_snapshot_parser/);
  });
});
