import { describe, expect, it } from "vitest";
import {
  formatPostedDate,
  inferWorkMode,
  oneLineExcerpt,
} from "./work-mode.js";

describe("inferWorkMode", () => {
  it("detects remote, hybrid, and on-site signals", () => {
    expect(inferWorkMode(["Remote US"])).toBe("Remote");
    expect(inferWorkMode([], "Hybrid role in NYC")).toBe("Hybrid");
    expect(inferWorkMode([], "This internship is on-site in SF")).toBe(
      "On-site",
    );
  });

  it("does not guess on-site from a city alone", () => {
    expect(inferWorkMode(["San Francisco, CA"])).toBeNull();
  });
});

describe("oneLineExcerpt", () => {
  it("strips About the Role and returns the first sentence", () => {
    expect(
      oneLineExcerpt(
        "About the Role At Rippling, Engineering is at the heart of our business. More text follows.",
      ),
    ).toBe("At Rippling, Engineering is at the heart of our business.");
  });
});

describe("formatPostedDate", () => {
  it("formats ISO timestamps", () => {
    expect(formatPostedDate("2026-05-13T09:44:09.324Z")).toBe("May 13, 2026");
  });
});
