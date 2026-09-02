const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
} = require("@aws-sdk/client-s3");
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

// Server-side copy (S3-to-S3, no bytes pass through this app) into the
// separate Student App's own video bucket — that bucket's policy grants
// this EC2's IAM role PutObject/GetObject, so no cross-account credentials
// are needed. Used to fan a single recording out to every enrolled
// student's own key without re-uploading the file once per student.
const copyToStudentAppBucket = async ({ sourceKey, destinationKey }) => {
  const client = getClient();
  const command = new CopyObjectCommand({
    Bucket: process.env.STUDENT_APP_S3_BUCKET_NAME,
    Key: destinationKey,
    CopySource: `${process.env.S3_BUCKET_NAME}/${encodeURIComponent(sourceKey)}`,
  });
  await client.send(command);
};

// Mirrors deleteObject but against the Student App's bucket — used to
// remove a recording's fanned-out copy for one student's key.
const deleteFromStudentAppBucket = async ({ key }) => {
  const client = getClient();
  const command = new DeleteObjectCommand({
    Bucket: process.env.STUDENT_APP_S3_BUCKET_NAME,
    Key: key,
  });
  await client.send(command);
};

// Same server-side copy as copyToStudentAppBucket, but stamps the object
// with custom S3 metadata (title/price/etc.) — used for the paid Course
// Video catalog so the Flutter side can read those details straight off
// the S3 object itself before it has its own catalog API. Metadata VALUES
// must be plain ASCII (S3 rejects non-ASCII header bytes), so callers
// encodeURIComponent() anything that might contain non-Latin characters
// (e.g. a Tamil title) before passing it in here.
const copyToStudentAppBucketWithMetadata = async ({ sourceKey, destinationKey, metadata }) => {
  const client = getClient();
  const command = new CopyObjectCommand({
    Bucket: process.env.STUDENT_APP_S3_BUCKET_NAME,
    Key: destinationKey,
    CopySource: `${process.env.S3_BUCKET_NAME}/${encodeURIComponent(sourceKey)}`,
    MetadataDirective: "REPLACE",
    Metadata: metadata,
  });
  await client.send(command);
};

module.exports = {
  getUploadUrl,
  getPlaybackUrl,
  deleteObject,
  copyToStudentAppBucket,
  deleteFromStudentAppBucket,
  copyToStudentAppBucketWithMetadata,
};
