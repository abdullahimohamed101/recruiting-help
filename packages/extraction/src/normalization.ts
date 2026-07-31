import { createHash } from "node:crypto";
import type {
  OpportunityCandidate,
  ReviewReason,
} from "@recruiting-help/contracts";
import type { StableJobIdentity } from "./urls.js";

const usLocationPattern =
  /\b(united states|u\.?s\.?a?\.?|remote[- ]?us|us[- ]?remote|alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|district of columbia|,\s?(al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy|dc)\b)/iu;
const nonUsPattern =
  /\b(canada|toronto|vancouver|montreal|europe|emea|asia|india|united kingdom|uk|australia|global)\b/iu;

export function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/gu, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

export function normalizeCompany(value: string): string {
  return normalizeText(value)
    .replace(
      /\b(incorporated|inc|llc|ltd|limited|corporation|corp|company|co)\b$/u,
      "",
    )
    .trim();
}

export function normalizeRole(value: string): string {
  return normalizeText(value)
    .replace(/\b(summer|spring|fall|winter)\s+20\d{2}\b/gu, " ")
    .replace(/\binternships?\b/gu, "intern")
    .replace(/\bengineering\b/gu, "engineer")
    .replace(/\s+/gu, " ")
    .trim();
}

export function locationDisposition(
  locations: readonly string[],
): "allowed" | "rejected" | "ambiguous" {
  if (locations.length === 0) {
    return "ambiguous";
  }
  if (locations.some((location) => usLocationPattern.test(location))) {
    return "allowed";
  }
  if (locations.every((location) => nonUsPattern.test(location))) {
    return "rejected";
  }
  return "ambiguous";
}

export function reviewReasonsForCandidate(
  candidate: OpportunityCandidate,
  minimumConfidence: number,
): ReviewReason[] {
  const reasons = new Set<ReviewReason>();
  if (candidate.company === null) {
    reasons.add("missing_company");
  }
  if (candidate.role === null) {
    reasons.add("missing_role");
  }
  if (candidate.application_url === null) {
    reasons.add("missing_application_url");
  }
  // Missing location is allowed for link-drop intake; only flag geography when
  // locations were provided but are still ambiguous (e.g. "EMEA / Remote").
  if (
    candidate.locations.length > 0 &&
    locationDisposition(candidate.locations) === "ambiguous"
  ) {
    reasons.add("ambiguous_geography");
  }
  if (candidate.confidence < minimumConfidence) {
    reasons.add("low_confidence");
  }
  return [...reasons];
}

export function isOutsideProductScope(
  candidate: OpportunityCandidate,
): boolean {
  // All graduation years are in scope. Reject only clearly non-US geography.
  return locationDisposition(candidate.locations) === "rejected";
}

export function employmentTypeLabel(
  employmentType: OpportunityCandidate["employment_type"],
): string {
  switch (employmentType) {
    case "internship":
      return "Internship";
    case "co_op":
      return "Co-op";
    case "new_grad":
      return "New Grad";
    case null:
      return "Uncategorized";
  }
}

export function employmentTypeSortOrder(
  employmentType: OpportunityCandidate["employment_type"],
): number {
  switch (employmentType) {
    case "internship":
      return 1;
    case "co_op":
      return 2;
    case "new_grad":
      return 3;
    case null:
      return 99;
  }
}

export function feedDestinationKey(
  employmentType: OpportunityCandidate["employment_type"],
): string {
  switch (employmentType) {
    case "internship":
      return "internship-feed";
    case "co_op":
      return "co-op-feed";
    case "new_grad":
      return "new-grad-feed";
    case null:
      return "uncategorized-feed";
  }
}

export function createOpportunityFingerprint(input: {
  candidate: OpportunityCandidate;
  stableJobIdentity: StableJobIdentity | null;
}): {
  fingerprint: string | null;
  normalizedCompany: string | null;
  normalizedRole: string | null;
} {
  const normalizedCompany =
    input.candidate.company === null
      ? null
      : normalizeCompany(input.candidate.company);
  const normalizedRole =
    input.candidate.role === null ? null : normalizeRole(input.candidate.role);
  if (
    normalizedCompany === null ||
    normalizedCompany.length === 0 ||
    normalizedRole === null ||
    normalizedRole.length === 0 ||
    input.candidate.year === null
  ) {
    return { fingerprint: null, normalizedCompany, normalizedRole };
  }

  const normalizedLocations = input.candidate.locations
    .map(normalizeText)
    .sort()
    .join("|");
  const material = [
    normalizedCompany,
    normalizedRole,
    normalizedLocations,
    input.candidate.season ?? "",
    input.candidate.year.toString(),
    input.stableJobIdentity?.board ?? "",
    input.stableJobIdentity?.id ?? "",
  ].join("\u001f");

  return {
    fingerprint: createHash("sha256").update(material).digest("hex"),
    normalizedCompany,
    normalizedRole,
  };
}

function tokenSet(value: string): Set<string> {
  return new Set(normalizeText(value).split(" ").filter(Boolean));
}

export function tokenJaccardSimilarity(left: string, right: string): number {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  const union = new Set([...leftTokens, ...rightTokens]);
  if (union.size === 0) {
    return 0;
  }
  let intersectionSize = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersectionSize += 1;
    }
  }
  return intersectionSize / union.size;
}

export function isFuzzyDuplicateCandidate(input: {
  company: string;
  role: string;
  existingCompany: string;
  existingRole: string;
  threshold?: number;
}): boolean {
  const companySimilarity = tokenJaccardSimilarity(
    normalizeCompany(input.company),
    normalizeCompany(input.existingCompany),
  );
  const roleSimilarity = tokenJaccardSimilarity(
    normalizeRole(input.role),
    normalizeRole(input.existingRole),
  );
  return (
    companySimilarity >= 0.9 && roleSimilarity >= (input.threshold ?? 0.82)
  );
}
