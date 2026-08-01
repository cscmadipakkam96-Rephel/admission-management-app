const { calculateAge } = require("../age");

describe("calculateAge", () => {
  test("returns null for missing dob", () => {
    expect(calculateAge(null)).toBeNull();
    expect(calculateAge(undefined)).toBeNull();
    expect(calculateAge("")).toBeNull();
  });

  test("returns null for an invalid date string", () => {
    expect(calculateAge("not-a-date")).toBeNull();
  });

  test("calculates full years for a birthday already passed this year", () => {
    const tenYearsAgo = new Date();
    tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
    tenYearsAgo.setMonth(0, 1); // Jan 1st, guaranteed to have passed
    expect(calculateAge(tenYearsAgo.toISOString())).toBe(10);
  });

  test("does not count this year if birthday hasn't happened yet", () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() - 10);
    future.setDate(future.getDate() + 2); // birthday is 2 days from now
    expect(calculateAge(future.toISOString())).toBe(9);
  });
});
