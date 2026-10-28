// @vitest-environment node
// The engines evaluator is pure Node work, and the module is CommonJS by
// design (the doctor must run before node_modules is trusted).
import { describe, expect, it } from "vitest";
import nodeEngines from "../../../../scripts/lib/node-engines.cjs";

const { satisfiesRange } = nodeEngines as {
  satisfiesRange: (version: string, range: string) => boolean | null;
};

describe("scripts/lib/node-engines — the setup doctor's engines evaluator", () => {
  it("judges comparator conjunctions, including the declared range", () => {
    expect(satisfiesRange("22.12.0", ">=22.12.0 <27")).toBe(true);
    expect(satisfiesRange("26.12.1", ">=22.12.0 <27")).toBe(true);
    expect(satisfiesRange("22.11.9", ">=22.12.0 <27")).toBe(false);
    expect(satisfiesRange("27.0.0", ">=22.12.0 <27")).toBe(false);
    expect(satisfiesRange("26.12.1", ">22.12.0")).toBe(true);
    expect(satisfiesRange("22.12.0", ">22.12.0")).toBe(false);
    expect(satisfiesRange("22.12.0", "<=22.12.0")).toBe(true);
    expect(satisfiesRange("22.12.1", "<=22.12.0")).toBe(false);
    expect(satisfiesRange("22.12.0", "=22.12.0")).toBe(true);
    expect(satisfiesRange("22.12.1", "=22.12.0")).toBe(false);
  });

  it("accepts v-prefixed versions and || alternatives", () => {
    expect(satisfiesRange("v22.12.0", ">=22.12.0 <27")).toBe(true);
    expect(satisfiesRange("26.12.1", "20.x || 26.x")).toBe(true);
    expect(satisfiesRange("26.12.1", "20.x || 22.x")).toBe(false);
  });

  it("expands caret ranges per semver", () => {
    expect(satisfiesRange("22.12.0", "^22.12.0")).toBe(true);
    expect(satisfiesRange("22.99.0", "^22.12.0")).toBe(true);
    expect(satisfiesRange("23.0.0", "^22.12.0")).toBe(false);
    expect(satisfiesRange("22.11.9", "^22.12.0")).toBe(false);
    expect(satisfiesRange("0.2.9", "^0.2.3")).toBe(true);
    expect(satisfiesRange("0.3.0", "^0.2.3")).toBe(false);
    expect(satisfiesRange("0.0.3", "^0.0.3")).toBe(true);
    expect(satisfiesRange("0.0.4", "^0.0.3")).toBe(false);
  });

  it("expands tilde ranges per semver", () => {
    expect(satisfiesRange("22.12.9", "~22.12.0")).toBe(true);
    expect(satisfiesRange("22.13.0", "~22.12.0")).toBe(false);
    expect(satisfiesRange("22.12.9", "~22.12")).toBe(true);
    expect(satisfiesRange("22.13.0", "~22.12")).toBe(false);
    expect(satisfiesRange("22.9.0", "~22")).toBe(true);
    expect(satisfiesRange("23.0.0", "~22")).toBe(false);
  });

  it("expands wildcard shorthands", () => {
    expect(satisfiesRange("26.12.1", "*")).toBe(true);
    expect(satisfiesRange("26.12.1", "x")).toBe(true);
    expect(satisfiesRange("26.12.1", "X")).toBe(true);
    expect(satisfiesRange("22.99.0", "22.x")).toBe(true);
    expect(satisfiesRange("23.0.0", "22.x")).toBe(false);
    expect(satisfiesRange("22.12.9", "22.12.*")).toBe(true);
    expect(satisfiesRange("22.13.0", "22.12.*")).toBe(false);
    expect(satisfiesRange("25.0.0", "22.x || 24.x")).toBe(false);
  });

  it("returns null for syntax it cannot judge, instead of guessing", () => {
    expect(satisfiesRange("26.12.1", ">=22.x")).toBeNull();
    expect(satisfiesRange("26.12.1", "22.x.3")).toBeNull();
    expect(satisfiesRange("26.12.1", "^22.x")).toBeNull();
    expect(satisfiesRange("26.12.1", "~22.x")).toBeNull();
    expect(satisfiesRange("26.12.1", "22")).toBeNull();
    expect(satisfiesRange("26.12.1", "22.12")).toBeNull();
    expect(satisfiesRange("26.12.1", "22 - 26")).toBeNull();
    expect(satisfiesRange("26.12.1", "lts/*")).toBeNull();
    expect(satisfiesRange("26.12.1", ">=1.2.3-beta")).toBeNull();
  });

  it("returns null when the running version cannot be parsed", () => {
    expect(satisfiesRange("26.12", ">=22.12.0 <27")).toBeNull();
    expect(satisfiesRange("", ">=22.12.0 <27")).toBeNull();
  });
});
