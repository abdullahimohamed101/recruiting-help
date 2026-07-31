import { escapeDiscordMarkdown, truncateDiscordText } from "./escape.js";

export type DiscordEmbedField = {
  name: string;
  value: string;
  inline?: boolean;
};

export type DiscordEmbed = {
  title?: string;
  url?: string;
  description?: string;
  fields?: DiscordEmbedField[];
  footer?: { text: string };
  timestamp?: string;
  color?: number;
};

export type DiscordMessagePayload = {
  content?: string;
  embeds: DiscordEmbed[];
  allowed_mentions: { parse: [] };
};

export type FeedEmbedInput = {
  opportunityId: string;
  company: string | null;
  role: string | null;
  locations: string[];
  season: string | null;
  year: number | null;
  employmentType: string | null;
  categoryLabel?: string | null;
  workMode?: string | null;
  sponsorshipStatus: string | null;
  applicationUrl: string | null;
  deadline: string | null;
  postedAt?: string | null;
  descriptionExcerpt?: string | null;
  sourceUrl: string | null;
  confidence: number | null;
  discoveredAt?: string | null;
};

export type ReviewEmbedInput = {
  opportunityId: string;
  reviewReasons: string[];
  excerpt: string | null;
  company?: string | null;
  role?: string | null;
  applicationUrl?: string | null;
  sourceUrl?: string | null;
};

export type OpsAlertEmbedInput = {
  workflowName: string;
  errorCategory: string;
  attemptCount?: number | null;
  nextRetryAt?: string | null;
  executionUrl?: string | null;
  sourceConfigId?: string | null;
};

function field(
  name: string,
  value: string | null | undefined,
  inline = true,
): DiscordEmbedField | null {
  if (value === null || value === undefined || value.trim().length === 0) {
    return null;
  }
  return {
    name,
    value: truncateDiscordText(escapeDiscordMarkdown(value), 1_024),
    inline,
  };
}

function seasonYearLine(
  season: string | null,
  year: number | null,
): string | null {
  if (season === null && year === null) {
    return null;
  }
  if (season !== null && year !== null) {
    return `${season[0]?.toUpperCase() ?? ""}${season.slice(1)} ${year}`;
  }
  return season ?? year?.toString() ?? null;
}

function formatPostedLabel(postedAt: string | null | undefined): string | null {
  if (
    postedAt === null ||
    postedAt === undefined ||
    postedAt.trim().length === 0
  ) {
    return null;
  }
  const date = new Date(postedAt);
  if (Number.isNaN(date.getTime())) {
    const bare = postedAt.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
    if (bare === null) {
      return null;
    }
    const parsed = new Date(
      Date.UTC(Number(bare[1]), Number(bare[2]) - 1, Number(bare[3])),
    );
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function sponsorshipLabel(status: string | null): string | null {
  if (status === null || status === "unknown") {
    return null;
  }
  switch (status) {
    case "does_not_offer":
      return "Does not offer";
    case "us_citizenship_required":
      return "US citizenship required";
    case "offers":
      return "Offers sponsorship";
    default:
      return status;
  }
}

function oneLineAbout(excerpt: string | null | undefined): string | null {
  if (excerpt === null || excerpt === undefined) {
    return null;
  }
  let text = excerpt.replace(/\s+/gu, " ").trim();
  text = text.replace(
    /^(?:about the role|about this role|the role)\s*[:\-–]?\s*/iu,
    "",
  );
  if (text.length === 0) {
    return null;
  }
  const sentence = text.match(/^(.+?[.!?])(?:\s|$)/u)?.[1] ?? text;
  return sentence.trim().slice(0, 180);
}

export function buildFeedMessage(input: FeedEmbedInput): DiscordMessagePayload {
  const company = input.company ?? "Unknown company";
  const role = input.role ?? "Unknown role";
  const category = input.categoryLabel ?? input.employmentType ?? "Opportunity";
  const title = truncateDiscordText(
    escapeDiscordMarkdown(`${role} — ${company}`),
    256,
  );
  const descriptionParts = [
    escapeDiscordMarkdown(category),
    seasonYearLine(input.season, input.year),
    input.locations.length > 0
      ? escapeDiscordMarkdown(input.locations.join(" · "))
      : null,
    input.workMode !== null &&
    input.workMode !== undefined &&
    input.workMode.trim().length > 0
      ? escapeDiscordMarkdown(input.workMode.trim())
      : null,
  ].filter((value): value is string => value !== null && value.length > 0);

  const about = oneLineAbout(input.descriptionExcerpt ?? null);
  const fields = [
    field("Posted", formatPostedLabel(input.postedAt ?? null)),
    field("Deadline", input.deadline),
    field("Sponsorship", sponsorshipLabel(input.sponsorshipStatus)),
    field("About", about, false),
    field("Source", input.sourceUrl, false),
  ].filter((value): value is DiscordEmbedField => value !== null);

  const embed: DiscordEmbed = {
    title,
    description: truncateDiscordText(descriptionParts.join(" · "), 4_096),
    fields,
    footer: {
      text: truncateDiscordText(
        `Opportunity ID: ${input.opportunityId}`,
        2_048,
      ),
    },
    timestamp: input.discoveredAt ?? new Date().toISOString(),
    color: 0x2f6fed,
  };
  if (input.applicationUrl !== null) {
    embed.url = input.applicationUrl;
  }

  return {
    embeds: [embed],
    allowed_mentions: { parse: [] },
  };
}

export function buildReviewMessage(
  input: ReviewEmbedInput,
): DiscordMessagePayload {
  const reasons =
    input.reviewReasons.length === 0
      ? "unspecified"
      : input.reviewReasons.map(escapeDiscordMarkdown).join(", ");
  const fields = [
    field("Company", input.company ?? "Missing"),
    field("Role", input.role ?? "Missing"),
    field("Application URL", input.applicationUrl ?? "Missing", false),
    field("Reasons", reasons, false),
    field("Source", input.sourceUrl, false),
  ].filter((value): value is DiscordEmbedField => value !== null);

  return {
    embeds: [
      {
        title: "Review required",
        description:
          input.excerpt === null
            ? "No source excerpt available."
            : truncateDiscordText(escapeDiscordMarkdown(input.excerpt), 4_096),
        fields,
        footer: {
          text: truncateDiscordText(
            `Opportunity ID: ${input.opportunityId}`,
            2_048,
          ),
        },
        color: 0xc9933c,
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

export function buildOpsAlertMessage(
  input: OpsAlertEmbedInput,
): DiscordMessagePayload {
  const fields = [
    field("Workflow", input.workflowName),
    field("Category", input.errorCategory),
    field(
      "Attempt",
      input.attemptCount === null || input.attemptCount === undefined
        ? null
        : String(input.attemptCount),
    ),
    field("Next retry", input.nextRetryAt ?? "n/a"),
    field("Source config", input.sourceConfigId ?? null),
    field("Execution", input.executionUrl ?? null, false),
  ].filter((value): value is DiscordEmbedField => value !== null);

  return {
    content: "Aggregator operations alert",
    embeds: [
      {
        title: "Workflow failure",
        fields,
        color: 0xb42318,
      },
    ],
    allowed_mentions: { parse: [] },
  };
}
