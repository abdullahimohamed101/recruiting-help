import { createHash } from "node:crypto";
import type {
  OpportunityCandidate,
  ProcessingDisposition,
  ReviewReason,
} from "@recruiting-help/contracts";
import {
  claimNextRawEvent,
  completeRawEventWithoutOpportunity,
  failRawEventProcessing,
  findFuzzyOpportunityCandidates,
  persistProcessedOpportunity,
  persistReviewOpportunity,
  type Pool,
  type PreparedOpportunity,
  type ProcessingAudit,
  type ProcessingWorkItem,
} from "@recruiting-help/database";
import {
  canonicalizeApplicationUrl,
  createOpportunityFingerprint,
  employmentTypeLabel,
  employmentTypeSortOrder,
  extractOpportunity,
  extractStableJobIdentity,
  feedDestinationKey,
  isFuzzyDuplicateCandidate,
  isOutsideProductScope,
  resolveSafeRedirects,
  reviewReasonsForCandidate,
  validateCandidateEvidence,
  type StructuredExtractionProvider,
} from "@recruiting-help/extraction";

export const DEFAULT_AUTO_PUBLISH_CONFIDENCE = 0.85;
export const DEFAULT_FEED_DESTINATION_KEY = "internship-feed";

export type ProcessNextEventOptions = {
  provider?: StructuredExtractionProvider | null;
  destinationKey?: string;
  minimumAutoPublishConfidence?: number;
  resolveRedirects?: boolean;
  leaseSeconds?: number;
  maxAttempts?: number;
};

export type ProcessNextEventResult =
  | {
      disposition: "idle";
    }
  | {
      disposition: ProcessingDisposition;
      rawEventId: string;
      opportunityId: string | null;
      created: boolean;
      outboxCreated: boolean;
      reviewReasons: ReviewReason[];
    };

function emptyAudit(): ProcessingAudit {
  return {
    deterministicParserVersion: null,
    modelProvider: null,
    modelName: null,
    promptVersion: null,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    modelLatencyMs: null,
    classification: null,
    validationOutcome: null,
    extractionResult: null,
  };
}

function auditFromExtraction(input: {
  method: "deterministic" | "ai";
  parserVersion: string | null;
  model: {
    provider: string;
    model: string;
    promptVersion: string;
    latencyMs: number;
    usage: {
      inputTokens: number | null;
      outputTokens: number | null;
      estimatedCostUsd: number;
    };
  } | null;
  classification: Record<string, unknown> | null;
  validationOutcome: Record<string, unknown> | null;
  candidate: OpportunityCandidate | null;
}): ProcessingAudit {
  return {
    deterministicParserVersion: input.parserVersion,
    modelProvider: input.model?.provider ?? null,
    modelName: input.model?.model ?? null,
    promptVersion: input.model?.promptVersion ?? null,
    inputTokens: input.model?.usage.inputTokens ?? null,
    outputTokens: input.model?.usage.outputTokens ?? null,
    costUsd: input.model?.usage.estimatedCostUsd ?? null,
    modelLatencyMs: input.model?.latencyMs ?? null,
    classification: input.classification,
    validationOutcome: input.validationOutcome,
    extractionResult:
      input.candidate === null
        ? { method: input.method }
        : {
            method: input.method,
            candidate: input.candidate,
          },
  };
}

function buildOutboxPayload(
  opportunity: PreparedOpportunity,
): Record<string, unknown> {
  return {
    company: opportunity.company,
    role: opportunity.role,
    locations: opportunity.locations,
    season: opportunity.season,
    year: opportunity.year,
    employment_type: opportunity.employmentType,
    category_label: employmentTypeLabel(opportunity.employmentType),
    sort_order: employmentTypeSortOrder(opportunity.employmentType),
    sponsorship_status: opportunity.sponsorshipStatus,
    application_url: opportunity.applicationUrl,
    deadline: opportunity.deadline,
    source_url: opportunity.sourceUrl,
    confidence: opportunity.confidence,
  };
}

