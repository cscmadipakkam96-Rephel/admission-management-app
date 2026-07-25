const express = require("express");
const router = express.Router();
const {
  getDashboard,
  markBatchAttendance,
  markUnavailableToday,
  markAvailableToday,
  startBatch,
  endBatch,
  getBatchProgress,
  markSubjectComplete,
  unmarkSubjectComplete,
  getBatchTopicSuggestions,
  cancelBatch,
  login,
  teacherLogout,
  getTeacherMe,
} = require("../controllers/teacherAuthController");
const requireTeacherAuth = require("../middleware/teacherAuth");

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
router.post("/mark-subject-complete", requireTeacherAuth, markSubjectComplete);
router.post("/unmark-subject-complete", requireTeacherAuth, unmarkSubjectComplete);
router.get("/batch-topics/:batchId", requireTeacherAuth, getBatchTopicSuggestions);
router.post("/cancel-batch", requireTeacherAuth, cancelBatch);

// General Teacher Login (email + password, cookie session)
router.post("/login", login);
router.post("/logout", teacherLogout);
router.get("/me", requireTeacherAuth, getTeacherMe);

module.exports = router;
