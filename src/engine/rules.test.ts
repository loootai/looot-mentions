import { describe, expect, it } from "vitest";
import { intentsOf, mergeRules, sentimentOf, DEFAULT_RULES } from "./rules";

describe("sentimentOf", () => {
  it("counts positive and negative words and lists the matches", () => {
    expect(sentimentOf("Love it, great and easy")).toMatchObject({ label: "positive", score: 3, matched: ["love", "great", "easy"] });
    expect(sentimentOf("Terrible, buggy and slow").label).toBe("negative");
    expect(sentimentOf("It exists").label).toBe("neutral");
  });
  it("flips a word after a negator within 3 words", () => {
    const s = sentimentOf("not very good but not bad at all");
    expect(s.matched).toEqual(["not bad"]);
    expect(s.label).toBe("positive");
    expect(sentimentOf("it isn't great").label).toBe("negative");
  });
  it("uses the threshold from the rules", () => {
    expect(sentimentOf("great", { ...DEFAULT_RULES, sentimentThreshold: 2 }).label).toBe("neutral");
  });
});

describe("intentsOf", () => {
  it.each([
    ["Tallyroom keeps crashing and I want a refund", ["complaint"]],
    ["Does anyone know how to export?", ["question"]],
    ["Can anyone recommend a Ledgerly alternative?", ["recommendation_request", "question"]],
    ["Tallyroom vs Ledgerly", ["comparison"]],
    ["Switched from Ledgerly to Tallyroom", ["comparison"]],
    ["Tallyroom shipped a release", []],
  ] as const)("%s", (text, expected) => {
    expect(intentsOf(text)).toEqual(expected);
  });
});

describe("mergeRules", () => {
  it("falls back to the defaults for missing lists and takes overrides", () => {
    const r = mergeRules({ positive: ["zesty"], intents: { complaint: ["boo"] } });
    expect(r.positive).toEqual(["zesty"]);
    expect(r.negative).toEqual(DEFAULT_RULES.negative);
    expect(intentsOf("boo", r)).toEqual(["complaint"]);
    expect(intentsOf("vs", r)).toEqual(["comparison"]);
  });
});