async function prepareOpportunity(
  candidate: OpportunityCandidate,
  options: {
    closed: boolean;
    resolveRedirects: boolean;
  },
): Promise<PreparedOpportunity> {
  let applicationUrl = candidate.application_url;
  let canonicalUrl: string | null = null;
  let canonicalUrlHash: string | null = null;
  let stableJobBoard: string | null = null;
  let stableJobId: string | null = null;

  if (applicationUrl !== null) {
    try {
      const resolved = options.resolveRedirects
        ? await resolveSafeRedirects(applicationUrl)
        : canonicalizeApplicationUrl(applicationUrl);
      applicationUrl = resolved;
      canonicalUrl = resolved;
      canonicalUrlHash = createHash("sha256").update(resolved).digest("hex");
      const stable = extractStableJobIdentity(resolved);
      stableJobBoard = stable?.board ?? null;
      stableJobId = stable?.id ?? null;
    } catch {
      // Keep the verified source URL for review rather than inventing a canonical form.
      applicationUrl = candidate.application_url;
    }
  }

  const fingerprint = createOpportunityFingerprint({
    candidate: {
      ...candidate,
      application_url: applicationUrl,
    },
    stableJobIdentity:
      stableJobBoard !== null && stableJobId !== null
        ? { board: stableJobBoard, id: stableJobId }
        : null,
  });

  return {
    company: candidate.company,
    role: candidate.role,
    locations: candidate.locations,
    season: candidate.season,
    year: candidate.year,
    employmentType: candidate.employment_type,
    sponsorshipStatus: candidate.sponsorship_status,
    applicationUrl,
    deadline: candidate.deadline,
    postedAt: candidate.posted_at,
    sourceUrl: candidate.source_url,
    descriptionExcerpt: candidate.description_excerpt,
    evidence: candidate.evidence,
    canonicalUrl,
    canonicalUrlHash,
    fingerprint: fingerprint.fingerprint,
    stableJobBoard,
    stableJobId,
    normalizedCompany: fingerprint.normalizedCompany,
    normalizedRole: fingerprint.normalizedRole,
    status: options.closed ? "closed" : "active",
    confidence: candidate.confidence,
    needsReview: false,
  };
}

function buildReviewOutboxPayload(input: {
  opportunity: PreparedOpportunity;
  reviewReasons: ReviewReason[];
  excerpt: string | null;
}): Record<string, unknown> {
  return {
    ...buildOutboxPayload(input.opportunity),
    review_reasons: input.reviewReasons,
    description_excerpt: input.excerpt,
  };
}

function minimalReviewOpportunity(
  work: ProcessingWorkItem,
  candidate: OpportunityCandidate | null,
): PreparedOpportunity {
  if (candidate !== null) {
    const fingerprint = createOpportunityFingerprint({
      candidate,
      stableJobIdentity: null,
    });
    return {
      company: candidate.company,
      role: candidate.role,
      locations: candidate.locations,
      season: candidate.season,
      year: candidate.year,
      employmentType: candidate.employment_type,
      sponsorshipStatus: candidate.sponsorship_status,
      applicationUrl: candidate.application_url,
      deadline: candidate.deadline,
      postedAt: candidate.posted_at,
      sourceUrl: candidate.source_url ?? work.event.source_url,
      descriptionExcerpt: candidate.description_excerpt,
      evidence: candidate.evidence,
      canonicalUrl: null,
      canonicalUrlHash: null,
      fingerprint: fingerprint.fingerprint,
      stableJobBoard: null,
      stableJobId: null,
      normalizedCompany: fingerprint.normalizedCompany,
      normalizedRole: fingerprint.normalizedRole,
      status: "active",
      confidence: candidate.confidence,
      needsReview: true,
    };
  }

  const excerpt = (work.event.text ?? "").trim().slice(0, 500) || null;
  return {
    company: null,
    role: null,
    locations: [],
    season: null,
    year: null,
    employmentType: null,
    sponsorshipStatus: "unknown",
    applicationUrl: null,
    deadline: null,
    postedAt: null,
    sourceUrl: work.event.source_url,
    descriptionExcerpt: excerpt,
    evidence: excerpt === null ? {} : { description_excerpt: excerpt },
    canonicalUrl: null,
    canonicalUrlHash: null,
    fingerprint: null,
    stableJobBoard: null,
    stableJobId: null,
    normalizedCompany: null,
    normalizedRole: null,
    status: "active",
    confidence: 0,
    needsReview: true,
  };
}

