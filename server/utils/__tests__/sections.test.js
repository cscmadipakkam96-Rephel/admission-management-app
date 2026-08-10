const { sectionsOverlapOnDays, VALID_SECTIONS, SECTION_DAYS } = require("../sections");

describe("sectionsOverlapOnDays", () => {
  test("fast_track overlaps with weekend (both now include Saturday)", () => {
    expect(sectionsOverlapOnDays("fast_track", "weekend")).toBe(true);
  });

  test("fast_track overlaps with normal_mwf (shares Monday/Wednesday/Friday)", () => {
    expect(sectionsOverlapOnDays("fast_track", "normal_mwf")).toBe(true);
  });

  test("normal_tts overlaps with weekend (both include Saturday)", () => {
    expect(sectionsOverlapOnDays("normal_tts", "weekend")).toBe(true);
  });

  test("a section always overlaps with itself", () => {
    VALID_SECTIONS.forEach((section) => {
      expect(sectionsOverlapOnDays(section, section)).toBe(true);
    });
  });
});

describe("SECTION_DAYS", () => {
  test("fast_track includes Saturday but excludes Sunday", () => {
    expect(SECTION_DAYS.fast_track).toContain("Saturday");
    expect(SECTION_DAYS.fast_track).not.toContain("Sunday");
  });
});
