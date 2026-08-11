const { classifyStudentRisk } = require("../studentRisk");

const TODAY = "2026-08-11";

const base = {
  attendancePercent: 100,
  totalClasses: 10,
  lastAttendedDate: TODAY,
  feeStatus: "Paid",
  feeBalance: 0,
  today: TODAY,
};

describe("classifyStudentRisk — attendance boundaries", () => {
  test("49% attendance is serious -> at_risk", () => {
    const result = classifyStudentRisk({ ...base, attendancePercent: 49 });
    expect(result.riskStatus).toBe("at_risk");
    expect(result.riskReasons).toContain("Attendance 49%");
  });

  test("50% attendance is moderate -> needs_attention", () => {
    const result = classifyStudentRisk({ ...base, attendancePercent: 50 });
    expect(result.riskStatus).toBe("needs_attention");
  });

  test("74% attendance is moderate -> needs_attention", () => {
    const result = classifyStudentRisk({ ...base, attendancePercent: 74 });
    expect(result.riskStatus).toBe("needs_attention");
  });

  test("75% attendance is healthy -> on_track", () => {
    const result = classifyStudentRisk({ ...base, attendancePercent: 75 });
    expect(result.riskStatus).toBe("on_track");
    expect(result.riskReasons).toHaveLength(0);
  });
});

describe("classifyStudentRisk — attendance gap boundaries", () => {
  test("6 days since last attended is not flagged", () => {
    const result = classifyStudentRisk({ ...base, lastAttendedDate: "2026-08-05" });
    expect(result.riskStatus).toBe("on_track");
  });

  test("7 days since last attended is moderate -> needs_attention", () => {
    const result = classifyStudentRisk({ ...base, lastAttendedDate: "2026-08-04" });
    expect(result.riskStatus).toBe("needs_attention");
    expect(result.riskReasons).toContain("Last attended 7 days ago");
  });

  test("13 days since last attended is still moderate -> needs_attention", () => {
    const result = classifyStudentRisk({ ...base, lastAttendedDate: "2026-07-29" });
    expect(result.riskStatus).toBe("needs_attention");
  });

  test("14 days since last attended is serious -> at_risk", () => {
    const result = classifyStudentRisk({ ...base, lastAttendedDate: "2026-07-28" });
    expect(result.riskStatus).toBe("at_risk");
    expect(result.riskReasons).toContain("Last attended 14 days ago");
  });

  test("never attended despite classes happening is serious -> at_risk", () => {
    const result = classifyStudentRisk({ ...base, lastAttendedDate: null });
    expect(result.riskStatus).toBe("at_risk");
    expect(result.riskReasons).toContain("Never attended a class yet");
  });
});

describe("classifyStudentRisk — fee status", () => {
  test("a lone Pending fee balance (nothing else wrong) is needs_attention, not at_risk", () => {
    const result = classifyStudentRisk({ ...base, feeStatus: "Pending", feeBalance: 8000 });
    expect(result.riskStatus).toBe("needs_attention");
    expect(result.riskReasons).toContain("Fee pending — Rs. 8000");
  });

  test("a lone Partially Paid fee balance is needs_attention", () => {
    const result = classifyStudentRisk({ ...base, feeStatus: "Partially Paid", feeBalance: 3200 });
    expect(result.riskStatus).toBe("needs_attention");
    expect(result.riskReasons).toContain("Partial fee payment — Rs. 3200 pending");
  });

  test("Paid fee status is not flagged", () => {
    const result = classifyStudentRisk({ ...base, feeStatus: "Paid" });
    expect(result.riskReasons.some((r) => r.toLowerCase().includes("fee"))).toBe(false);
  });

  test("Fee Not Set is not flagged (no data, don't penalize)", () => {
    const result = classifyStudentRisk({ ...base, feeStatus: "Fee Not Set", feeBalance: null });
    expect(result.riskReasons.some((r) => r.toLowerCase().includes("fee"))).toBe(false);
  });
});

describe("classifyStudentRisk — no-data skip cases", () => {
  test("zero total classes skips attendance and gap signals entirely", () => {
    const result = classifyStudentRisk({
      ...base,
      totalClasses: 0,
      attendancePercent: 0,
      lastAttendedDate: null,
    });
    expect(result.riskStatus).toBe("on_track");
    expect(result.riskReasons).toHaveLength(0);
  });
});

describe("classifyStudentRisk — escalation rule", () => {
  test("two moderate signals together escalate to at_risk", () => {
    const result = classifyStudentRisk({
      ...base,
      attendancePercent: 60, // moderate
      feeStatus: "Partially Paid", // moderate
      feeBalance: 1000,
    });
    expect(result.riskStatus).toBe("at_risk");
    expect(result.riskReasons.length).toBeGreaterThanOrEqual(2);
  });

  test("a single moderate signal alone stays needs_attention", () => {
    const result = classifyStudentRisk({ ...base, attendancePercent: 60 });
    expect(result.riskStatus).toBe("needs_attention");
  });

  test("any serious signal wins regardless of other moderates", () => {
    const result = classifyStudentRisk({
      ...base,
      attendancePercent: 30, // serious
      feeStatus: "Partially Paid", // moderate
      feeBalance: 500,
    });
    expect(result.riskStatus).toBe("at_risk");
  });
});
