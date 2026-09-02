const crypto = require("crypto");
const CourseVideo = require("../models/CourseVideo");
const {
  getUploadUrl,
  getPlaybackUrl,
  deleteObject,
  deleteFromStudentAppBucket,
  copyToStudentAppBucketWithMetadata,
} = require("../utils/s3");

const buildMetadata = (video) => ({
  title: encodeURIComponent(video.title),
  price: String(video.price),
  createdat: new Date(video.created_at || Date.now()).toISOString(),
});

// Best-effort fan-out to the Student App's own bucket — same convention as
// class recordings: a failure here shouldn't block the admin-side request,
// since our own bucket copy (the source of truth) already succeeded.
const syncToStudentApp = async (video) => {
  if (!process.env.STUDENT_APP_S3_BUCKET_NAME) return null;
  try {
    // Same key on both buckets — keeps the contract simple for the
    // Flutter side, which will read this key straight off its own bucket.
    const destinationKey = video.s3_key;
    await copyToStudentAppBucketWithMetadata({
      sourceKey: video.s3_key,
      destinationKey,
      metadata: buildMetadata(video),
    });
    return destinationKey;
  } catch (err) {
    console.error(`Course video Student App sync failed for video ${video.id}:`, err.message);
    return null;
  }
};

const validatePayload = (body) => {
  const errors = {};
  if (!body.title || !body.title.toString().trim()) {
    errors.title = "Title is required.";
  }
  if (body.price === undefined || body.price === null || body.price === "" || Number(body.price) < 0) {
    errors.price = "A valid, non-negative price is required.";
  }
  return errors;
};

// Presigned PUT for the browser to upload the video file directly to our
// own bucket — the video never transits our own server, same principle
// already established for class recordings.
const getCourseVideoUploadUrl = async (req, res) => {
  try {
    const { filename, contentType } = req.body;
    if (!filename || !contentType) {
      return res.status(400).json({ success: false, message: "filename and contentType are required." });
    }
    const safeName = filename.toString().replace(/[^a-zA-Z0-9._-]/g, "_");
    const key = `course-videos/${crypto.randomUUID()}/${safeName}`;
    const upload_url = await getUploadUrl({ key, contentType });
    res.status(200).json({ success: true, data: { upload_url, s3_key: key } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Called once the browser's direct-to-S3 PUT above has finished — creates
// the catalog row and fans the video out to the Student App's bucket.
const createCourseVideo = async (req, res) => {
  try {
    const errors = validatePayload(req.body);
    if (!req.body.s3_key) {
      errors.s3_key = "Missing uploaded video reference.";
    }
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ success: false, errors });
    }

    const video = await CourseVideo.create({
      admin_id: req.admin?.adminId || null,
      title: req.body.title.toString().trim(),
      price: req.body.price,
      s3_key: req.body.s3_key,
      file_size_mb: req.body.file_size_mb || null,
      content_type: req.body.content_type || null,
    });

    const studentAppKey = await syncToStudentApp(video);
    if (studentAppKey) {
      await video.update({ student_app_s3_key: studentAppKey });
    }

    res.status(201).json({ success: true, message: "Course video uploaded successfully", data: video });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getAllCourseVideos = async (req, res) => {
  try {
    const videos = await CourseVideo.findAll({
      where: { admin_id: req.admin.adminId, is_deleted: false },
      order: [["created_at", "DESC"]],
    });
    res.status(200).json({ success: true, data: videos });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Title/price only — the video file itself isn't re-uploadable through
// this endpoint. Re-stamps the Student App copy's metadata so its price/
// title never drifts out of sync with what's shown here.
const updateCourseVideo = async (req, res) => {
  try {
    const video = await CourseVideo.findOne({
      where: { id: req.params.id, admin_id: req.admin.adminId, is_deleted: false },
    });
    if (!video) {
      return res.status(404).json({ success: false, message: "Course video not found." });
    }
    const errors = validatePayload(req.body);
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ success: false, errors });
    }

    await video.update({
      title: req.body.title.toString().trim(),
      price: req.body.price,
    });

    if (video.student_app_s3_key) {
      await syncToStudentApp(video);
    }

    res.status(200).json({ success: true, message: "Course video updated successfully", data: video });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getCourseVideoPlaybackUrl = async (req, res) => {
  try {
    const video = await CourseVideo.findOne({
      where: { id: req.params.id, admin_id: req.admin.adminId, is_deleted: false },
    });
    if (!video) {
      return res.status(404).json({ success: false, message: "Course video not found." });
    }
    const playback_url = await getPlaybackUrl({ key: video.s3_key });
    res.status(200).json({ success: true, data: { playback_url } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Removes the actual objects from both buckets (storage shouldn't
// accumulate from deleted videos) and soft-deletes the catalog row.
const deleteCourseVideo = async (req, res) => {
  try {
    const video = await CourseVideo.findOne({
      where: { id: req.params.id, admin_id: req.admin.adminId, is_deleted: false },
    });
    if (!video) {
      return res.status(404).json({ success: false, message: "Course video not found." });
    }

    await deleteObject({ key: video.s3_key });

    if (video.student_app_s3_key) {
      try {
        await deleteFromStudentAppBucket({ key: video.student_app_s3_key });
      } catch (err) {
        console.error(`Course video Student App cleanup failed for video ${video.id}:`, err.message);
      }
    }

    await video.update({ is_deleted: true });
    res.status(200).json({ success: true, message: "Course video deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getCourseVideoUploadUrl,
  createCourseVideo,
  getAllCourseVideos,
  updateCourseVideo,
  getCourseVideoPlaybackUrl,
  deleteCourseVideo,
};
