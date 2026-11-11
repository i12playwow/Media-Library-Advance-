import { describe, expect, it } from "vitest";
import { canAccessMovie, scanRootsForSession } from "../../../services/gentleGate";
import type { LibraryRoots } from "../../../shared/contracts";

const roots: LibraryRoots = {
  normal: ["C:/library/normal"],
  gentle: ["C:/library/gentle"]
};

describe("gentle session gate", () => {
  it("hides Gentle roots while locked without mutating the caller's roots", () => {
    const visible = scanRootsForSession(roots, false);
    expect(visible).toEqual({ normal: ["C:/library/normal"], gentle: [] });
    expect(roots).toEqual({
      normal: ["C:/library/normal"],
      gentle: ["C:/library/gentle"]
    });
  });

  it("scans both libraries while unlocked", () => {
    expect(scanRootsForSession(roots, true)).toEqual({
      normal: ["C:/library/normal"],
      gentle: ["C:/library/gentle"]
    });
  });

  it("returns copies so a scan cannot mutate the saved roots", () => {
    const visible = scanRootsForSession(roots, true);
    visible.normal.push("C:/elsewhere");
    visible.gentle.push("C:/elsewhere");
    expect(roots.normal).toEqual(["C:/library/normal"]);
    expect(roots.gentle).toEqual(["C:/library/gentle"]);
  });

  it("keeps Normal movies accessible while locked", () => {
    expect(canAccessMovie("normal", false)).toBe(true);
    expect(canAccessMovie("normal", true)).toBe(true);
  });

  it("allows Gentle movies only while unlocked", () => {
    expect(canAccessMovie("gentle", false)).toBe(false);
    expect(canAccessMovie("gentle", true)).toBe(true);
  });
});
