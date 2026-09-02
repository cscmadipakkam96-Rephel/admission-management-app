const express = require("express");
const router = express.Router();
const {
  getCourseVideoUploadUrl,
  createCourseVideo,
  getAllCourseVideos,
  updateCourseVideo,
  getCourseVideoPlaybackUrl,
  deleteCourseVideo,
} = require("../controllers/courseVideoController");

router.get("/", getAllCourseVideos);
router.post("/upload-url", getCourseVideoUploadUrl);
router.post("/", createCourseVideo);
router.put("/:id", updateCourseVideo);
router.get("/:id/playback-url", getCourseVideoPlaybackUrl);
router.delete("/:id", deleteCourseVideo);

module.exports = router;
