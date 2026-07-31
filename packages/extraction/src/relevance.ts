import type { RawEvent } from "@recruiting-help/contracts";
import { extractEvidenceUrls } from "./urls.js";

export type RelevanceDecision = {
  disposition: "relevant" | "irrelevant" | "ambiguous";
  reason: string;
};

const opportunityPattern = /\b(intern(ship)?|co[- ]?op)\b/iu;
const applicationPattern =
  /\b(apply|application|applications|career|careers|greenhouse|lever|workday|ashby)\b/iu;
const noisePattern =
  /\b(webinar|conference|meetup|workshop|resume review|office hours|hackathon)\b/iu;
const excludedRolePattern =
  /\b(new[- ]?grad|senior|staff|principal|manager)\b/iu;

export function classifyRelevance(event: RawEvent): RelevanceDecision {
  const text = event.text ?? "";
  const hasOpportunityTerm = opportunityPattern.test(text);
  const hasApplicationSignal =
    applicationPattern.test(text) || extractEvidenceUrls(event).length > 0;
  const hasNoiseSignal = noisePattern.test(text);

  if (excludedRolePattern.test(text) && !hasOpportunityTerm) {
    return { disposition: "irrelevant", reason: "excluded_role_type" };
  }
  if (hasNoiseSignal && !hasOpportunityTerm && !hasApplicationSignal) {
    return { disposition: "irrelevant", reason: "event_noise" };
  }
  if (hasOpportunityTerm && hasApplicationSignal) {
    return { disposition: "relevant", reason: "role_and_application_signal" };
  }
  if (hasOpportunityTerm || hasApplicationSignal) {
    return { disposition: "ambiguous", reason: "partial_opportunity_signal" };
  }
  return { disposition: "irrelevant", reason: "no_opportunity_signal" };
}
