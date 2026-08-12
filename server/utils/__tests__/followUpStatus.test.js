const { classifyFollowUpBucket } = require("../followUpStatus");

const TODAY = "2026-08-11";

describe("classifyFollowUpBucket", () => {
  test("Open + past due date -> overdue", () => {
    expect(
      classifyFollowUpBucket({ status: "Open", due_date: "2026-08-05", today: TODAY })
    ).toBe("overdue");
  });

  test("Open + due date exactly today -> due_today", () => {
    expect(
      classifyFollowUpBucket({ status: "Open", due_date: TODAY, today: TODAY })
    ).toBe("due_today");
  });

  test("Open + future due date -> upcoming", () => {
    expect(
      classifyFollowUpBucket({ status: "Open", due_date: "2026-08-20", today: TODAY })
    ).toBe("upcoming");
  });

  test("Completed + past due date -> completed (status wins over date)", () => {
    expect(
      classifyFollowUpBucket({ status: "Completed", due_date: "2026-08-05", today: TODAY })
    ).toBe("completed");
  });

  test("Completed + future due date -> completed", () => {
    expect(
      classifyFollowUpBucket({ status: "Completed", due_date: "2026-08-20", today: TODAY })
    ).toBe("completed");
  });

  test("boundary: one day before today is overdue, not due_today", () => {
    expect(
      classifyFollowUpBucket({ status: "Open", due_date: "2026-08-10", today: TODAY })
    ).toBe("overdue");
  });

  test("boundary: one day after today is upcoming, not due_today", () => {
    expect(
      classifyFollowUpBucket({ status: "Open", due_date: "2026-08-12", today: TODAY })
    ).toBe("upcoming");
  });
});
