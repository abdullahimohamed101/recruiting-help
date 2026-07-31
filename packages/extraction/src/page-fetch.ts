import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import type { RawEvent } from "@recruiting-help/contracts";
import {
  canonicalizeApplicationUrl,
  extractEvidenceUrls,
  isPublicIpAddress,
  pinnedLookup,
} from "./urls.js";

const MAX_BODY_BYTES = 512 * 1024;
const MAX_PAGES = 2;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_REDIRECT_HOPS = 3;

export type JobPageFetchRequest = (
  url: URL,
  address: string,
  family: 4 | 6,
  timeoutMs: number,
) => Promise<{
  status: number;
  location: string | null;
  contentType: string | null;
  body: string;
}>;

export type ParsedJobPage = {
  finalUrl: string;
  title: string | null;
  company: string | null;
  role: string | null;
  locations: string[];
  descriptionText: string | null;
};

const defaultFetchRequest: JobPageFetchRequest = (
  url,
  address,
  family,
  timeoutMs,
) =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const request = httpsRequest(
      url,
      {
        method: "GET",
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "recruiting-help-job-page-fetcher/1",
        },
        lookup: pinnedLookup(address, family),
      },
      (response) => {
        response.on("data", (chunk: Buffer) => {
          total += chunk.byteLength;
          if (total > MAX_BODY_BYTES) {
            request.destroy(
              new Error("Job page response exceeded size limit."),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            location: response.headers.location ?? null,
            contentType: response.headers["content-type"] ?? null,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
        response.on("error", reject);
      },
    );
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error("Job page request timed out."));
    });
    request.once("error", reject);
    request.end();
  });

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'")
    .replace(/&nbsp;/giu, " ")
    .replace(/&#(\d+);/gu, (_match, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/giu, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

function stripTags(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
      .replace(/<[^>]+>/gu, " ")
      .replace(/\s+/gu, " ")
      .trim(),
  );
}

function metaContent(html: string, property: string): string | null {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["'][^>]*>|<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["'][^>]*>`,
    "iu",
  );
  const match = html.match(pattern);
  const value = match?.[1] ?? match?.[2] ?? null;
  return value === null || value.trim().length === 0
    ? null
    : decodeHtmlEntities(value.trim());
}

function firstHeading(html: string): string | null {
  const match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/iu);
  if (match?.[1] === undefined) {
    return null;
  }
  const text = stripTags(match[1]);
  return text.length === 0 ? null : text;
}

function pageTitle(html: string): string | null {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu);
  if (match?.[1] === undefined) {
    return null;
  }
  const text = decodeHtmlEntities(match[1].replace(/\s+/gu, " ").trim());
  return text.length === 0 ? null : text;
}

function locationFromJsonLd(value: unknown): string[] {
  if (value === null || value === undefined) {
    return [];
  }
  const entries = Array.isArray(value) ? value : [value];
  const locations: string[] = [];
  for (const entry of entries) {
    if (typeof entry === "string" && entry.trim().length > 0) {
      locations.push(entry.trim());
      continue;
    }
    if (entry === null || typeof entry !== "object") {
      continue;
    }
    const place = entry as {
      address?: unknown;
      name?: unknown;
    };
    if (typeof place.name === "string" && place.name.trim().length > 0) {
      locations.push(place.name.trim());
      continue;
    }
    const address = place.address;
    if (typeof address === "string" && address.trim().length > 0) {
      locations.push(address.trim());
      continue;
    }
    if (address !== null && typeof address === "object") {
      const postal = address as {
        addressLocality?: unknown;
        addressRegion?: unknown;
        addressCountry?: unknown;
      };
      const parts = [
        postal.addressLocality,
        postal.addressRegion,
        postal.addressCountry,
      ]
        .filter((part): part is string => typeof part === "string")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      if (parts.length > 0) {
        // Prefer "City, ST" when country is US.
        if (parts.length >= 2 && parts.at(-1)?.toUpperCase() === "US") {
          locations.push(`${parts[0]}, ${parts[1]}`);
        } else {
          locations.push(parts.join(", "));
        }
      }
    }
  }
  return [...new Set(locations)];
}

