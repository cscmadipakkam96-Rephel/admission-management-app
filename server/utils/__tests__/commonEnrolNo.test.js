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
    expect(map.get(2)).toBe("M09L260002");
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
    expect(map.get(1)).toBe("M09C260001"); // 245 -> rank 1
    expect(map.get(2)).toBe("M09C260002"); // 271 -> rank 2
    expect(map.get(3)).toBe("M09D260003"); // A001 -> rank 3, continues after the old series
    expect(map.get(4)).toBe("M09D260004"); // A002 -> rank 4
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
