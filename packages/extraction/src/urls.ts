import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import type { RawEvent } from "@recruiting-help/contracts";

const trackingParameterNames = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "referrer",
  "source",
]);

function trimUrlPunctuation(value: string): string {
  return value.replace(/[),.;!?]+$/u, "");
}

export function extractEvidenceUrls(event: RawEvent): string[] {
  const urls = new Set<string>();
  const text = event.text ?? "";
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/giu)) {
    const value = match[0];
    try {
      urls.add(new URL(trimUrlPunctuation(value)).toString());
    } catch {
      // Malformed source URLs are ignored and never repaired heuristically.
    }
  }
  for (const attachment of event.attachments) {
    urls.add(new URL(attachment.url).toString());
  }
  return [...urls];
}

export function extractLiteralUrls(event: RawEvent): string[] {
  const urls = new Set(extractEvidenceUrls(event));
  if (event.source_url !== null) {
    urls.add(new URL(event.source_url).toString());
  }
  return [...urls];
}

export function canonicalizeApplicationUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error("Application URLs must use HTTPS.");
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error("Application URLs must not contain credentials.");
  }

  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  url.hash = "";
  if (url.port === "443") {
    url.port = "";
  }

  for (const key of [...url.searchParams.keys()]) {
    if (
      key.toLowerCase().startsWith("utm_") ||
      trackingParameterNames.has(key.toLowerCase())
    ) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  if (url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/u, "");
  }

  return url.toString();
}

export type StableJobIdentity = {
  board: string;
  id: string;
};

export function extractStableJobIdentity(
  canonicalUrl: string,
): StableJobIdentity | null {
  const url = new URL(canonicalUrl);
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);

  const explicitId =
    url.searchParams.get("gh_jid") ??
    url.searchParams.get("job_id") ??
    url.searchParams.get("jobId");
  if (explicitId !== null && /^[A-Za-z0-9_-]{3,128}$/u.test(explicitId)) {
    return { board: host, id: explicitId };
  }

  if (host === "jobs.lever.co" && segments.length >= 2) {
    const id = segments.at(-1);
    return id === undefined ? null : { board: "lever", id };
  }
  if (host === "jobs.ashbyhq.com" && segments.length >= 2) {
    const id = segments.at(-1);
    return id === undefined ? null : { board: "ashby", id };
  }
  if (
    (host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io") &&
    segments.length >= 2
  ) {
    const id = segments.at(-1);
    return id === undefined ? null : { board: "greenhouse", id };
  }
  if (host.endsWith(".myworkdayjobs.com") && segments.length >= 1) {
    const id = segments.at(-1);
    return id === undefined ? null : { board: "workday", id };
  }

  return null;
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) {
    return true;
  }
  const [a = 0, b = 0] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return !isPrivateIpv4(address);
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    if (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/u.test(normalized)
    ) {
      return false;
    }
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/u)?.[1];
    return mapped === undefined || !isPrivateIpv4(mapped);
  }
  return false;
}

export type RedirectRequest = (
  url: URL,
  address: string,
  family: 4 | 6,
  timeoutMs: number,
) => Promise<{ status: number; location: string | null }>;

const requestRedirect: RedirectRequest = (url, address, family, timeoutMs) =>
  new Promise((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method: "HEAD",
        headers: {
          "user-agent": "recruiting-help-redirect-resolver/1",
        },
        lookup: (_hostname, _options, callback) => {
          callback(null, address, family);
        },
      },
      (response) => {
        response.resume();
        resolve({
          status: response.statusCode ?? 0,
          location: response.headers.location ?? null,
        });
      },
    );
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error("Redirect request timed out."));
    });
    request.once("error", reject);
    request.end();
  });

export async function resolveSafeRedirects(
  value: string,
  options: {
    maxHops?: number;
    timeoutMs?: number;
    lookupAddresses?: typeof lookup;
    request?: RedirectRequest;
  } = {},
): Promise<string> {
  const maxHops = options.maxHops ?? 3;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const lookupAddresses = options.lookupAddresses ?? lookup;
  const makeRequest = options.request ?? requestRedirect;
  let current = new URL(canonicalizeApplicationUrl(value));

  for (let hop = 0; hop <= maxHops; hop += 1) {
    if (
      current.hostname === "localhost" ||
      current.hostname.endsWith(".local")
    ) {
      throw new Error("Redirect target hostname is not public.");
    }

    const literalFamily = isIP(current.hostname);
    const addresses =
      literalFamily === 0
        ? await lookupAddresses(current.hostname, { all: true, verbatim: true })
        : [
            {
              address: current.hostname,
              family: literalFamily as 4 | 6,
            },
          ];
    const publicAddress = addresses.find(({ address }) =>
      isPublicIpAddress(address),
    );
    if (
      publicAddress === undefined ||
      addresses.some(({ address }) => !isPublicIpAddress(address))
    ) {
      throw new Error("Redirect target resolves to a non-public address.");
    }

    const response = await makeRequest(
      current,
      publicAddress.address,
      publicAddress.family as 4 | 6,
      timeoutMs,
    );
    if (response.status < 300 || response.status >= 400) {
      return canonicalizeApplicationUrl(current.toString());
    }
    if (response.location === null) {
      throw new Error("Redirect response did not provide a location.");
    }
    if (hop === maxHops) {
      throw new Error("Redirect limit exceeded.");
    }
    current = new URL(response.location, current);
    current = new URL(canonicalizeApplicationUrl(current.toString()));
  }

  throw new Error("Redirect resolution failed.");
}
