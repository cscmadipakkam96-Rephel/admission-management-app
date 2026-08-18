const express = require("express");
const router = express.Router();
const {
  getSubjectTeachers,
  getSubjectStudents,
  createBatch,
  getAllBatches,
  updateBatch,
  moveBatchSection,
  assignBatchSubstitute,
  removeBatchSubstitute,
  deleteBatch,
  getTeacherBatchProgress,
  getSubjectCompletionChart,
  getStudentTracking,
  getBatchRecordingsAdmin,
  getRecordingPlaybackUrlAdmin,
} = require("../controllers/batchController");

router.get("/subject-teachers/:subjectId", getSubjectTeachers);
router.get("/subject-students", getSubjectStudents);
router.get("/teacher-progress", getTeacherBatchProgress);
router.get("/subject-completion-chart", getSubjectCompletionChart);
router.get("/student-tracking", getStudentTracking);
router.get("/:batchId/recordings", getBatchRecordingsAdmin);
router.get("/recordings/:recordingId/playback-url", getRecordingPlaybackUrlAdmin);
router.get("/", getAllBatches);
router.post("/", createBatch);
router.put("/:id", updateBatch);
router.patch("/:id/section", moveBatchSection);
router.put("/:id/substitute", assignBatchSubstitute);
router.delete("/:id/substitute", removeBatchSubstitute);
router.delete("/:id", deleteBatch);

module.exports = router;
