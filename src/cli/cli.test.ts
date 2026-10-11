import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const root = process.cwd();
const tsx = join(root, "node_modules/.bin/tsx");
const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(root, ".tmp-test-"));
  dirs.push(d);
  return d;
};
const run = (args: string[], env: Record<string, string> = {}) => spawnSync(tsx, ["src/cli/index.ts", ...args], { cwd: root, encoding: "utf8", env: { PATH: process.env.PATH ?? "", ...env } as unknown as NodeJS.ProcessEnv });
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("mentions CLI", () => {
  it("--dry-run prints the list-price cost, makes no call and writes nothing", () => {
    const d = tmp();
    const r = run(["--keywords", "Acme,Beta", "--dry-run", "--out", d, "--data", join(d, "m.json")]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("16 calls, list price $0.02002");
    expect(r.stdout).toContain("no looot call was made");
    expect(existsSync(join(d, "m.json"))).toBe(false);
  });
  it("--demo writes the digest and the data file, and a second run finds nothing new", () => {
    const d = tmp();
    const args = ["--demo", "--out", d, "--data", join(d, "m.json")];
    expect(run(args).status).toBe(0);
    expect(readFileSync(join(d, "2026-10-10.md"), "utf8")).toContain("## Needs a reply");
    const stored = JSON.parse(readFileSync(join(d, "m.json"), "utf8"));
    expect(stored.mentions.length).toBeGreaterThan(8);
    const again = run(args);
    expect(again.status).toBe(0);
    expect(again.stdout).toContain("No new mentions since the last run");
  });
  it("asks for LOOOT_TOKEN on a real run, and spends nothing", () => {
    const r = run(["--keywords", "Acme", "--out", tmp()], { LOOOT_API_URL: "http://127.0.0.1:9" });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("LOOOT_TOKEN is not set");
  });
  it("reads a data file from before the period budget, with its old month-by-month spend, without a crash", () => {
    const d = tmp();
    const r = run(["--demo", "--out", d, "--data", join(d, "m.json")]);
    expect(r.status).toBe(0);
    const p = join(d, "m.json");
    const s = JSON.parse(readFileSync(p, "utf8"));
    s.spend["2026-10"] = 4_999_000;
    writeFileSync(p, JSON.stringify(s));
    const again = run(["--demo", "--out", d, "--data", p]);
    expect(again.status).toBe(0);
  });
  it("rejects an unknown source", () => {
    const r = run(["--keywords", "Acme", "--sources", "myspace", "--dry-run"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Unknown source");
  });
});
