import type {
  OpportunityCandidate,
  RawEvent,
  ReviewReason,
} from "@recruiting-help/contracts";
import type {
  StructuredExtractionProvider,
  StructuredExtractionResult,
} from "./ai.js";
import { extractDeterministically } from "./deterministic.js";
import { classifyRelevance } from "./relevance.js";

export type ExtractionPipelineResult =
  | {
      kind: "candidate";
      candidate: OpportunityCandidate;
      method: "deterministic";
      parserVersion: string;
      model: null;
      closed: boolean;
    }
  | {
      kind: "candidate";
      candidate: OpportunityCandidate;
      method: "ai";
      parserVersion: null;
      model: StructuredExtractionResult;
      closed: false;
    }
  | {
      kind: "ignored";
      reason: string;
    }
  | {
      kind: "review";
      reasons: ReviewReason[];
      detail: string;
    };

export async function extractOpportunity(
  event: RawEvent,
  provider: StructuredExtractionProvider | null,
): Promise<ExtractionPipelineResult> {
  const deterministic = extractDeterministically(event);
  if (deterministic !== null) {
    return {
      kind: "candidate",
      candidate: deterministic.candidate,
      method: "deterministic",
      parserVersion: deterministic.parserVersion,
      model: null,
      closed: deterministic.closed,
    };
  }

  const relevance = classifyRelevance(event);
  if (relevance.disposition === "irrelevant") {
    return { kind: "ignored", reason: relevance.reason };
  }
  if (provider === null) {
    return {
      kind: "review",
      reasons: ["ai_unavailable"],
      detail: relevance.reason,
    };
  }

  const model = await provider.extract(event);
  return {
    kind: "candidate",
    candidate: model.candidate,
    method: "ai",
    parserVersion: null,
    model,
    closed: false,
  };
}