async function routeToReview(
  pool: Pool,
  work: ProcessingWorkItem,
  input: {
    reviewReasons: ReviewReason[];
    audit: ProcessingAudit;
    candidate?: OpportunityCandidate | null;
  },
): Promise<ProcessNextEventResult> {
  const opportunity = minimalReviewOpportunity(work, input.candidate ?? null);
  const persisted = await persistReviewOpportunity(pool, {
    rawEventId: work.rawEventId,
    processingRunId: work.processingRunId,
    leaseToken: work.leaseToken,
    opportunity,
    observedAt: work.event.captured_at,
    audit: input.audit,
    reviewReasons: input.reviewReasons,
    outboxPayload: buildReviewOutboxPayload({
      opportunity,
      reviewReasons: input.reviewReasons,
      excerpt: opportunity.descriptionExcerpt,
    }),
  });
  return {
    disposition: "review",
    rawEventId: work.rawEventId,
    opportunityId: persisted.opportunityId,
    created: persisted.created,
    outboxCreated: persisted.outboxCreated,
    reviewReasons: input.reviewReasons,
  };
}

async function findReviewableFuzzyMatch(
  pool: Pool,
  opportunity: PreparedOpportunity,
): Promise<string | null> {
  if (opportunity.company === null || opportunity.role === null) {
    return null;
  }

  const exactKeys = new Set(
    [
      opportunity.canonicalUrlHash,
      opportunity.stableJobBoard !== null && opportunity.stableJobId !== null
        ? `${opportunity.stableJobBoard}:${opportunity.stableJobId}`
        : null,
      opportunity.fingerprint,
    ].filter((value): value is string => value !== null),
  );

  const fuzzyCandidates = await findFuzzyOpportunityCandidates(pool, {
    year: opportunity.year,
  });

  for (const candidate of fuzzyCandidates) {
    const candidateKeys = [
      candidate.canonical_url_hash,
      candidate.stable_job_board !== null && candidate.stable_job_id !== null
        ? `${candidate.stable_job_board}:${candidate.stable_job_id}`
        : null,
      candidate.fingerprint,
    ].filter((value): value is string => value !== null);
    if (candidateKeys.some((key) => exactKeys.has(key))) {
      continue;
    }
    if (
      isFuzzyDuplicateCandidate({
        company: opportunity.company,
        role: opportunity.role,
        existingCompany: candidate.company,
        existingRole: candidate.role,
      })
    ) {
      return candidate.id;
    }
  }

  return null;
}

