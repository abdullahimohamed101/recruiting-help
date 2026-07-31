import {
  claimNextDelivery,
  markDeliveryDead,
  markDeliveryDelivered,
  markDeliveryRetry,
  type Pool,
} from "@recruiting-help/database";
import {
  buildFeedMessage,
  buildReviewMessage,
  type DiscordRestPublisher,
} from "@recruiting-help/discord";

export type DeliveryChannelMap = {
  feedChannelId: string;
  reviewChannelId: string;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
}

export async function deliverOutboxBatch(input: {
  pool: Pool;
  publisher: DiscordRestPublisher;
  channels: DeliveryChannelMap;
  limit?: number;
}): Promise<Array<Record<string, unknown>>> {
  const limit = Math.max(1, Math.min(input.limit ?? 1, 50));
  const results: Array<Record<string, unknown>> = [];

  for (let index = 0; index < limit; index += 1) {
    const work = await claimNextDelivery(input.pool);
    if (work === null) {
      results.push({ disposition: "idle" });
      break;
    }

    if (work.destinationType === "notion") {
      await markDeliveryDead(input.pool, {
        deliveryId: work.deliveryId,
        leaseToken: work.leaseToken,
        error: "notion_not_implemented",
      });
      results.push({
        disposition: "dead",
        delivery_id: work.deliveryId,
        reason: "notion_not_implemented",
      });
      continue;
    }

    const channelId =
      work.destinationType === "discord_review"
        ? input.channels.reviewChannelId
        : input.channels.feedChannelId;

    const payload = work.payload;
    const message =
      work.destinationType === "discord_review"
        ? buildReviewMessage({
            opportunityId: work.opportunityId,
            reviewReasons: asStringArray(payload.review_reasons),
            excerpt: asString(payload.description_excerpt),
            company: asString(payload.company),
            role: asString(payload.role),
            applicationUrl: asString(payload.application_url),
            sourceUrl: asString(payload.source_url),
          })
        : buildFeedMessage({
            opportunityId: work.opportunityId,
            company: asString(payload.company),
            role: asString(payload.role),
            locations: asStringArray(payload.locations),
            season: asString(payload.season),
            year: asNumber(payload.year),
            employmentType: asString(payload.employment_type),
            categoryLabel: asString(payload.category_label),
            sponsorshipStatus: asString(payload.sponsorship_status),
            applicationUrl: asString(payload.application_url),
            deadline: asString(payload.deadline),
            sourceUrl: asString(payload.source_url),
            confidence: asNumber(payload.confidence),
          });

    const publish = await input.publisher.sendChannelMessage(
      channelId,
      message,
    );
    if (publish.kind === "delivered") {
      await markDeliveryDelivered(input.pool, {
        deliveryId: work.deliveryId,
        leaseToken: work.leaseToken,
        externalMessageId: publish.messageId,
      });
      results.push({
        disposition: "delivered",
        delivery_id: work.deliveryId,
        message_id: publish.messageId,
      });
      continue;
    }
    if (publish.kind === "rate_limited") {
      await markDeliveryRetry(input.pool, {
        deliveryId: work.deliveryId,
        leaseToken: work.leaseToken,
        attemptCount: work.attemptCount,
        error: publish.detail,
        retryAfterSeconds: publish.retryAfterSeconds,
      });
      results.push({
        disposition: "retry",
        delivery_id: work.deliveryId,
        reason: publish.detail,
      });
      continue;
    }
    if (publish.kind === "retryable") {
      await markDeliveryRetry(input.pool, {
        deliveryId: work.deliveryId,
        leaseToken: work.leaseToken,
        attemptCount: work.attemptCount,
        error: publish.detail,
      });
      results.push({
        disposition: "retry",
        delivery_id: work.deliveryId,
        reason: publish.detail,
      });
      continue;
    }
    await markDeliveryDead(input.pool, {
      deliveryId: work.deliveryId,
      leaseToken: work.leaseToken,
      error: publish.detail,
    });
    results.push({
      disposition: "dead",
      delivery_id: work.deliveryId,
      reason: publish.detail,
    });
  }

  return results;
}
