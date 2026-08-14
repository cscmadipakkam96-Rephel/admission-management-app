const jwt = require("jsonwebtoken");
const { getRoomSlug, signJitsiToken } = require("../jitsiToken");

describe("getRoomSlug", () => {
  beforeEach(() => {
    process.env.JITSI_APP_SECRET = "test-secret";
  });

  test("is deterministic for the same batch and date", () => {
    expect(getRoomSlug(5, "2026-08-14")).toBe(getRoomSlug(5, "2026-08-14"));
  });

  test("differs across batches", () => {
    expect(getRoomSlug(5, "2026-08-14")).not.toBe(getRoomSlug(6, "2026-08-14"));
  });

  test("differs across dates", () => {
    expect(getRoomSlug(5, "2026-08-14")).not.toBe(getRoomSlug(5, "2026-08-15"));
  });

  test("depends on the secret, not just batch id and date", () => {
    const a = getRoomSlug(5, "2026-08-14");
    process.env.JITSI_APP_SECRET = "a-different-secret";
    const b = getRoomSlug(5, "2026-08-14");
    expect(a).not.toBe(b);
  });
});

describe("signJitsiToken", () => {
  beforeEach(() => {
    process.env.JITSI_APP_ID = "test-app";
    process.env.JITSI_APP_SECRET = "test-secret";
    process.env.JITSI_DOMAIN = "test.example.com";
  });

  test("produces a token verifiable with the same secret, carrying the right claims", () => {
    const token = signJitsiToken({ room: "abc123", name: "Test Student", isModerator: false });
    const decoded = jwt.verify(token, "test-secret");
    expect(decoded.room).toBe("abc123");
    expect(decoded.context.user.name).toBe("Test Student");
    expect(decoded.context.user.moderator).toBe(false);
    expect(decoded.aud).toBe("test-app");
    expect(decoded.iss).toBe("test-app");
    expect(decoded.sub).toBe("test.example.com");
  });

  test("sets moderator true when isModerator is true", () => {
    const token = signJitsiToken({ room: "abc123", name: "Teacher", isModerator: true });
    const decoded = jwt.verify(token, "test-secret");
    expect(decoded.context.user.moderator).toBe(true);
  });

  test("a token signed with a different secret does not verify", () => {
    const token = signJitsiToken({ room: "abc123", name: "Test Student", isModerator: false });
    expect(() => jwt.verify(token, "wrong-secret")).toThrow();
  });
});
