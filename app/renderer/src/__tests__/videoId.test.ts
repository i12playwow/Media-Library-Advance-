import { describe, expect, it } from "vitest";
import { extractStrictJavVideoIdCandidates, extractVideoIdCandidates } from "../../../shared/videoId";

describe("videoId extraction", () => {
  it("keeps strict JAV IDs from clean movie titles", () => {
    expect(extractStrictJavVideoIdCandidates("WAAA-1403")).toEqual(["WAAA-1403"]);
  });

  it("ignores title noise when extracting strict JAV IDs", () => {
    expect(
      extractStrictJavVideoIdCandidates("Best of WAAA-1403 uncensored trailer 2024")
    ).toEqual(["WAAA-1403"]);
  });

  it("does not promote loose numeric text to strict IDs", () => {
    expect(extractStrictJavVideoIdCandidates("Trailer 2024 special")).toEqual([]);
  });

  it("still keeps loose extraction available for broader matching", () => {
    expect(extractVideoIdCandidates("WAAA 1403 sample")).toContain("WAAA-1403");
  });
});
