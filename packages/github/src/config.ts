import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { MarkdownTableParserOptions } from "./snapshot.js";

const parserOptionsSchema = z
  .object({
    table_headers: z.array(z.string()).min(1).optional(),
    inherited_company_marker: z.string().optional(),
    sponsorship_markers: z.record(z.string(), z.string()).optional(),
    closed_marker: z.string().optional(),
    min_columns: z.number().int().min(2).optional(),
    company_column: z.number().int().min(0).optional(),
    role_column: z.number().int().min(0).optional(),
    application_column: z.number().int().min(0).optional(),
  })
  .passthrough();

const githubFileSchema = z
  .object({
    path: z.string().trim().min(1),
    parser: z.string().trim().min(1),
    enabled: z.boolean().default(true),
    /** Optional per-file overrides merged over source-level parser_options. */
    parser_options: parserOptionsSchema.optional(),
  })
  .strict();

const githubSourceSchema = z
  .object({
    id: z.string().trim().min(1),
    type: z.literal("github"),
    enabled: z.boolean(),
    display_name: z.string().trim().min(1),
    repository: z
      .string()
      .trim()
      .regex(/^[^/\s]+\/[^/\s]+$/u),
    branch: z.string().trim().min(1),
    files: z.array(githubFileSchema).min(1),
    poll_interval_seconds: z.number().int().min(30),
    shadow_mode: z.boolean(),
    parser_options: parserOptionsSchema.optional(),
  })
  .strict();

const sourcesFileSchema = z
  .object({
    version: z.number().int().positive(),
    sources: z.array(z.record(z.string(), z.unknown())),
  })
  .passthrough();

export type GithubSourceConfig = z.infer<typeof githubSourceSchema>;
export type GithubSourceFileConfig = z.infer<typeof githubFileSchema>;
export type GithubParserOptions = z.infer<typeof parserOptionsSchema>;

export async function loadGithubSourcesFromFile(
  path: string,
): Promise<GithubSourceConfig[]> {
  const raw = await readFile(path, "utf8");
  const parsed = sourcesFileSchema.parse(parseYaml(raw));
  return parsed.sources
    .filter((source) => source.type === "github")
    .map((source) => githubSourceSchema.parse(source));
}

export function mergeParserOptions(
  source: GithubSourceConfig,
  file: GithubSourceFileConfig,
): MarkdownTableParserOptions {
  const merged = {
    ...(source.parser_options ?? {}),
    ...(file.parser_options ?? {}),
  };
  const options: MarkdownTableParserOptions = {};
  if (merged.table_headers !== undefined) {
    options.expectedHeaders = merged.table_headers;
  }
  if (merged.inherited_company_marker !== undefined) {
    options.inheritedCompanyMarker = merged.inherited_company_marker;
  }
  if (merged.min_columns !== undefined) {
    options.minColumns = merged.min_columns;
  }
  if (merged.company_column !== undefined) {
    options.companyColumn = merged.company_column;
  }
  if (merged.role_column !== undefined) {
    options.roleColumn = merged.role_column;
  }
  if (merged.application_column !== undefined) {
    options.applicationColumn = merged.application_column;
  }
  return options;
}
