import { describe, expect, it, vi } from "vitest";
import {
  canonicalizeApplicationUrl,
  extractStableJobIdentity,
  isPublicIpAddress,
  resolveSafeRedirects,
  type RedirectRequest,
} from "./urls.js";

describe("canonicalizeApplicationUrl", () => {
  it("removes fragments and tracking while preserving stable job parameters", () => {
    expect(
      canonicalizeApplicationUrl(
        "https://Jobs.Example.com/opening/?utm_source=discord&gh_jid=123&b=2&a=1#apply",
      ),
    ).toBe("https://jobs.example.com/opening?a=1&b=2&gh_jid=123");
  });

  it("rejects insecure or credential-bearing URLs", () => {
    expect(() => canonicalizeApplicationUrl("http://example.com/job")).toThrow(
      "HTTPS",
    );
    expect(() =>
      canonicalizeApplicationUrl("https://user:pass@example.com/job"),
    ).toThrow("credentials");
  });
});

describe("extractStableJobIdentity", () => {
  it.each([
    ["https://jobs.lever.co/acme/abc-123", { board: "lever", id: "abc-123" }],
    [
      "https://job-boards.greenhouse.io/acme/jobs/456",
      { board: "greenhouse", id: "456" },
    ],
    [
      "https://acme.example/jobs?gh_jid=789",
      { board: "acme.example", id: "789" },
    ],
  ])("extracts stable identity from %s", (url, expected) => {
    expect(extractStableJobIdentity(url)).toEqual(expected);
  });
});

describe("SSRF protections", () => {
  it.each([
    ["127.0.0.1", false],
    ["10.1.2.3", false],
    ["169.254.169.254", false],
    ["192.168.1.1", false],
    ["::1", false],
    ["fd00::1", false],
    ["2606:4700:4700::1111", true],
    ["1.1.1.1", true],
  ])("classifies %s public=%s", (address, expected) => {
    expect(isPublicIpAddress(address)).toBe(expected);
  });

  it("rejects any hostname resolving to a private address", async () => {
    await expect(
      resolveSafeRedirects("https://example.com/job", {
        lookupAddresses: vi.fn(() =>
          Promise.resolve([
            { address: "93.184.216.34", family: 4 },
            { address: "127.0.0.1", family: 4 },
          ]),
        ) as never,
        request: vi.fn() as RedirectRequest,
      }),
    ).rejects.toThrow("non-public");
  });

  it("pins each validated public redirect hop", async () => {
    const request = vi
      .fn<RedirectRequest>()
      .mockResolvedValueOnce({
        status: 302,
        location: "https://jobs.example.net/final?utm_source=test",
      })
      .mockResolvedValueOnce({ status: 200, location: null });

    await expect(
      resolveSafeRedirects("https://short.example/job", {
        lookupAddresses: vi.fn(() =>
          Promise.resolve([{ address: "93.184.216.34", family: 4 }]),
        ) as never,
        request,
      }),
    ).resolves.toBe("https://jobs.example.net/final");
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]?.[1]).toBe("93.184.216.34");
  });
});