function asJobPosting(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const posting = asJobPosting(entry);
      if (posting !== null) {
        return posting;
      }
    }
    return null;
  }
  if (value === null || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const type = record["@type"];
  const types = Array.isArray(type) ? type : [type];
  if (types.some((entry) => entry === "JobPosting")) {
    return record;
  }
  if (Array.isArray(record["@graph"])) {
    return asJobPosting(record["@graph"]);
  }
  return null;
}

function parseJsonLdJobPosting(html: string): {
  company: string | null;
  role: string | null;
  locations: string[];
  descriptionText: string | null;
} | null {
  for (const match of html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu,
  )) {
    const raw = match[1]?.trim();
    if (raw === undefined || raw.length === 0) {
      continue;
    }
    try {
      const posting = asJobPosting(JSON.parse(raw) as unknown);
      if (posting === null) {
        continue;
      }
      const org = posting.hiringOrganization;
      let company: string | null = null;
      if (typeof org === "string") {
        company = org.trim() || null;
      } else if (org !== null && typeof org === "object") {
        const name = (org as { name?: unknown }).name;
        company =
          typeof name === "string" && name.trim().length > 0
            ? name.trim()
            : null;
      }
      const role =
        typeof posting.title === "string" && posting.title.trim().length > 0
          ? decodeHtmlEntities(posting.title.trim())
          : null;
      const descriptionText =
        typeof posting.description === "string"
          ? stripTags(posting.description).slice(0, 2_000) || null
          : null;
      return {
        company,
        role,
        locations: locationFromJsonLd(posting.jobLocation),
        descriptionText,
      };
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  }
  return null;
}

export function parseJobPageHtml(
  html: string,
  finalUrl: string,
): ParsedJobPage {
  const jsonLd = parseJsonLdJobPosting(html);
  const ogTitle = metaContent(html, "og:title");
  const title = pageTitle(html);
  const heading = firstHeading(html);
  const role =
    jsonLd?.role ??
    ogTitle?.replace(/\s*\|\s*.*$/u, "").trim() ??
    heading ??
    title?.replace(/\s*\|\s*.*$/u, "").trim() ??
    null;
  const company =
    jsonLd?.company ??
    metaContent(html, "og:site_name")?.replace(/\s+Recruiting$/u, "") ??
    null;
  const locations = jsonLd?.locations ?? [];
  const descriptionText =
    jsonLd?.descriptionText ??
    metaContent(html, "og:description") ??
    metaContent(html, "description");

  return {
    finalUrl,
    title,
    company,
    role,
    locations,
    descriptionText,
  };
}

export function formatJobPageSnapshot(
  page: ParsedJobPage,
  originalUrl: string,
): string {
  const lines = ["Fetched job posting snapshot (trusted fetch):"];
  if (page.company !== null) {
    lines.push(`Company: ${page.company}`);
  }
  if (page.role !== null) {
    lines.push(`Role: ${page.role}`);
  }
  if (page.locations.length > 0) {
    lines.push(`Location: ${page.locations.join("; ")}`);
  }
  if (page.descriptionText !== null) {
    lines.push(`Description: ${page.descriptionText}`);
  }
  lines.push(originalUrl);
  if (page.finalUrl !== originalUrl) {
    lines.push(page.finalUrl);
  }
  return lines.join("\n");
}

function looksLikeJobApplicationUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = `${parsed.pathname}${parsed.search}`.toLowerCase();
    if (
      /(?:^|\.)(?:ashbyhq\.com|greenhouse\.io|lever\.co|myworkdayjobs\.com|workdayjobs\.com|smartrecruiters\.com|icims\.com|jobvite\.com|rippling\.com)$/u.test(
        host,
      ) ||
      /(?:^|\.)jobs\.|careers\./u.test(host) ||
      host.startsWith("ats.")
    ) {
      return true;
    }
    return /\/(?:jobs?|careers?|apply|application)(?:\/|$|\?)/u.test(path);
  } catch {
    return false;
  }
}

