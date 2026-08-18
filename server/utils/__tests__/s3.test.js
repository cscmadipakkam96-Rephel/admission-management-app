// Presigned URL generation is a local, offline computation (HMAC signing
// of the request) — it never actually contacts AWS — so this can run for
// real with fake-but-valid-shaped credentials, no network mocking needed.
// Env vars are saved/restored around the suite so a fake key never leaks
// into any other test file sharing this worker process.
const ORIGINAL_ENV = { ...process.env };

beforeAll(() => {
  process.env.AWS_REGION = "eu-north-1";
  process.env.S3_BUCKET_NAME = "test-bucket";
  process.env.AWS_ACCESS_KEY_ID = "AKIAFAKEFAKEFAKEFAKE";
  process.env.AWS_SECRET_ACCESS_KEY = "fakefakefakefakefakefakefakefakefakefake";
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

const { getUploadUrl, getPlaybackUrl } = require("../s3");

describe("getUploadUrl", () => {
  test("returns a presigned PUT URL pointed at the configured bucket and given key", async () => {
    const url = await getUploadUrl({ key: "recordings/admin1/5/2026-08-15.webm", contentType: "video/webm" });
    expect(url).toContain("https://test-bucket.s3.eu-north-1.amazonaws.com/");
    expect(url).toContain("recordings/admin1/5/2026-08-15.webm");
    expect(url).toContain("X-Amz-Signature");
  });
});

describe("getPlaybackUrl", () => {
  test("returns a presigned GET URL pointed at the configured bucket and given key", async () => {
    const url = await getPlaybackUrl({ key: "recordings/admin1/5/2026-08-15.webm" });
    expect(url).toContain("https://test-bucket.s3.eu-north-1.amazonaws.com/");
    expect(url).toContain("recordings/admin1/5/2026-08-15.webm");
    expect(url).toContain("X-Amz-Signature");
  });

  test("upload and playback URLs differ (PUT vs GET signing)", async () => {
    const key = "recordings/admin1/5/2026-08-15.webm";
    const uploadUrl = await getUploadUrl({ key, contentType: "video/webm" });
    const playbackUrl = await getPlaybackUrl({ key });
    expect(uploadUrl).not.toBe(playbackUrl);
  });
});
