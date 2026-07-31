import type { RawEvent } from "@recruiting-help/contracts";
import { extractEvidenceUrls } from "./urls.js";

export type RelevanceDecision = {
  disposition: "relevant" | "irrelevant" | "ambiguous";
  reason: string;
};

const opportunityPattern =
  /\b(intern(ship)?|co[- ]?op|new[- ]?grad|early[- ]?career)\b/iu;
const applicationPattern =
  /\b(apply|application|applications|career|careers|greenhouse|lever|workday|ashby)\b/iu;
const noisePattern =
  /\b(webinar|conference|meetup|workshop|resume review|office hours|hackathon)\b/iu;
const excludedRolePattern = /\b(senior|staff|principal|manager)\b/iu;
const jobApplicationHostPattern =
  /(?:^|\.)(?:ashbyhq\.com|greenhouse\.io|lever\.co|myworkdayjobs\.com|workdayjobs\.com|smartrecruiters\.com|icims\.com|jobvite\.com|rippling\.com|boards\.eu)$|(?:^|\.)(?:ats\.|jobs\.|careers\.)/iu;

function urlLooksLikeJobApplication(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = `${parsed.pathname}${parsed.search}`.toLowerCase();
    if (jobApplicationHostPattern.test(host)) {
      return true;
    }
    return /\/(?:jobs?|careers?|apply|application)(?:\/|$|\?)/u.test(path);
  } catch {
    return false;
  }
}

function hasJobApplicationUrl(event: RawEvent): boolean {
  return extractEvidenceUrls(event).some(urlLooksLikeJobApplication);
}

export function classifyRelevance(event: RawEvent): RelevanceDecision {
  const text = event.text ?? "";
  const hasOpportunityTerm = opportunityPattern.test(text);
  const hasApplicationLanguage = applicationPattern.test(text);
  const hasJobUrl = hasJobApplicationUrl(event);
  const hasApplicationSignal = hasApplicationLanguage || hasJobUrl;
  const hasNoiseSignal = noisePattern.test(text);

  if (excludedRolePattern.test(text) && !hasOpportunityTerm) {
    return { disposition: "irrelevant", reason: "excluded_role_type" };
  }
  if (hasNoiseSignal && !hasOpportunityTerm && !hasApplicationSignal) {
    return { disposition: "irrelevant", reason: "event_noise" };
  }
  // A random URL alone (movie times, news, etc.) is not an opportunity signal.
  if (!hasOpportunityTerm && !hasApplicationLanguage && !hasJobUrl) {
    if (extractEvidenceUrls(event).length > 0) {
      return { disposition: "irrelevant", reason: "non_job_url_only" };
    }
    return { disposition: "irrelevant", reason: "no_opportunity_signal" };
  }
  if (hasOpportunityTerm && hasApplicationSignal) {
    return { disposition: "relevant", reason: "role_and_application_signal" };
  }
  if (hasOpportunityTerm || hasApplicationSignal) {
    return { disposition: "ambiguous", reason: "partial_opportunity_signal" };
  }
  return { disposition: "irrelevant", reason: "no_opportunity_signal" };
}
