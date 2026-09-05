const express = require("express");
const router = express.Router();
const {
  lookupBySlug,
  getDashboard,
  markBatchAttendance,
  markUnavailableToday,
  markAvailableToday,
  startBatch,
  endBatch,
  getBatchProgress,
  addPastSession,
  editSession,
  deleteSession,
  markSubjectComplete,
  unmarkSubjectComplete,
  getBatchTopicSuggestions,
  restartBatch,
  cancelOnlineBatch,
  generateJoinLink,
  joinOnlineClass,
  getOnlineClassModeratorToken,
  getRecordingUploadUrl,
  completeRecordingUpload,
  getBatchRecordings,
  getRecordingPlaybackUrl,
  login,
  teacherLogout,
  getTeacherMe,
  getTeacherSubjects,
  getTeacherSubjectStudents,
  createOwnBatch,
  updateOwnBatch,
  deleteOwnBatch,
  getTransferCandidates,
  transferBatch,
} = require("../controllers/teacherAuthController");
const requireTeacherAuth = require("../middleware/teacherAuth");

// Public: personal per-teacher link only pre-fills the login form (name +
// email) — it never grants access by itself, actual login below still
// checks the real password.
router.get("/lookup/:slug", lookupBySlug);

// Public: a student opens their own per-session join link, no login. The
// controller re-verifies the signed token and the class's live state on
// every request — this route is intentionally the only unauthenticated
// write-adjacent surface Online Class introduces.
router.get("/online-class/join/:token", joinOnlineClass);

// Everything below reveals a teacher's data or performs an action on their
// behalf — these require the session cookie login sets, and the controller
// cross-checks it against the slug's owner.
router.get("/dashboard/:slug", requireTeacherAuth, getDashboard);
router.post("/mark-batch-attendance", requireTeacherAuth, markBatchAttendance);
router.post("/mark-unavailable", requireTeacherAuth, markUnavailableToday);
router.post("/mark-available", requireTeacherAuth, markAvailableToday);
router.post("/start-batch", requireTeacherAuth, startBatch);
router.post("/end-batch", requireTeacherAuth, endBatch);
router.get("/batch-progress/:slug", requireTeacherAuth, getBatchProgress);
router.post("/session/add", requireTeacherAuth, addPastSession);
router.put("/session/:sessionId", requireTeacherAuth, editSession);
router.delete("/session/:sessionId", requireTeacherAuth, deleteSession);
router.post("/mark-subject-complete", requireTeacherAuth, markSubjectComplete);
router.post("/unmark-subject-complete", requireTeacherAuth, unmarkSubjectComplete);
router.get("/batch-topics/:batchId", requireTeacherAuth, getBatchTopicSuggestions);
router.post("/restart-batch", requireTeacherAuth, restartBatch);

// Online Class — gated per-teacher by Teacher.can_host_online_classes
// (checked inside startBatch/cancelOnlineBatch).
router.post("/cancel-online-batch", requireTeacherAuth, cancelOnlineBatch);
router.post("/online-class/generate-link", requireTeacherAuth, generateJoinLink);
router.post("/online-class/moderator-token", requireTeacherAuth, getOnlineClassModeratorToken);

// Recording — same can_host_online_classes gate implicitly (only reachable
// while a live Online session exists, which already requires it).
router.post("/online-class/recording/upload-url", requireTeacherAuth, getRecordingUploadUrl);
router.post("/online-class/recording/complete", requireTeacherAuth, completeRecordingUpload);
router.get("/online-class/recordings/:batchId", requireTeacherAuth, getBatchRecordings);
router.get("/online-class/recording/:recordingId/playback-url", requireTeacherAuth, getRecordingPlaybackUrl);

// Teacher self-service batch creation — gated per-teacher by
// Teacher.can_create_batches (checked inside createOwnBatch).
router.get("/subjects", requireTeacherAuth, getTeacherSubjects);
router.get("/batches/subject-students", requireTeacherAuth, getTeacherSubjectStudents);
router.post("/batches", requireTeacherAuth, createOwnBatch);
router.put("/batches/:id", requireTeacherAuth, updateOwnBatch);
router.delete("/batches/:id", requireTeacherAuth, deleteOwnBatch);
router.get("/batches/:id/transfer-candidates", requireTeacherAuth, getTransferCandidates);
router.post("/batches/:id/transfer", requireTeacherAuth, transferBatch);

// General Teacher Login (email + password, cookie session)
router.post("/login", login);
router.post("/logout", teacherLogout);
router.get("/me", requireTeacherAuth, getTeacherMe);

module.exports = router;