export async function processWorkItem(
  pool: Pool,
  work: ProcessingWorkItem,
  options: ProcessNextEventOptions = {},
): Promise<ProcessNextEventResult> {
  const provider = options.provider ?? null;
  const minimumConfidence =
    options.minimumAutoPublishConfidence ?? DEFAULT_AUTO_PUBLISH_CONFIDENCE;
  const resolveRedirects = options.resolveRedirects ?? false;

  try {
    const extraction = await extractOpportunity(work.event, provider);
    if (extraction.kind === "ignored") {
      const audit = auditFromExtraction({
        method: "deterministic",
        parserVersion: null,
        model: null,
        classification: {
          disposition: "ignored",
          reason: extraction.reason,
        },
        validationOutcome: null,
        candidate: null,
      });
      await completeRawEventWithoutOpportunity(pool, {
        rawEventId: work.rawEventId,
        processingRunId: work.processingRunId,
        leaseToken: work.leaseToken,
        disposition: "ignored",
        reviewReasons: [],
        audit,
      });
      return {
        disposition: "ignored",
        rawEventId: work.rawEventId,
        opportunityId: null,
        created: false,
        outboxCreated: false,
        reviewReasons: [],
      };
    }

    if (extraction.kind === "review") {
      return routeToReview(pool, work, {
        reviewReasons: extraction.reasons,
        candidate: null,
        audit: auditFromExtraction({
          method: "deterministic",
          parserVersion: null,
          model: null,
          classification: {
            disposition: "review",
            detail: extraction.detail,
          },
          validationOutcome: null,
          candidate: null,
        }),
      });
    }

    const evidence = validateCandidateEvidence(
      work.event,
      extraction.candidate,
    );
    const auditBase = auditFromExtraction({
      method: extraction.method,
      parserVersion: extraction.parserVersion,
      model: extraction.model,
      classification: {
        method: extraction.method,
        closed: extraction.closed,
      },
      validationOutcome: {
        valid: evidence.valid,
        missingEvidence: evidence.missingEvidence,
      },
      candidate: extraction.candidate,
    });

    if (!evidence.valid) {
      return routeToReview(pool, work, {
        reviewReasons: evidence.reviewReasons,
        candidate: extraction.candidate,
        audit: auditBase,
      });
    }

    if (isOutsideProductScope(extraction.candidate)) {
      await completeRawEventWithoutOpportunity(pool, {
        rawEventId: work.rawEventId,
        processingRunId: work.processingRunId,
        leaseToken: work.leaseToken,
        disposition: "ignored",
        reviewReasons: ["unsupported_opportunity"],
        audit: {
          ...auditBase,
          classification: {
            ...(auditBase.classification ?? {}),
            disposition: "ignored",
            reason: "outside_product_scope",
          },
        },
      });
      return {
        disposition: "ignored",
        rawEventId: work.rawEventId,
        opportunityId: null,
        created: false,
        outboxCreated: false,
        reviewReasons: ["unsupported_opportunity"],
      };
    }

    const reviewReasons = reviewReasonsForCandidate(
      extraction.candidate,
      minimumConfidence,
    );
    if (reviewReasons.length > 0) {
      return routeToReview(pool, work, {
        reviewReasons,
        candidate: extraction.candidate,
        audit: auditBase,
      });
    }

    const opportunity = await prepareOpportunity(extraction.candidate, {
      closed: extraction.closed,
      resolveRedirects,
    });

    const fuzzyOpportunityId = await findReviewableFuzzyMatch(
      pool,
      opportunity,
    );
    if (fuzzyOpportunityId !== null) {
      return routeToReview(pool, work, {
        reviewReasons: ["fuzzy_duplicate"],
        candidate: extraction.candidate,
        audit: {
          ...auditBase,
          validationOutcome: {
            ...(auditBase.validationOutcome ?? {}),
            fuzzyOpportunityId,
          },
        },
      });
    }

    const destinationKey =
      options.destinationKey ??
      feedDestinationKey(opportunity.employmentType) ??
      DEFAULT_FEED_DESTINATION_KEY;
    const persisted = await persistProcessedOpportunity(pool, {
      rawEventId: work.rawEventId,
      processingRunId: work.processingRunId,
      leaseToken: work.leaseToken,
      opportunity,
      observedAt: work.event.captured_at,
      audit: auditBase,
      destinationKey,
      outboxPayload: buildOutboxPayload(opportunity),
      enqueueOutbox: opportunity.status === "active",
    });

    return {
      disposition: "processed",
      rawEventId: work.rawEventId,
      opportunityId: persisted.opportunityId,
      created: persisted.created,
      outboxCreated: persisted.outboxCreated,
      reviewReasons: [],
    };
  } catch (error) {
    const detail =
      error instanceof Error ? error.message.slice(0, 1_000) : "unknown_error";
    await failRawEventProcessing(pool, {
      rawEventId: work.rawEventId,
      processingRunId: work.processingRunId,
      leaseToken: work.leaseToken,
      attemptCount: work.attemptCount,
      errorCode: "processing_exception",
      errorDetail: detail,
      audit: {
        ...emptyAudit(),
        classification: { disposition: "failed" },
      },
    });
    return {
      disposition: "failed",
      rawEventId: work.rawEventId,
      opportunityId: null,
      created: false,
      outboxCreated: false,
      reviewReasons: [],
    };
  }
}

export async function processNextEvent(
  pool: Pool,
  options: ProcessNextEventOptions = {},
): Promise<ProcessNextEventResult> {
  const claimOptions: {
    leaseSeconds?: number;
    maxAttempts?: number;
  } = {};
  if (options.leaseSeconds !== undefined) {
    claimOptions.leaseSeconds = options.leaseSeconds;
  }
  if (options.maxAttempts !== undefined) {
    claimOptions.maxAttempts = options.maxAttempts;
  }
  const work = await claimNextRawEvent(pool, claimOptions);
  if (work === null) {
    return { disposition: "idle" };
  }
  return processWorkItem(pool, work, options);
}

export async function processEventBatch(
  pool: Pool,
  options: ProcessNextEventOptions & { limit?: number } = {},
): Promise<ProcessNextEventResult[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 1, 100));
  const results: ProcessNextEventResult[] = [];
  for (let index = 0; index < limit; index += 1) {
    const result = await processNextEvent(pool, options);
    results.push(result);
    if (result.disposition === "idle") {
      break;
    }
  }
  return results;
}
