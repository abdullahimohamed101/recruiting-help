export {
  EXTRACTION_PROMPT_VERSION,
  GeminiStructuredExtractionProvider,
  buildExtractionPrompt,
  type ExtractionPrompt,
  type ModelUsage,
  type StructuredExtractionProvider,
  type StructuredExtractionResult,
} from "./ai.js";
export {
  extractDeterministically,
  type DeterministicExtraction,
} from "./deterministic.js";
export {
  validateCandidateEvidence,
  type EvidenceValidation,
} from "./evidence.js";
export {
  createOpportunityFingerprint,
  employmentTypeLabel,
  employmentTypeSortOrder,
  feedDestinationKey,
  isFuzzyDuplicateCandidate,
  isOutsideProductScope,
  locationDisposition,
  normalizeCompany,
  normalizeRole,
  normalizeText,
  reviewReasonsForCandidate,
  tokenJaccardSimilarity,
} from "./normalization.js";
export {
  enrichRawEventWithJobPages,
  fetchJobPage,
  formatJobPageSnapshot,
  parseJobPageHtml,
  type JobPageFetchRequest,
  type ParsedJobPage,
} from "./page-fetch.js";
export {
  extractOpportunity,
  type ExtractionPipelineResult,
} from "./pipeline.js";
export { classifyRelevance, type RelevanceDecision } from "./relevance.js";
export {
  canonicalizeApplicationUrl,
  extractEvidenceUrls,
  extractLiteralUrls,
  extractStableJobIdentity,
  isPublicIpAddress,
  pinnedLookup,
  resolveSafeRedirects,
  type RedirectRequest,
  type StableJobIdentity,
} from "./urls.js";
