import { z } from "zod";

export const CONTRACT_SCHEMA_VERSION = 1 as const;

export const SourceTypeSchema = z.enum([
  "github",
  "discord_browser",
  "slack_api",
  "slack_browser",
  "instagram_browser",
  "discord_manual",
  "slack_manual",
  "instagram_manual",
]);

export const AttachmentSchema = z
  .object({
    type: z.enum(["image", "file", "embed"]),
    url: z.url(),
    content_type: z.string().trim().min(1).max(255).nullable(),
    filename: z.string().trim().min(1).max(512).nullable().optional(),
  })
  .strict();

const githubMetadataSchema = z
  .object({
    repository: z.string().trim().min(3).max(255),
    branch: z.string().trim().min(1).max(255),
    path: z.string().trim().min(1).max(1024),
    commit_sha: z
      .string()
      .regex(/^[a-f0-9]{40}$/i)
      .nullable(),
    row_index: z.number().int().nonnegative().nullable(),
  })
  .strict();

const discordMetadataSchema = z
  .object({
    guild_id: z.string().regex(/^\d+$/),
    channel_id: z.string().regex(/^\d+$/),
    message_id: z.string().regex(/^\d+$/),
    forwarded: z.boolean(),
  })
  .strict();

const slackMetadataSchema = z
  .object({
    workspace: z.string().trim().min(1).max(255),
    channel_id: z.string().trim().min(1).max(255),
    message_ts: z.string().regex(/^\d+\.\d+$/),
    thread_ts: z
      .string()
      .regex(/^\d+\.\d+$/)
      .nullable(),
  })
  .strict();

const instagramMetadataSchema = z
  .object({
    username: z.string().trim().min(1).max(64),
    media_id: z.string().trim().min(1).max(255),
    media_type: z.enum(["post", "reel", "story"]),
    shortcode: z.string().trim().min(1).max(64).nullable(),
  })
  .strict();

const rawEventCommon = {
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  source_account: z.string().trim().min(1).max(512),
  source_event_id: z.string().trim().min(1).max(1024),
  source_url: z.url().nullable(),
  occurred_at: z.string().datetime({ offset: true }).nullable(),
  captured_at: z.string().datetime({ offset: true }),
  author_display: z.string().trim().min(1).max(512).nullable(),
  text: z.string().max(100_000).nullable(),
  attachments: z.array(AttachmentSchema).max(20),
};

export const RawEventSchema = z.discriminatedUnion("source", [
  z
    .object({
      ...rawEventCommon,
      source: z.literal("github"),
      metadata: githubMetadataSchema,
    })
    .strict(),
  z
    .object({
      ...rawEventCommon,
      source: z.literal("discord_browser"),
      metadata: discordMetadataSchema,
    })
    .strict(),
  z
    .object({
      ...rawEventCommon,
      source: z.literal("discord_manual"),
      metadata: discordMetadataSchema,
    })
    .strict(),
  z
    .object({
      ...rawEventCommon,
      source: z.literal("slack_api"),
      metadata: slackMetadataSchema,
    })
    .strict(),
  z
    .object({
      ...rawEventCommon,
      source: z.literal("slack_browser"),
      metadata: slackMetadataSchema,
    })
    .strict(),
  z
    .object({
      ...rawEventCommon,
      source: z.literal("slack_manual"),
      metadata: slackMetadataSchema,
    })
    .strict(),
  z
    .object({
      ...rawEventCommon,
      source: z.literal("instagram_browser"),
      metadata: instagramMetadataSchema,
    })
    .strict(),
  z
    .object({
      ...rawEventCommon,
      source: z.literal("instagram_manual"),
      metadata: instagramMetadataSchema,
    })
    .strict(),
]);

export const EmploymentTypeSchema = z.enum(["internship", "co_op", "new_grad"]);
export const SeasonSchema = z.enum(["spring", "summer", "fall", "winter"]);
export const SponsorshipStatusSchema = z.enum([
  "unknown",
  "offers_or_considers",
  "does_not_offer",
  "us_citizenship_required",
]);
export const RawEventStatusSchema = z.enum([
  "pending",
  "processing",
  "processed",
  "review",
  "ignored",
  "failed",
]);
export const OpportunityStatusSchema = z.enum([
  "active",
  "expired",
  "closed",
  "duplicate",
  "rejected",
]);
export const DeliveryStatusSchema = z.enum([
  "pending",
  "delivering",
  "delivered",
  "retry",
  "dead",
]);
export const ConnectorHealthStateSchema = z.enum([
  "healthy",
  "stale",
  "reauth_required",
  "selector_broken",
  "rate_limited",
  "disabled",
]);

export const ReviewReasonSchema = z.enum([
  "missing_company",
  "missing_role",
  "missing_application_url",
  "ambiguous_year",
  "ambiguous_geography",
  "low_confidence",
  "fuzzy_duplicate",
  "invalid_evidence",
  "unsupported_opportunity",
  "ai_unavailable",
]);

export const ProcessingDispositionSchema = z.enum([
  "processed",
  "ignored",
  "review",
  "failed",
]);

export const ExtractionMethodSchema = z.enum(["deterministic", "ai"]);

export const OpportunityCandidateSchema = z
  .object({
    schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
    company: z.string().trim().min(1).max(512).nullable(),
    role: z.string().trim().min(1).max(1024).nullable(),
    locations: z.array(z.string().trim().min(1).max(512)).max(50),
    season: SeasonSchema.nullable(),
    year: z.number().int().min(2020).max(2100).nullable(),
    employment_type: EmploymentTypeSchema.nullable(),
    sponsorship_status: SponsorshipStatusSchema,
    application_url: z.url().nullable(),
    deadline: z.string().date().nullable(),
    posted_at: z.string().datetime({ offset: true }).nullable(),
    source_url: z.url().nullable(),
    description_excerpt: z.string().trim().min(1).max(2_000).nullable(),
    confidence: z.number().min(0).max(1),
    evidence: z.record(z.string(), z.string().max(4_000)),
  })
  .strict();

export type SourceType = z.infer<typeof SourceTypeSchema>;
export type Attachment = z.infer<typeof AttachmentSchema>;
export type RawEvent = z.infer<typeof RawEventSchema>;
export type OpportunityCandidate = z.infer<typeof OpportunityCandidateSchema>;
export type EmploymentType = z.infer<typeof EmploymentTypeSchema>;
export type Season = z.infer<typeof SeasonSchema>;
export type SponsorshipStatus = z.infer<typeof SponsorshipStatusSchema>;
export type RawEventStatus = z.infer<typeof RawEventStatusSchema>;
export type OpportunityStatus = z.infer<typeof OpportunityStatusSchema>;
export type DeliveryStatus = z.infer<typeof DeliveryStatusSchema>;
export type ConnectorHealthState = z.infer<typeof ConnectorHealthStateSchema>;
export type ReviewReason = z.infer<typeof ReviewReasonSchema>;
export type ProcessingDisposition = z.infer<typeof ProcessingDispositionSchema>;
export type ExtractionMethod = z.infer<typeof ExtractionMethodSchema>;
