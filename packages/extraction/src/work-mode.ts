export type WorkMode = "Remote" | "Hybrid" | "On-site";

/**
 * Infer work mode from location strings and free text.
 * Returns null when there is no explicit signal (do not guess On-site from a city alone).
 */
export function inferWorkMode(
  locations: readonly string[],
  text = "",
): WorkMode | null {
  const haystack = [...locations, text].join("\n").toLowerCase();
  if (haystack.trim().length === 0) {
    return null;
  }
  if (/\bhybrid\b/u.test(haystack)) {
    return "Hybrid";
  }
  if (
    /\bremote(?:[- ]?(?:us|usa|united states))?\b/u.test(haystack) ||
    /\btelecommut(?:e|ing)\b/u.test(haystack) ||
    /\bwork from home\b/u.test(haystack) ||
    /\bwfh\b/u.test(haystack)
  ) {
    return "Remote";
  }
  if (
    /\bon[ -]?site\b/u.test(haystack) ||
    /\bin[ -]?office\b/u.test(haystack)
  ) {
    return "On-site";
  }
  return null;
}

/** First readable sentence for feed embeds (strips leading "About the Role" noise). */
export function oneLineExcerpt(
  description: string | null | undefined,
  maxLength = 180,
): string | null {
  if (description === null || description === undefined) {
    return null;
  }
  let text = description.replace(/\s+/gu, " ").trim();
  if (text.length === 0) {
    return null;
  }
  text = text.replace(
    /^(?:about the role|about this role|the role)\s*[:\-–]?\s*/iu,
    "",
  );
  const sentence = text.match(/^(.+?[.!?])(?:\s|$)/u)?.[1] ?? text;
  const clipped = sentence.trim();
  if (clipped.length === 0) {
    return null;
  }
  if (clipped.length <= maxLength) {
    return clipped;
  }
  return `${clipped.slice(0, maxLength - 1).trimEnd()}…`;
}

export function formatPostedDate(
  iso: string | null | undefined,
): string | null {
  if (iso === null || iso === undefined || iso.trim().length === 0) {
    return null;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    // Allow bare YYYY-MM-DD from labeled snapshots.
    const bare = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
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
