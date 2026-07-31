import {
  OpportunityCandidateSchema,
  type OpportunityCandidate,
  type RawEvent,
} from "@recruiting-help/contracts";
import { extractEvidenceUrls } from "./urls.js";

export type DeterministicExtraction = {
  candidate: OpportunityCandidate;
  parserVersion: string;
  closed: boolean;
};

function stripMarkdown(value: string): string {
  return value
    .replace(/<br\s*\/?>/giu, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/[*_`]/gu, "")
    .trim();
}

function markdownCells(row: string): string[] {
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

function inferSeason(text: string): OpportunityCandidate["season"] {
  const value = text.toLowerCase();
  if (value.includes("spring")) return "spring";
  if (value.includes("summer")) return "summer";
  if (value.includes("fall") || value.includes("autumn")) return "fall";
  if (value.includes("winter")) return "winter";
  return null;
}

function inferYear(text: string): number | null {
  // Match both "2027" and glued forms such as "Summer2027".
  const year = text.match(/(20\d{2})/u)?.[1];
  return year === undefined ? null : Number(year);
}

function inferPostedAt(value: string, capturedAt: string): string | null {
  const match = value.match(
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})\b/iu,
  );
  if (match === null) {
    return null;
  }
  const monthNames = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ];
  const month = monthNames.indexOf(match[1]?.slice(0, 3).toLowerCase() ?? "");
  const day = Number(match[2]);
  const captured = new Date(capturedAt);
  let year = captured.getUTCFullYear();
  let date = new Date(Date.UTC(year, month, day));
  if (date.getTime() > captured.getTime() + 31 * 24 * 60 * 60 * 1_000) {
    year -= 1;
    date = new Date(Date.UTC(year, month, day));
  }
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sponsorshipFromText(
  text: string,
): OpportunityCandidate["sponsorship_status"] {
  if (text.includes("🇺🇸")) return "us_citizenship_required";
  if (text.includes("🛂")) return "does_not_offer";
  return "unknown";
}

function evidenceForCandidate(input: {
  sourceText: string;
  company: string | null;
  role: string | null;
  locations: string[];
  season: OpportunityCandidate["season"];
  year: number | null;
  employmentType: OpportunityCandidate["employment_type"];
  sponsorshipStatus: OpportunityCandidate["sponsorship_status"];
  applicationUrl: string | null;
  postedAt: string | null;
  postedEvidence: string | null;
}): Record<string, string> {
  const evidence: Record<string, string> = {};
  if (input.company !== null) evidence.company = input.company;
  if (input.role !== null) evidence.role = input.role;
  if (input.locations.length > 0) evidence.locations = input.locations[0] ?? "";
  if (input.season !== null) {
    const match = input.sourceText.match(new RegExp(input.season, "iu"))?.[0];
    if (match !== undefined) evidence.season = match;
  }
  if (input.year !== null) evidence.year = input.year.toString();
  if (input.employmentType !== null) {
    const pattern =
      input.employmentType === "co_op" ? /co[- ]?op/iu : /intern(ship)?/iu;
    const match = input.sourceText.match(pattern)?.[0];
    if (match !== undefined) evidence.employment_type = match;
  }
  if (input.sponsorshipStatus === "does_not_offer") {
    evidence.sponsorship_status = "🛂";
  } else if (input.sponsorshipStatus === "us_citizenship_required") {
    evidence.sponsorship_status = "🇺🇸";
  }
  if (input.applicationUrl !== null) {
    evidence.application_url = input.applicationUrl;
  }
  if (input.postedAt !== null && input.postedEvidence !== null) {
    evidence.posted_at = input.postedEvidence;
  }
  return evidence;
}

function parseMarkdownOpportunity(
  event: RawEvent,
): DeterministicExtraction | null {
  const sourceText = event.text?.trim();
  if (sourceText === undefined || !sourceText.startsWith("|")) {
    return null;
  }
  const cells = markdownCells(sourceText);
  if (
    cells.length < 5 ||
    cells.every((cell) => /^:?-{3,}:?$/u.test(cell)) ||
    cells[0]?.toLowerCase() === "company"
  ) {
    return null;
  }
  const contextText = [
    sourceText,
    event.source_account,
    JSON.stringify(event.metadata),
  ].join("\n");

  const companyCell = cells[0] ?? "";
  const roleCell = cells[1] ?? "";
  const locationCell = cells[2] ?? "";
  const applicationCell = cells[3] ?? "";
  const postedCell = cells[4] ?? "";
  const company =
    companyCell === "↳" ? null : stripMarkdown(companyCell) || null;
  const role =
    stripMarkdown(
      roleCell.replaceAll("🛂", "").replaceAll("🇺🇸", "").replaceAll("🔒", ""),
    ).trim() || null;
  const locations = locationCell
    .split(/\s*<br\s*\/?>\s*|\s*;\s*/giu)
    .map(stripMarkdown)
    .filter(Boolean);
  const literalUrls = extractEvidenceUrls(event);
  const applicationUrl =
    literalUrls.find((url) => applicationCell.includes(url)) ??
    literalUrls.find((url) => sourceText.includes(url)) ??
    null;
  const year = inferYear(contextText);
  const season = inferSeason(contextText);
  const employmentType = /\bco[- ]?op\b/iu.test(contextText)
    ? "co_op"
    : /\bintern(ship)?\b/iu.test(contextText)
      ? "internship"
      : null;
  const sponsorshipStatus = sponsorshipFromText(contextText);
  const postedAt = inferPostedAt(postedCell, event.captured_at);
  const evidence = evidenceForCandidate({
    sourceText: contextText,
    company,
    role,
    locations,
    season,
    year,
    employmentType,
    sponsorshipStatus,
    applicationUrl,
    postedAt,
    postedEvidence: postedAt === null ? null : stripMarkdown(postedCell),
  });

  return {
    candidate: OpportunityCandidateSchema.parse({
      schema_version: 1,
      company,
      role,
      locations,
      season,
      year,
      employment_type: employmentType,
      sponsorship_status: sponsorshipStatus,
      application_url: applicationUrl,
      deadline: null,
      posted_at: postedAt,
      source_url: event.source_url,
      description_excerpt: null,
      confidence:
        company !== null && role !== null && applicationUrl !== null
          ? 0.99
          : 0.75,
      evidence,
    }),
    parserVersion: "markdown-opportunity-row-v1",
    closed: sourceText.includes("🔒"),
  };
}

function labeledValue(text: string, label: string): string | null {
  const match = text.match(new RegExp(`^(?:${label})\\s*:\\s*(.+)$`, "imu"));
  return match?.[1]?.trim() ?? null;
}

function parseLabeledOpportunity(
  event: RawEvent,
): DeterministicExtraction | null {
  const sourceText = event.text ?? "";
  const contextText = [
    sourceText,
    event.source_account,
    JSON.stringify(event.metadata),
  ].join("\n");
  const company = labeledValue(sourceText, "company");
  const role = labeledValue(sourceText, "role|position|title");
  if (company === null && role === null) {
    return null;
  }
  const location = labeledValue(sourceText, "location|locations");
  const locations =
    location === null
      ? []
      : location.split(/\s*;\s*|\s*\/\s*/u).filter(Boolean);
  const applicationUrl = extractEvidenceUrls(event)[0] ?? null;
  const year = inferYear(contextText);
  const season = inferSeason(contextText);
  const employmentType = /\bco[- ]?op\b/iu.test(contextText)
    ? "co_op"
    : /\bintern(ship)?\b/iu.test(contextText)
      ? "internship"
      : null;
  const sponsorshipStatus = sponsorshipFromText(contextText);
  const evidence = evidenceForCandidate({
    sourceText: contextText,
    company,
    role,
    locations,
    season,
    year,
    employmentType,
    sponsorshipStatus,
    applicationUrl,
    postedAt: null,
    postedEvidence: null,
  });

  return {
    candidate: OpportunityCandidateSchema.parse({
      schema_version: 1,
      company,
      role,
      locations,
      season,
      year,
      employment_type: employmentType,
      sponsorship_status: sponsorshipStatus,
      application_url: applicationUrl,
      deadline: null,
      posted_at: null,
      source_url: event.source_url,
      description_excerpt: null,
      confidence:
        company !== null && role !== null && applicationUrl !== null
          ? 0.96
          : 0.7,
      evidence,
    }),
    parserVersion: "labeled-opportunity-v1",
    closed: /\b(closed|applications? closed)\b/iu.test(sourceText),
  };
}

export function extractDeterministically(
  event: RawEvent,
): DeterministicExtraction | null {
  return parseMarkdownOpportunity(event) ?? parseLabeledOpportunity(event);
}
