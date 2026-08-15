const { buildCommonEnrolNoMap } = require("../commonEnrolNo");

describe("buildCommonEnrolNoMap", () => {
  test("ranks admissions by their existing comn_enrol_no ascending", () => {
    const admissions = [
      { id: 1, admission_date: "2026-03-15", comn_enrol_no: "300" },
      { id: 2, admission_date: "2026-03-16", comn_enrol_no: "100" },
      { id: 3, admission_date: "2026-03-17", comn_enrol_no: "200" },
    ];
    const map = buildCommonEnrolNoMap(admissions);
    expect(map.get(2)).toBe("M09C260001"); // lowest comn_enrol_no -> rank 1
    expect(map.get(3)).toBe("M09C260002");
    expect(map.get(1)).toBe("M09C260003");
  });

  test("admissions with no comn_enrol_no get no Common Enrol No at all", () => {
    const admissions = [{ id: 1, admission_date: "2026-01-05", comn_enrol_no: null }];
    const map = buildCommonEnrolNoMap(admissions);
    expect(map.has(1)).toBe(false);
  });

  test("falls back to created_at when admission_date is missing", () => {
    const admissions = [
      { id: 1, admission_date: null, created_at: "2026-06-10T00:00:00.000Z", comn_enrol_no: "50" },
    ];
    const map = buildCommonEnrolNoMap(admissions);
    expect(map.get(1)).toBe("M09F260001");
  });

  test("month letters follow A=Jan .. L=Dec", () => {
    const admissions = [
      { id: 1, admission_date: "2026-01-01", comn_enrol_no: "10" },
      { id: 2, admission_date: "2026-12-01", comn_enrol_no: "20" },
    ];
    const map = buildCommonEnrolNoMap(admissions);
    expect(map.get(1)).toBe("M09A260001");
    // Different month -> its own bucket -> serial resets to 0001, not 0002.
    expect(map.get(2)).toBe("M09L260001");
  });

  test("the serial resets to 1 for each new month instead of climbing all year", () => {
    const admissions = [
      { id: 1, admission_date: "2026-01-05", comn_enrol_no: "1" },
      { id: 2, admission_date: "2026-01-20", comn_enrol_no: "2" },
      { id: 3, admission_date: "2026-01-28", comn_enrol_no: "3" },
      { id: 4, admission_date: "2026-02-03", comn_enrol_no: "4" },
      { id: 5, admission_date: "2026-02-10", comn_enrol_no: "5" },
    ];
    const map = buildCommonEnrolNoMap(admissions);
    expect(map.get(1)).toBe("M09A260001");
    expect(map.get(2)).toBe("M09A260002");
    expect(map.get(3)).toBe("M09A260003");
    // February starts back at 0001, not 0004.
    expect(map.get(4)).toBe("M09B260001");
    expect(map.get(5)).toBe("M09B260002");
  });

  test("the letter cycles back to A after December, scoped to the new year", () => {
    const admissions = [
      { id: 1, admission_date: "2026-12-15", comn_enrol_no: "1" },
      { id: 2, admission_date: "2026-12-20", comn_enrol_no: "2" },
      { id: 3, admission_date: "2027-01-05", comn_enrol_no: "3" },
    ];
    const map = buildCommonEnrolNoMap(admissions);
    expect(map.get(1)).toBe("M09L260001");
    expect(map.get(2)).toBe("M09L260002");
    // Jan 2027 is a new (year, month) bucket — resets to 0001, and the year
    // digits (27) keep it from colliding with any Jan 2026 record.
    expect(map.get(3)).toBe("M09A270001");
  });

  test("admissions without comn_enrol_no don't take up a rank slot", () => {
    const admissions = [
      { id: 1, admission_date: "2026-03-15", comn_enrol_no: "100" },
      { id: 2, admission_date: "2026-03-16", comn_enrol_no: null },
      { id: 3, admission_date: "2026-03-17", comn_enrol_no: "200" },
    ];
    const map = buildCommonEnrolNoMap(admissions);
    expect(map.get(1)).toBe("M09C260001");
    expect(map.has(2)).toBe(false);
    expect(map.get(3)).toBe("M09C260002");
  });

  test("letter-prefixed Enrol Nos rank after all plain-number ones, by insertion order", () => {
    const admissions = [
      { id: 1, admission_date: "2026-03-01", comn_enrol_no: "245" },
      { id: 2, admission_date: "2026-03-02", comn_enrol_no: "271" },
      { id: 3, admission_date: "2026-04-01", comn_enrol_no: "A001" },
      { id: 4, admission_date: "2026-04-02", comn_enrol_no: "A002" },
    ];
    const map = buildCommonEnrolNoMap(admissions);
    expect(map.get(1)).toBe("M09C260001"); // 245 -> rank 1 (March bucket)
    expect(map.get(2)).toBe("M09C260002"); // 271 -> rank 2 (March bucket)
    // A001/A002 are in April — a different bucket — so they rank from 1
    // within April, not continuing March's count.
    expect(map.get(3)).toBe("M09D260001");
    expect(map.get(4)).toBe("M09D260002");
  });

  test("letter-prefixed Enrol Nos rank by id even if entered out of typed order", () => {
    const admissions = [
      { id: 5, admission_date: "2026-04-02", comn_enrol_no: "A002" },
      { id: 3, admission_date: "2026-04-01", comn_enrol_no: "A001" },
    ];
    const map = buildCommonEnrolNoMap(admissions);
    // id 3 was inserted first, so it ranks first regardless of array order
    // or which label ("A001" vs "A002") looks smaller.
    expect(map.get(3)).toBe("M09D260001");
    expect(map.get(5)).toBe("M09D260002");
  });
});
