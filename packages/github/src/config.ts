import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const githubFileSchema = z
  .object({
    path: z.string().trim().min(1),
    parser: z.string().trim().min(1),
    enabled: z.boolean().default(true),
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
    parser_options: z
      .object({
        table_headers: z.array(z.string()).min(1).optional(),
        inherited_company_marker: z.string().optional(),
        sponsorship_markers: z.record(z.string(), z.string()).optional(),
        closed_marker: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .strict();

const sourcesFileSchema = z
  .object({
    version: z.number().int().positive(),
    sources: z.array(z.record(z.string(), z.unknown())),
  })
  .passthrough();

export type GithubSourceConfig = z.infer<typeof githubSourceSchema>;

export async function loadGithubSourcesFromFile(
  path: string,
): Promise<GithubSourceConfig[]> {
  const raw = await readFile(path, "utf8");
  const parsed = sourcesFileSchema.parse(parseYaml(raw));
  return parsed.sources
    .filter((source) => source.type === "github")
    .map((source) => githubSourceSchema.parse(source));
}

export function expectedTableHeaders(
  source: GithubSourceConfig,
): string[] | null {
  const headers = source.parser_options?.table_headers;
  return headers === undefined || headers.length === 0 ? null : headers;
}