async function resolvePublicAddress(
  hostname: string,
  lookupAddresses: JobPageLookupAddresses,
): Promise<{ address: string; family: 4 | 6 }> {
  if (hostname === "localhost" || hostname.endsWith(".local")) {
    throw new Error("Job page hostname is not public.");
  }
  const literalFamily = isIP(hostname);
  const addresses =
    literalFamily === 0
      ? await lookupAddresses(hostname, { all: true, verbatim: true })
      : [{ address: hostname, family: literalFamily as 4 | 6 }];
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => !isPublicIpAddress(address))
  ) {
    throw new Error("Job page resolves to a non-public address.");
  }
  // Prefer IPv4 when available — some Docker networks have broken IPv6 egress.
  const publicAddress =
    addresses.find(
      ({ address, family }) => family === 4 && isPublicIpAddress(address),
    ) ?? addresses.find(({ address }) => isPublicIpAddress(address));
  if (publicAddress === undefined) {
    throw new Error("Job page resolves to a non-public address.");
  }
  return {
    address: publicAddress.address,
    family: publicAddress.family as 4 | 6,
  };
}

export type JobPageLookupAddresses = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<Array<{ address: string; family: number }>>;

export async function fetchJobPage(
  value: string,
  options: {
    timeoutMs?: number;
    lookupAddresses?: JobPageLookupAddresses;
    request?: JobPageFetchRequest;
  } = {},
): Promise<ParsedJobPage | null> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const lookupAddresses: JobPageLookupAddresses =
    options.lookupAddresses ?? ((hostname, opts) => lookup(hostname, opts));
  const makeRequest = options.request ?? defaultFetchRequest;
  let current = new URL(canonicalizeApplicationUrl(value));

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    const { address, family } = await resolvePublicAddress(
      current.hostname,
      lookupAddresses,
    );
    const response = await makeRequest(current, address, family, timeoutMs);
    if (response.status >= 300 && response.status < 400) {
      if (response.location === null) {
        return null;
      }
      if (hop === MAX_REDIRECT_HOPS) {
        return null;
      }
      current = new URL(
        canonicalizeApplicationUrl(
          new URL(response.location, current).toString(),
        ),
      );
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      return null;
    }
    const contentType = response.contentType?.toLowerCase() ?? "";
    if (
      contentType.length > 0 &&
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml")
    ) {
      return null;
    }
    return parseJobPageHtml(response.body, current.toString());
  }
  return null;
}

/**
 * Trusted enrichment: fetch ATS/job pages and append labeled Company/Role/Location
 * snapshots into event.text so deterministic + AI extractors can use posting content
 * without giving the model network access.
 */
export async function enrichRawEventWithJobPages(
  event: RawEvent,
  options: {
    timeoutMs?: number;
    lookupAddresses?: JobPageLookupAddresses;
    request?: JobPageFetchRequest;
    fetchPage?: typeof fetchJobPage;
  } = {},
): Promise<{ event: RawEvent; enrichedUrls: string[] }> {
  const candidates = extractEvidenceUrls(event)
    .filter((url) => looksLikeJobApplicationUrl(url))
    .slice(0, MAX_PAGES);
  if (candidates.length === 0) {
    return { event, enrichedUrls: [] };
  }

  const fetchPage = options.fetchPage ?? fetchJobPage;
  const snapshots: string[] = [];
  const enrichedUrls: string[] = [];
  for (const url of candidates) {
    try {
      const page = await fetchPage(url, options);
      if (page === null) {
        console.error(
          JSON.stringify({
            level: "warn",
            event: "job_page_fetch_empty",
            url,
          }),
        );
        continue;
      }
      if (page.company === null && page.role === null) {
        console.error(
          JSON.stringify({
            level: "warn",
            event: "job_page_fetch_unparsed",
            url,
            final_url: page.finalUrl,
          }),
        );
        continue;
      }
      snapshots.push(formatJobPageSnapshot(page, url));
      enrichedUrls.push(url);
    } catch (error) {
      // Soft-fail: leave the original event for review/AI/URL heuristics.
      console.error(
        JSON.stringify({
          level: "warn",
          event: "job_page_fetch_failed",
          url,
          detail: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  if (snapshots.length === 0) {
    return { event, enrichedUrls: [] };
  }

  const originalText = event.text ?? "";
  // Only enrich text (discord metadata schemas are strict). Keep original URL
  // lines so application_url evidence still matches literal pasted links.
  return {
    event: {
      ...event,
      text: [originalText, "", ...snapshots].join("\n").trim(),
    },
    enrichedUrls,
  };
}
