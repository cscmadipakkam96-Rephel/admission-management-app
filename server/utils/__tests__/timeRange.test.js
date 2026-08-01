const { parseTimeRange, rangesOverlap } = require("../timeRange");

describe("parseTimeRange", () => {
  test("parses a standard AM-PM range", () => {
    expect(parseTimeRange("09:00 AM - 10:00 AM")).toEqual({
      startMinutes: 9 * 60,
      endMinutes: 10 * 60,
    });
  });

  test("inherits AM/PM from the other side when omitted", () => {
    expect(parseTimeRange("6 - 7 PM")).toEqual({
      startMinutes: 18 * 60,
      endMinutes: 19 * 60,
    });
  });

  test("returns null for garbage input", () => {
    expect(parseTimeRange("")).toBeNull();
    expect(parseTimeRange(null)).toBeNull();
    expect(parseTimeRange("not a time")).toBeNull();
  });
});

describe("rangesOverlap", () => {
  test("detects overlapping ranges", () => {
    const a = { startMinutes: 540, endMinutes: 600 }; // 9-10 AM
    const b = { startMinutes: 570, endMinutes: 630 }; // 9:30-10:30 AM
    expect(rangesOverlap(a, b)).toBe(true);
  });

  test("does not flag back-to-back ranges as overlapping", () => {
    const a = { startMinutes: 540, endMinutes: 600 }; // 9-10 AM
    const b = { startMinutes: 600, endMinutes: 660 }; // 10-11 AM
    expect(rangesOverlap(a, b)).toBe(false);
  });

  test("does not flag disjoint ranges as overlapping", () => {
    const a = { startMinutes: 0, endMinutes: 60 };
    const b = { startMinutes: 780, endMinutes: 840 }; // 1 PM range
    expect(rangesOverlap(a, b)).toBe(false);
  });
});
