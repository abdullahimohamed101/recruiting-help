import type {
  MarkdownTableParserOptions,
  SnapshotParseResult,
} from "./snapshot.js";
import {
  MARKDOWN_TABLE_V1,
  parseMarkdownTableSnapshot,
  VANSHB03_MARKDOWN_TABLE_V1,
} from "./snapshot.js";

export type SnapshotParserContext = {
  markdown: string;
  parserOptions: MarkdownTableParserOptions;
};

export type SnapshotParser = {
  id: string;
  description: string;
  parse: (context: SnapshotParserContext) => SnapshotParseResult;
};

const registry = new Map<string, SnapshotParser>();

export function registerSnapshotParser(parser: SnapshotParser): void {
  if (registry.has(parser.id)) {
    throw new Error(`duplicate_snapshot_parser:${parser.id}`);
  }
  registry.set(parser.id, parser);
}

export function getSnapshotParser(id: string): SnapshotParser | null {
  return registry.get(id) ?? null;
}

export function listSnapshotParsers(): SnapshotParser[] {
  return [...registry.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
}

function registerDefaults(): void {
  if (registry.size > 0) {
    return;
  }

  registerSnapshotParser({
    id: MARKDOWN_TABLE_V1,
    description:
      "Generic markdown internship table. Column layout comes from parser_options.",
    parse: (context) =>
      parseMarkdownTableSnapshot({
        markdown: context.markdown,
        options: context.parserOptions,
      }),
  });

  registerSnapshotParser({
    id: VANSHB03_MARKDOWN_TABLE_V1,
    description:
      "vanshb03/Summer2027-Internships table (Company | Role | Location | Application/Link | Date Posted).",
    parse: (context) =>
      parseMarkdownTableSnapshot({
        markdown: context.markdown,
        options: {
          expectedHeaders: context.parserOptions.expectedHeaders ?? [
            "Company",
            "Role",
            "Location",
            "Application/Link",
            "Date Posted",
          ],
          inheritedCompanyMarker:
            context.parserOptions.inheritedCompanyMarker ?? "↳",
          minColumns: context.parserOptions.minColumns ?? 5,
          companyColumn: context.parserOptions.companyColumn ?? 0,
          roleColumn: context.parserOptions.roleColumn ?? 1,
          applicationColumn: context.parserOptions.applicationColumn ?? 3,
        },
      }),
  });
}

registerDefaults();
