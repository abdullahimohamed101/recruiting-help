import type {
  OpportunityCandidate,
  RawEvent,
  ReviewReason,
} from "@recruiting-help/contracts";
import { sourceContextHints } from "./deterministic.js";
import { extractEvidenceUrls } from "./urls.js";

export type EvidenceValidation = {
  valid: boolean;
  reviewReasons: ReviewReason[];
  missingEvidence: string[];
};

export function validateCandidateEvidence(
  event: RawEvent,
  candidate: OpportunityCandidate,
): EvidenceValidation {
  const requiredKeys: string[] = [];
  if (candidate.company !== null) requiredKeys.push("company");
  if (candidate.role !== null) requiredKeys.push("role");
  if (candidate.locations.length > 0) requiredKeys.push("locations");
  if (candidate.season !== null) requiredKeys.push("season");
  if (candidate.year !== null) requiredKeys.push("year");
  if (candidate.employment_type !== null) requiredKeys.push("employment_type");
  if (candidate.sponsorship_status !== "unknown") {
    requiredKeys.push("sponsorship_status");
  }
  if (candidate.application_url !== null) requiredKeys.push("application_url");
  if (candidate.deadline !== null) requiredKeys.push("deadline");
  if (candidate.posted_at !== null) requiredKeys.push("posted_at");
  if (candidate.description_excerpt !== null) {
    requiredKeys.push("description_excerpt");
  }

  const sourceText = [
    event.text ?? "",
    sourceContextHints(event),
    event.source_account,
    JSON.stringify(event.metadata),
  ].join("\n");
  const missingEvidence = requiredKeys.filter((key) => {
    const fragment = candidate.evidence[key];
    return (
      fragment === undefined ||
      fragment.length === 0 ||
      !sourceText.toLowerCase().includes(fragment.toLowerCase())
    );
  });

  if (candidate.application_url !== null) {
    const candidateUrl = new URL(candidate.application_url).toString();
    const literalUrls = new Set(
      extractEvidenceUrls(event).map((url) => new URL(url).toString()),
    );
    if (!literalUrls.has(candidateUrl)) {
      missingEvidence.push("application_url_literal");
    }
  }

  return {
    valid: missingEvidence.length === 0,
    reviewReasons: missingEvidence.length === 0 ? [] : ["invalid_evidence"],
    missingEvidence,
  };
}
