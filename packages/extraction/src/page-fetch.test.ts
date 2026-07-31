import { describe, expect, it } from "vitest";
import {
  enrichRawEventWithJobPages,
  formatJobPageSnapshot,
  parseJobPageHtml,
  type JobPageFetchRequest,
} from "./page-fetch.js";
import type { RawEvent } from "@recruiting-help/contracts";
import { extractDeterministically } from "./deterministic.js";
import { reviewReasonsForCandidate } from "./normalization.js";

const ripplingHtml = `<!doctype html><html><head>
<title>Machine Learning Software Engineer Intern - Winter 2027 | Current Openings</title>
<meta property="og:site_name" content="Rippling Recruiting"/>
<meta property="og:title" content="Machine Learning Software Engineer Intern - Winter 2027 | Current Openings"/>
<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "JobPosting",
  title: "Machine Learning Software Engineer Intern - Winter 2027",
  description: "<p>About the Role</p><p>Join the Machine Learning Team.</p>",
  hiringOrganization: { "@type": "Organization", name: "Rippling" },
  jobLocation: {
    "@type": "Place",
    address: {
      "@type": "PostalAddress",
      addressLocality: "San Francisco",
      addressRegion: "CA",
      addressCountry: "US",
    },
  },
})}</script>
</head><body><h1>Machine Learning Software Engineer Intern - Winter 2027</h1></body></html>`;

function makeEvent(text: string): RawEvent {
  return {
    schema_version: 1,
    source: "discord_manual",
    source_account: "1532181443441201305",
    source_event_id: "discord:msg:1",
    occurred_at: null,
    captured_at: new Date().toISOString(),
    author_display: null,
    text,
    source_url: null,
    attachments: [],
    metadata: {
      guild_id: "1532181443441201305",
      channel_id: "1",
      message_id: "1",
      forwarded: false,
    },
  };
}

describe("parseJobPageHtml", () => {
  it("extracts JobPosting JSON-LD fields from Rippling HTML", () => {
    const page = parseJobPageHtml(
      ripplingHtml,
      "https://ats.rippling.com/rippling/jobs/82c13e8f-ae96-4c60-a872-c0ddf9eb0781",
    );
    expect(page).toMatchObject({
      company: "Rippling",
      role: "Machine Learning Software Engineer Intern - Winter 2027",
      locations: ["San Francisco, CA"],
    });
    expect(page.descriptionText).toContain("About the Role");
  });
});

describe("enrichRawEventWithJobPages", () => {
  it("appends labeled snapshot so deterministic extraction can publish", async () => {
    const url =
      "https://ats.rippling.com/rippling/jobs/82c13e8f-ae96-4c60-a872-c0ddf9eb0781?jobSite=LinkedIn";
    const request: JobPageFetchRequest = () =>
      Promise.resolve({
        status: 200,
        location: null,
        contentType: "text/html; charset=utf-8",
        body: ripplingHtml,
      });

    const { event, enrichedUrls } = await enrichRawEventWithJobPages(
      makeEvent(url),
      {
        request,
        lookupAddresses: () =>
          Promise.resolve([{ address: "1.2.3.4", family: 4 as const }]),
      },
    );

    expect(enrichedUrls).toEqual([
      "https://ats.rippling.com/rippling/jobs/82c13e8f-ae96-4c60-a872-c0ddf9eb0781?jobSite=LinkedIn",
    ]);
    expect(event.text).toContain("Company: Rippling");
    expect(event.text).toContain(
      "Role: Machine Learning Software Engineer Intern - Winter 2027",
    );

    const extracted = extractDeterministically(event);
    expect(extracted?.candidate).toMatchObject({
      company: "Rippling",
      role: "Machine Learning Software Engineer Intern - Winter 2027",
      locations: ["San Francisco, CA"],
      season: "winter",
      year: 2027,
      employment_type: "internship",
    });
    expect(reviewReasonsForCandidate(extracted!.candidate, 0.85)).toEqual([]);
  });

  it("skips non-job URLs", async () => {
    const { enrichedUrls, event } = await enrichRawEventWithJobPages(
      makeEvent("https://www.fandango.com/movies"),
      {
        request: () => Promise.reject(new Error("should not fetch")),
      },
    );
    expect(enrichedUrls).toEqual([]);
    expect(event.text).toBe("https://www.fandango.com/movies");
  });
});

describe("formatJobPageSnapshot", () => {
  it("emits labeled fields for parsers", () => {
    expect(
      formatJobPageSnapshot(
        {
          finalUrl: "https://ats.rippling.com/rippling/jobs/abc",
          title: null,
          company: "Rippling",
          role: "Intern",
          locations: ["Remote US"],
          descriptionText: null,
        },
        "https://ats.rippling.com/rippling/jobs/abc",
      ),
    ).toContain("Company: Rippling");
  });
});
