const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

// No static access key/secret anywhere — the SDK's default credential
// provider chain picks up the IAM Role already attached to the EC2
// instance automatically.
const getClient = () => new S3Client({ region: process.env.AWS_REGION });

// Short-lived, single-use-in-practice URL for the browser to PUT the
// recording directly to S3 — the video never transits our own server.
const getUploadUrl = async ({ key, contentType }) => {
  const client = getClient();
  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(client, command, { expiresIn: 300 });
};

// Short-lived URL for playback — never a permanent/public link, matching
// the bucket's own Block Public Access setting.
const getPlaybackUrl = async ({ key }) => {
  const client = getClient();
  const command = new GetObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME,
    Key: key,
  });
  return getSignedUrl(client, command, { expiresIn: 300 });
};

// Actually removes the object from S3 — used when an admin deletes a
// recording, so storage cost doesn't accumulate from old test/unwanted videos.
const deleteObject = async ({ key }) => {
  const client = getClient();
  const command = new DeleteObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME,
    Key: key,
  });
  await client.send(command);
};

module.exports = { getUploadUrl, getPlaybackUrl, deleteObject };
