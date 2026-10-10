import { describe, expect, it } from "vitest";
import { buildConfig, ConfigError, parseConfig } from "./config";

describe("config", () => {
  it("accepts strings and objects, with defaults", () => {
    const c = buildConfig({ keywords: ["Acme", { term: "Beta", exclude: ["beta test"] }] });
    expect(c.keywords[1]).toEqual({ term: "Beta", exclude: ["beta test"] });
    expect(c.sources).toHaveLength(6);
    expect(c).toMatchObject({ maxSpendPerRunMicros: 250_000, monthlyCapMicros: 5_000_000, maxAgeDays: 14 });
  });
  it("rejects no keywords, 21 keywords, unknown sources and bad caps", () => {
    expect(() => buildConfig({ keywords: [] })).toThrow(ConfigError);
    expect(() => buildConfig({ keywords: Array.from({ length: 21 }, (_, i) => `k${i}`) })).toThrow(/At most 20/);
    expect(() => buildConfig({ keywords: ["a"], sources: ["myspace"] })).toThrow(/Unknown source/);
    expect(() => buildConfig({ keywords: ["a"], monthlyCapUsd: 0 })).toThrow(/positive/);
    expect(() => buildConfig({ keywords: [42] })).toThrow(ConfigError);
  });
  it("parses YAML", () => {
    const c = parseConfig("keywords:\n  - Acme\nsources: [reddit, news]\nmaxSpendPerRunUsd: 0.1\n");
    expect(c.sources).toEqual(["reddit", "news"]);
    expect(c.maxSpendPerRunMicros).toBe(100_000);
    expect(() => parseConfig("keywords: [")).toThrow(/not valid YAML/);
  });
});
