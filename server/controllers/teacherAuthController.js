const { Op } = require("sequelize");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const Teacher = require("../models/Teacher");
const Course = require("../models/Course");
const Admission = require("../models/Admission");
const Attendance = require("../models/Attendance");
const Holiday = require("../models/Holiday");
const TeacherAvailability = require("../models/TeacherAvailability");
const Subject = require("../models/Subject");
require("../models/CourseSubject");
const Batch = require("../models/Batch");
const BatchSession = require("../models/BatchSession");
const BatchSubstitution = require("../models/BatchSubstitution");
const BatchStudent = require("../models/BatchStudent");
const ClassRecording = require("../models/ClassRecording");
const { getRoomSlug, signJitsiToken } = require("../utils/jitsiToken");
const { getUploadUrl, getPlaybackUrl } = require("../utils/s3");
const { markAttendanceForAdmission } = require("./attendanceController");
const { isSectionActiveToday, SECTION_LABELS, VALID_SECTIONS } = require("../utils/sections");
const { findConflicts } = require("../utils/batchConflicts");
const { coursesForSubject, includeOptionsFor } = require("./batchController");

// Which of a batch's students already got credit for `topic` before today
// (marked Present by the teacher on some earlier date this exact topic was
// covered in this batch) — they've already completed it and don't need to
// be marked present again for a repeat. Campus entry (fingerprint) isn't
// set up yet, so completion is teacher-marked class attendance only —
// revisit once entry attendance is actually being captured.
const getStudentsAlreadyCompletedTopic = async (batchId, topic, todayStr, studentIds) => {
  if (!topic || !studentIds.length) return new Set();
  const pastSessions = await BatchSession.findAll({
    where: {
      batch_id: batchId,
      topic_covered: topic,
      date: { [Op.ne]: todayStr },
      cancelled_at: null,
    },
  });
  if (!pastSessions.length) return new Set();
  const pastDates = pastSessions.map((s) => s.date);
  const classAttendance = await Attendance.findAll({
    where: { batch_id: batchId, admission_id: studentIds, date: pastDates },
  });
  const completed = new Set();
  studentIds.forEach((id) => {
    const done = classAttendance.some((a) => a.admission_id === id);
    if (done) completed.add(id);
  });
  return completed;
};

const generateTeacherToken = (teacher) =>
  jwt.sign(
    {
      teacherId: teacher.id,
      email: teacher.email,
      admin_id: teacher.admin_id,
      role: "teacher",
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

const setTeacherAuthCookie = (res, token) => {
  const isProd = process.env.NODE_ENV === "production";
  res.cookie("teacher_token", token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
};

const clearTeacherAuthCookie = (res) => {
  const isProd = process.env.NODE_ENV === "production";
  res.clearCookie("teacher_token", {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
  });
};

// Personal per-teacher link (Teacher Management -> Copy Link): looks up
// just enough to pre-fill the login form (name + email). No OTP, no
// session — actually logging in still requires the real password below.
const lookupBySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    const teacher = await Teacher.findOne({
      where: { slug, active: true },
      attributes: ["teacher_name", "email"],
    });
    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: "This link is not valid",
      });
    }
    res.status(200).json({
      success: true,
      data: { teacher_name: teacher.teacher_name, email: teacher.email },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// General Teacher Login: email + password, set by the admin when the
// teacher was added (Teacher Management). Establishes the same cookie
// session the dashboard/action endpoints below require.
const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    const teacher = await Teacher.findOne({
      where: { email: { [Op.iLike]: email.trim() }, active: true },
    });
    if (!teacher || !teacher.password) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid email or password." });
    }

    const passwordMatches = await bcrypt.compare(password, teacher.password);
    if (!passwordMatches) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid email or password." });
    }

    const token = generateTeacherToken(teacher);
    setTeacherAuthCookie(res, token);

    res.status(200).json({
      success: true,
      message: "Login successful",
      data: { teacher_name: teacher.teacher_name, slug: teacher.slug },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const teacherLogout = (req, res) => {
  clearTeacherAuthCookie(res);
  res.status(200).json({ success: true, message: "Logged out successfully" });
};

const getTeacherMe = async (req, res) => {
  try {
    const teacher = await Teacher.findOne({
      where: { id: req.teacher.teacherId, active: true },
      attributes: ["id", "teacher_name", "email", "slug"],
    });
    if (!teacher) {
      return res
        .status(404)
        .json({ success: false, message: "Teacher not found." });
    }
    res.status(200).json({ success: true, data: teacher });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDashboard = async (req, res) => {
  try {
    const { slug } = req.params;
    const teacher = await Teacher.findOne({
      where: { slug, active: true, id: req.teacher.teacherId },
      include: [{ model: Course, through: { attributes: [] } }],
    });
    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: "Teacher not found or not verified",
      });
    }

    const teacherCourseIds = (teacher.Courses || []).map((c) => c.id);
    const coursesWithSubjects = teacherCourseIds.length
      ? await Course.findAll({
          where: { id: teacherCourseIds },
          include: [
            {
              model: Subject,
              through: { attributes: [] },
              include: [
                { model: Subject, as: "Parent" },
                {
                  model: Subject,
                  as: "SubSubjects",
                  where: { active: true },
                  required: false,
                },
              ],
            },
          ],
        })
      : [];
    const courseSyllabus = coursesWithSubjects.map((c) => {
      const flat = c.Subjects || [];
      const flatIds = new Set(flat.map((s) => s.id));
      const topLevel = flat.filter((s) => !s.parent_id);
      const subOnly = flat.filter((s) => s.parent_id);
      const subjects = topLevel.map((s) => {
        // Sub-subjects individually linked to this course...
        const individuallyLinked = subOnly.filter(
          (sub) => sub.parent_id === s.id
        );
        const individuallyLinkedIds = new Set(
          individuallyLinked.map((sub) => sub.id)
        );
        // ...plus the rest of the parent's own sub-subjects — selecting a
        // parent implies all of its children, even if the course was only
        // ever linked to the parent's row (which usually has no syllabus
        // of its own; the real content lives on the children).
        const restOfChildren = (s.SubSubjects || []).filter(
          (sub) => !individuallyLinkedIds.has(sub.id)
        );
        return {
          id: s.id,
          subject_name: s.subject_name,
          description: s.description,
          syllabus: s.syllabus,
          parent_name: null,
          subSubjects: [...individuallyLinked, ...restOfChildren].map(
            (sub) => ({
              id: sub.id,
              subject_name: sub.subject_name,
              description: sub.description,
              syllabus: sub.syllabus,
            })
          ),
        };
      });
      // Sub-subjects whose parent wasn't itself linked to this course —
      // show them standalone, tagged with their parent's name for context.
      subOnly
        .filter((sub) => !flatIds.has(sub.parent_id))
        .forEach((sub) => {
          subjects.push({
            id: sub.id,
            subject_name: sub.subject_name,
            description: sub.description,
            syllabus: sub.syllabus,
            parent_name: sub.Parent?.subject_name || null,
            subSubjects: [],
          });
        });
      return {
        course_id: c.id,
        course_name: c.course_name,
        subjects,
      };
    });

    const todayStr = new Date().toISOString().slice(0, 10);
    const todayHoliday = await Holiday.findOne({ where: { date: todayStr } });
    const upcomingHolidays = await Holiday.findAll({
      where: { date: { [Op.gt]: todayStr } },
      order: [["date", "ASC"]],
      limit: 5,
    });
    const myAvailability = await TeacherAvailability.findOne({
      where: { teacher_id: teacher.id, date: todayStr },
    });

    // Batches assigned to this teacher whose section runs today.
    const myBatches = await Batch.findAll({
      where: { teacher_id: teacher.id, admin_id: teacher.admin_id, active: true },
      include: [
        { model: Subject, attributes: ["id", "subject_name"] },
        { model: Admission, as: "Students", through: { attributes: [] } },
      ],
    });
    const myBatchesToday = myBatches.filter((b) => isSectionActiveToday(b.section));

    // Batches of mine being covered by another teacher today
    const myBatchIdsToday = myBatchesToday.map((b) => b.id);
    const coveringBatchSubs = myBatchIdsToday.length
      ? await BatchSubstitution.findAll({
          where: { batch_id: myBatchIdsToday, date: todayStr },
          include: [{ model: Teacher, as: "SubstituteTeacher" }],
        })
      : [];
    const coveredByBatch = new Map(
      coveringBatchSubs.map((s) => [s.batch_id, s])
    );

    // Other teachers' batches where I'm covering as a substitute today
    const subbedInBatchRows = !todayHoliday
      ? await BatchSubstitution.findAll({
          where: { substitute_teacher_id: teacher.id, date: todayStr },
          include: [
            {
              model: Batch,
              where: { admin_id: teacher.admin_id, active: true },
              include: [
                { model: Subject, attributes: ["id", "subject_name"] },
                { model: Admission, as: "Students", through: { attributes: [] } },
              ],
            },
          ],
        })
      : [];
    const subbedInBatches = subbedInBatchRows
      .map((r) => r.Batch)
      .filter((b) => b && isSectionActiveToday(b.section));

    const combinedTodayBatches = todayHoliday
      ? []
      : [
          ...myBatchesToday.map((b) => ({
            batch: b,
            isSubstitute: false,
            coveredBy: coveredByBatch.get(b.id)?.SubstituteTeacher?.teacher_name || null,
          })),
          ...subbedInBatches.map((b) => ({
            batch: b,
            isSubstitute: true,
            coveredBy: null,
          })),
        ];

    const todayBatchIds = combinedTodayBatches.map((x) => x.batch.id);
    const batchSessionsToday = todayBatchIds.length
      ? await BatchSession.findAll({
          where: { batch_id: todayBatchIds, date: todayStr },
        })
      : [];
    const sessionByBatch = new Map(
      batchSessionsToday.map((s) => [s.batch_id, s])
    );

    const attendedBatchToday = todayBatchIds.length
      ? await Attendance.findAll({
          where: { date: todayStr, batch_id: todayBatchIds },
        })
      : [];
    const attendedByBatch = new Set(
      attendedBatchToday.map((a) => `${a.batch_id}-${a.admission_id}`)
    );

    // If today's session already has a topic locked in (teacher picked a
    // repeat topic when starting class), students who already completed
    // that exact topic before shouldn't be shown in the mark-present list.
    const excludedByBatch = new Map(
      await Promise.all(
        combinedTodayBatches.map(async ({ batch: b }) => {
          const topic = sessionByBatch.get(b.id)?.topic_covered;
          const studentIds = (b.Students || []).map((s) => s.id);
          const excluded = await getStudentsAlreadyCompletedTopic(
            b.id,
            topic,
            todayStr,
            studentIds
          );
          return [b.id, excluded];
        })
      )
    );

    res.status(200).json({
      success: true,
      data: {
        teacher: {
          id: teacher.id,
          teacher_name: teacher.teacher_name,
          qualification: teacher.qualification,
          courses: (teacher.Courses || []).map((c) => c.course_name),
          can_create_batches: teacher.can_create_batches,
          can_host_online_classes: teacher.can_host_online_classes,
        },
        courseSyllabus,
        holiday: todayHoliday
          ? { date: todayHoliday.date, description: todayHoliday.description }
          : null,
        upcomingHolidays: upcomingHolidays.map((h) => ({
          date: h.date,
          description: h.description,
        })),
        my_availability: myAvailability
          ? { reason: myAvailability.reason }
          : null,
        todayBatches: combinedTodayBatches.map(({ batch: b, isSubstitute, coveredBy }) => {
          const session = sessionByBatch.get(b.id);
          const excludedIds = excludedByBatch.get(b.id) || new Set();
          const allStudents = b.Students || [];
          return {
            id: b.id,
            batch_name: b.batch_name,
            section: b.section,
            section_label: SECTION_LABELS[b.section] || b.section,
            subject_name: b.Subject?.subject_name || null,
            timing: b.timing,
            num_days: b.num_days,
            created_by_teacher_id: b.created_by_teacher_id,
            is_substitute: isSubstitute,
            covered_by: coveredBy,
            started_at: session?.started_at || null,
            ended_at: session?.ended_at || null,
            topic_covered: session?.topic_covered || null,
            class_mode: session?.class_mode || "Offline",
            meeting_link: session?.meeting_link || null,
            meeting_provider: session?.meeting_provider || null,
            cancelled_at: session?.cancelled_at || null,
            students: allStudents
              .filter((s) => !excludedIds.has(s.id))
              .map((s) => ({
                id: s.id,
                applicant_name: s.applicant_name,
                comn_enrol_no: s.comn_enrol_no,
                already_present: attendedByBatch.has(`${b.id}-${s.id}`),
              })),
            alreadyCompletedStudents: allStudents
              .filter((s) => excludedIds.has(s.id))
              .map((s) => ({ id: s.id, applicant_name: s.applicant_name })),
          };
        }),
        myBatches: myBatches.map((b) => ({
          id: b.id,
          batch_name: b.batch_name,
          section: b.section,
          section_label: SECTION_LABELS[b.section] || b.section,
          subject_name: b.Subject?.subject_name || null,
          timing: b.timing,
          created_by_teacher_id: b.created_by_teacher_id,
        })),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const markBatchAttendance = async (req, res) => {
  try {
    const { slug, admission_id, batch_id } = req.body;
    if (!batch_id) {
      return res.status(400).json({ success: false, message: "Batch is required." });
    }
    const teacher = await Teacher.findOne({
      where: { slug, active: true, id: req.teacher.teacherId },
    });
    if (!teacher) {
      return res.status(404).json({ success: false, message: "Teacher not found or not verified" });
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const todayHoliday = await Holiday.findOne({ where: { date: todayStr } });
    if (todayHoliday) {
      return res.status(403).json({
        success: false,
        message: `Today is a holiday${todayHoliday.description ? ` (${todayHoliday.description})` : ""} — attendance cannot be marked.`,
      });
    }

    const batch = await Batch.findByPk(batch_id, {
      include: [{ model: Admission, as: "Students", through: { attributes: [] } }],
    });
    if (!batch) {
      return res.status(404).json({ success: false, message: "Batch not found" });
    }

    const isOwnBatch = batch.teacher_id === teacher.id;
    const substitution = await BatchSubstitution.findOne({
      where: { batch_id: batch.id, date: todayStr },
    });
    const isAssignedSubstitute = substitution?.substitute_teacher_id === teacher.id;

    if (!isOwnBatch && !isAssignedSubstitute) {
      return res.status(403).json({ success: false, message: "This is not one of your assigned batches" });
    }
    if (isOwnBatch && substitution && !isAssignedSubstitute) {
      return res.status(403).json({
        success: false,
        message: "A substitute teacher is covering this batch today — attendance should be marked by them.",
      });
    }

    const allowedAdmissionIds = new Set((batch.Students || []).map((s) => s.id));
    if (!allowedAdmissionIds.has(Number(admission_id))) {
      return res.status(403).json({ success: false, message: "This student is not in this batch" });
    }

    const admission = await Admission.findByPk(admission_id);
    if (!admission) {
      return res.status(404).json({ success: false, message: "Student not found" });
    }

    const result = await markAttendanceForAdmission(admission, null, batch.id);
    res.status(result.status).json(result.body);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const markUnavailableToday = async (req, res) => {
  try {
    const { slug, reason } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({
        success: false,
        message: "Please tell us the reason.",
      });
    }

    const teacher = await Teacher.findOne({
      where: { slug, active: true, id: req.teacher.teacherId },
    });
    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: "Teacher not found or not verified",
      });
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const [rec, created] = await TeacherAvailability.findOrCreate({
      where: { teacher_id: teacher.id, date: todayStr },
      defaults: { reason: reason.trim() },
    });
    if (!created) {
      await rec.update({ reason: reason.trim() });
    }

    res.status(200).json({
      success: true,
      message: "Marked as not available for today",
      data: rec,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const markAvailableToday = async (req, res) => {
  try {
    const { slug } = req.body;
    const teacher = await Teacher.findOne({
      where: { slug, active: true, id: req.teacher.teacherId },
    });
    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: "Teacher not found or not verified",
      });
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    await TeacherAvailability.destroy({
      where: { teacher_id: teacher.id, date: todayStr },
    });

    res.status(200).json({
      success: true,
      message: "Marked as available for today",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const startBatch = async (req, res) => {
  try {
    const { slug, batch_id, topic_covered, class_mode } = req.body;
    if (!batch_id) {
      return res.status(400).json({ success: false, message: "Batch is required." });
    }
    // A topic — repeat or brand-new — must be picked before the class can
    // start at all now, not deferred to End Class anymore. Enforced here
    // too (not just in the UI) so a direct API call can't bypass it either.
    if (!topic_covered || !topic_covered.trim()) {
      return res.status(400).json({
        success: false,
        message:
          "Select an already-covered topic or type today's new topic before starting the class.",
      });
    }

    const isOnline = class_mode === "Online";

    const teacher = await Teacher.findOne({
      where: { slug, active: true, id: req.teacher.teacherId },
    });
    if (!teacher) {
      return res.status(404).json({ success: false, message: "Teacher not found or not verified" });
    }
    // Never trust a frontend-only gate — an Online class can only be
    // started server-side by a teacher the admin explicitly authorized.
    if (isOnline && !teacher.can_host_online_classes) {
      return res.status(403).json({
        success: false,
        message: "You don't have permission to host online classes. Ask your admin to enable it.",
      });
    }
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayHoliday = await Holiday.findOne({ where: { date: todayStr } });
    if (todayHoliday) {
      return res.status(403).json({ success: false, message: "Today is a holiday — no classes today." });
    }

    const batch = await Batch.findOne({ where: { id: batch_id, active: true } });
    if (!batch) {
      return res.status(404).json({ success: false, message: "Batch not found" });
    }
    if (batch.teacher_id !== teacher.id) {
      return res.status(403).json({ success: false, message: "This batch is not assigned to you" });
    }

    // Online mode needs nothing typed by the teacher — the room is our own,
    // self-hosted Jitsi deployment, derived deterministically from
    // batch+date so every participant (teacher, every student) lands in the
    // same room without any coordination or pasted link.
    const [session] = await BatchSession.findOrCreate({
      where: { batch_id: batch.id, date: todayStr },
      defaults: {
        teacher_id: teacher.id,
        started_at: new Date(),
        topic_covered: topic_covered && topic_covered.trim() ? topic_covered.trim() : null,
        class_mode: isOnline ? "Online" : "Offline",
        meeting_link: isOnline ? getRoomSlug(batch.id, todayStr) : null,
        meeting_provider: isOnline ? "jitsi" : null,
      },
    });

    res.status(200).json({
      success: true,
      message: "Class started",
      data: {
        started_at: session.started_at,
        topic_covered: session.topic_covered,
        class_mode: session.class_mode,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const endBatch = async (req, res) => {
  try {
    const { slug, batch_id, topic_covered } = req.body;
    if (!batch_id) {
      return res.status(400).json({ success: false, message: "Batch is required." });
    }

    const teacher = await Teacher.findOne({
      where: { slug, active: true, id: req.teacher.teacherId },
    });
    if (!teacher) {
      return res.status(404).json({ success: false, message: "Teacher not found or not verified" });
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const batch = await Batch.findOne({
      where: { id: batch_id, active: true },
      include: [{ model: Admission, as: "Students", through: { attributes: [] } }],
    });
    if (!batch) {
      return res.status(404).json({ success: false, message: "Batch not found" });
    }
    if (batch.teacher_id !== teacher.id) {
      return res.status(403).json({ success: false, message: "This batch is not assigned to you" });
    }

    const session = await BatchSession.findOne({
      where: { batch_id: batch.id, date: todayStr },
    });
    if (!session) {
      return res.status(400).json({
        success: false,
        message: "Start the class first before ending it.",
      });
    }

    // A repeat topic picked at Start Class is already locked in on the
    // session — no need to ask again. A brand-new topic still needs to be
    // typed now, same as before.
    const finalTopic = session.topic_covered || (topic_covered && topic_covered.trim());
    if (!finalTopic) {
      return res.status(400).json({
        success: false,
        message: "Please enter the topic covered today before ending the class.",
      });
    }

    if (!session.ended_at) {
      const studentIds = (batch.Students || []).map((s) => s.id);
      const excluded = await getStudentsAlreadyCompletedTopic(
        batch.id,
        session.topic_covered,
        todayStr,
        studentIds
      );
      const eligibleCount = studentIds.length - excluded.size;
      if (eligibleCount > 0) {
        const presentCount = await Attendance.count({
          where: { batch_id: batch.id, date: todayStr },
        });
        if (presentCount === 0) {
          return res.status(400).json({
            success: false,
            message: "Mark at least one student present before ending the class.",
          });
        }
      }
      await session.update({ ended_at: new Date(), topic_covered: finalTopic });
    }

    res.status(200).json({
      success: true,
      message: "Class ended",
      data: { ended_at: session.ended_at, topic_covered: session.topic_covered },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Full undo of today's session for this batch — for when a teacher started
// class (and maybe marked some students present) by mistake. Wipes today's
// attendance for this batch AND the session itself (started_at/topic), so
// the batch goes back to "not started" as if nothing happened. Only
// available while the class is still running — once ended, use the
// attendance records normally instead of erasing them.
const restartBatch = async (req, res) => {
  try {
    const { slug, batch_id } = req.body;
    if (!batch_id) {
      return res.status(400).json({ success: false, message: "Batch is required." });
    }

    const teacher = await Teacher.findOne({
      where: { slug, active: true, id: req.teacher.teacherId },
    });
    if (!teacher) {
      return res.status(404).json({ success: false, message: "Teacher not found or not verified" });
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const batch = await Batch.findOne({ where: { id: batch_id, active: true } });
    if (!batch) {
      return res.status(404).json({ success: false, message: "Batch not found" });
    }
    if (batch.teacher_id !== teacher.id) {
      return res.status(403).json({ success: false, message: "This batch is not assigned to you" });
    }

    const session = await BatchSession.findOne({
      where: { batch_id: batch.id, date: todayStr },
    });
    if (!session) {
      return res.status(400).json({ success: false, message: "This class hasn't been started." });
    }
    if (session.ended_at) {
      return res.status(400).json({
        success: false,
        message: "This class has already ended — it can't be restarted.",
      });
    }

    await Attendance.destroy({ where: { batch_id: batch.id, date: todayStr } });
    await session.destroy();

    res.status(200).json({
      success: true,
      message: "Class restarted — today's attendance for this batch was cleared.",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Cancels a live Online class before it's ended. Unlike restartBatch, the
// BatchSession row is kept (only cancelled_at is set) — a cancelled attempt
// stays visible as history instead of vanishing. Any attendance marked so
// far is wiped so a cancelled class can never look like a completed one.
// A teacher who wants a full do-over same day still uses the existing,
// unmodified "Restart Class" button — its only guard is ended_at, so a
// cancelled-but-not-ended session already passes it and gets cleanly
// deleted+recreated on the next Start Class.
const cancelOnlineBatch = async (req, res) => {
  try {
    const { slug, batch_id } = req.body;
    if (!batch_id) {
      return res.status(400).json({ success: false, message: "Batch is required." });
    }

    const teacher = await Teacher.findOne({
      where: { slug, active: true, id: req.teacher.teacherId },
    });
    if (!teacher) {
      return res.status(404).json({ success: false, message: "Teacher not found or not verified" });
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const batch = await Batch.findOne({ where: { id: batch_id, active: true } });
    if (!batch) {
      return res.status(404).json({ success: false, message: "Batch not found" });
    }
    if (batch.teacher_id !== teacher.id) {
      return res.status(403).json({ success: false, message: "This batch is not assigned to you" });
    }

    const session = await BatchSession.findOne({
      where: { batch_id: batch.id, date: todayStr },
    });
    if (!session) {
      return res.status(400).json({ success: false, message: "This class hasn't been started." });
    }
    if (session.class_mode !== "Online") {
      return res.status(400).json({ success: false, message: "This isn't an online class." });
    }
    if (session.cancelled_at) {
      return res.status(400).json({ success: false, message: "This class was already cancelled." });
    }
    if (session.ended_at) {
      return res.status(400).json({
        success: false,
        message: "This class has already ended — it can't be cancelled.",
      });
    }

    await Attendance.destroy({ where: { batch_id: batch.id, date: todayStr } });
    await session.update({ cancelled_at: new Date() });

    res.status(200).json({
      success: true,
      message: "Online class cancelled — the join link no longer works.",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Signs a short-lived, single-student join token for a live Online class.
// Generated on demand per student (the teacher clicks "Copy Link" for one
// student at a time) rather than pre-generated in bulk. The token only
// carries identity (who, which batch, which session date) — joinOnlineClass
// always re-derives the actual live/cancelled/ended state fresh from the DB
// rather than trusting anything else in the token as current truth.
const generateJoinLink = async (req, res) => {
  try {
    const { slug, batch_id, admission_id } = req.body;
    if (!batch_id || !admission_id) {
      return res.status(400).json({ success: false, message: "Batch and student are required." });
    }

    const teacher = await Teacher.findOne({
      where: { slug, active: true, id: req.teacher.teacherId },
    });
    if (!teacher) {
      return res.status(404).json({ success: false, message: "Teacher not found or not verified" });
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const batch = await Batch.findOne({ where: { id: batch_id, active: true } });
    if (!batch) {
      return res.status(404).json({ success: false, message: "Batch not found" });
    }
    if (batch.teacher_id !== teacher.id) {
      return res.status(403).json({ success: false, message: "This batch is not assigned to you" });
    }

    const session = await BatchSession.findOne({
      where: { batch_id: batch.id, date: todayStr },
    });
    if (!session || session.class_mode !== "Online" || !session.started_at) {
      return res.status(400).json({ success: false, message: "This online class isn't live." });
    }
    if (session.ended_at || session.cancelled_at) {
      return res.status(400).json({ success: false, message: "This online class isn't live anymore." });
    }

    const enrolled = await BatchStudent.findOne({
      where: { batch_id: batch.id, admission_id },
    });
    if (!enrolled) {
      return res.status(404).json({ success: false, message: "This student isn't in this batch." });
    }

    const token = jwt.sign(
      { type: "online_join", batch_id: batch.id, admission_id: Number(admission_id), session_date: todayStr },
      process.env.JWT_SECRET,
      { expiresIn: "12h" }
    );

    res.status(200).json({ success: true, data: { token } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Public — a student opens this via their own join link, no login. Verifies
// the token's identity claims, then re-derives live state fresh from the DB
// (never trusts the token as current truth) before ever revealing the real
// meeting link.
const joinOnlineClass = async (req, res) => {
  try {
    const { token } = req.params;
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ success: false, message: "This join link is invalid or expired." });
    }
    if (decoded.type !== "online_join") {
      return res.status(401).json({ success: false, message: "This join link is invalid." });
    }

    const { batch_id, admission_id, session_date } = decoded;
    const session = await BatchSession.findOne({ where: { batch_id, date: session_date } });
    if (!session) {
      return res.status(404).json({ success: false, message: "This class doesn't exist." });
    }
    if (session.cancelled_at) {
      return res.status(410).json({ success: false, message: "This class was cancelled." });
    }
    if (session.ended_at) {
      return res.status(410).json({ success: false, message: "This class has already ended." });
    }

    const enrolled = await BatchStudent.findOne({ where: { batch_id, admission_id } });
    if (!enrolled) {
      return res.status(403).json({ success: false, message: "You're not enrolled in this batch." });
    }

    const batch = await Batch.findByPk(batch_id, { include: [{ model: Teacher }] });
    const admission = await Admission.findByPk(admission_id);

    // Minted fresh at the moment of joining, not baked into the longer-lived
    // app-level link — a short, independent expiry from the 12h app token.
    const jitsi_token = signJitsiToken({
      room: session.meeting_link,
      name: admission?.applicant_name || "Student",
      isModerator: false,
    });

    res.status(200).json({
      success: true,
      data: {
        jitsi_domain: process.env.JITSI_DOMAIN,
        room: session.meeting_link,
        jitsi_token,
        batch_name: batch?.batch_name || null,
        topic_covered: session.topic_covered,
        teacher_name: batch?.Teacher?.teacher_name || null,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Lets the teacher join their own live Online class from inside the Teacher
// Portal — same ownership/live-state checks as generateJoinLink, but mints a
// moderator-flagged Jitsi token instead of an app-level share link.
const getOnlineClassModeratorToken = async (req, res) => {
  try {
    const { slug, batch_id } = req.body;
    if (!batch_id) {
      return res.status(400).json({ success: false, message: "Batch is required." });
    }

    const teacher = await Teacher.findOne({
      where: { slug, active: true, id: req.teacher.teacherId },
    });
    if (!teacher) {
      return res.status(404).json({ success: false, message: "Teacher not found or not verified" });
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const batch = await Batch.findOne({ where: { id: batch_id, active: true } });
    if (!batch) {
      return res.status(404).json({ success: false, message: "Batch not found" });
    }
    if (batch.teacher_id !== teacher.id) {
      return res.status(403).json({ success: false, message: "This batch is not assigned to you" });
    }

    const session = await BatchSession.findOne({
      where: { batch_id: batch.id, date: todayStr },
    });
    if (!session || session.class_mode !== "Online" || !session.started_at) {
      return res.status(400).json({ success: false, message: "This online class isn't live." });
    }
    if (session.ended_at || session.cancelled_at) {
      return res.status(400).json({ success: false, message: "This online class isn't live anymore." });
    }

    const jitsi_token = signJitsiToken({
      room: session.meeting_link,
      name: teacher.teacher_name,
      isModerator: true,
    });

    res.status(200).json({
      success: true,
      data: { jitsi_domain: process.env.JITSI_DOMAIN, room: session.meeting_link, jitsi_token },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Presigned PUT URL for the browser to upload a finished recording Blob
// directly to S3 — the file never transits this server. Same ownership +
// live-Online checks as the other Online Class actions.
const getRecordingUploadUrl = async (req, res) => {
  try {
    const { slug, batch_id } = req.body;
    if (!batch_id) {
      return res.status(400).json({ success: false, message: "Batch is required." });
    }

    const teacher = await Teacher.findOne({
      where: { slug, active: true, id: req.teacher.teacherId },
    });
    if (!teacher) {
      return res.status(404).json({ success: false, message: "Teacher not found or not verified" });
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const batch = await Batch.findOne({ where: { id: batch_id, active: true } });
    if (!batch) {
      return res.status(404).json({ success: false, message: "Batch not found" });
    }
    if (batch.teacher_id !== teacher.id) {
      return res.status(403).json({ success: false, message: "This batch is not assigned to you" });
    }

    const session = await BatchSession.findOne({
      where: { batch_id: batch.id, date: todayStr },
    });
    if (!session || session.class_mode !== "Online" || !session.started_at) {
      return res.status(400).json({ success: false, message: "This online class isn't live." });
    }
    if (session.ended_at || session.cancelled_at) {
      return res.status(400).json({ success: false, message: "This online class isn't live anymore." });
    }

    const s3_key = `recordings/${batch.admin_id}/${batch.id}/${todayStr}-${Date.now()}.webm`;
    const upload_url = await getUploadUrl({ key: s3_key, contentType: "video/webm" });

    res.status(200).json({ success: true, data: { upload_url, s3_key } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Writes the ClassRecording metadata row once the browser's direct-to-S3
// PUT has actually succeeded — this is the only place a row is created, so
// an aborted/failed upload never leaves a row pointing at a nonexistent
// S3 object.
const completeRecordingUpload = async (req, res) => {
  try {
    const { slug, batch_id, s3_key, duration_seconds, file_size_mb } = req.body;
    if (!batch_id || !s3_key) {
      return res.status(400).json({ success: false, message: "Batch and recording key are required." });
    }

    const teacher = await Teacher.findOne({
      where: { slug, active: true, id: req.teacher.teacherId },
    });
    if (!teacher) {
      return res.status(404).json({ success: false, message: "Teacher not found or not verified" });
    }

    const batch = await Batch.findOne({ where: { id: batch_id, active: true } });
    if (!batch) {
      return res.status(404).json({ success: false, message: "Batch not found" });
    }
    if (batch.teacher_id !== teacher.id) {
      return res.status(403).json({ success: false, message: "This batch is not assigned to you" });
    }
    // The key must be one this same batch was actually issued an upload
    // URL for — guards against a metadata row pointing at an arbitrary key.
    if (!s3_key.startsWith(`recordings/${batch.admin_id}/${batch.id}/`)) {
      return res.status(400).json({ success: false, message: "Invalid recording key for this batch." });
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const recording = await ClassRecording.create({
      admin_id: batch.admin_id,
      batch_id: batch.id,
      session_date: todayStr,
      teacher_id: teacher.id,
      s3_key,
      duration_seconds: duration_seconds || null,
      file_size_mb: file_size_mb || null,
      uploaded_by: "Teacher",
    });

    res.status(201).json({ success: true, data: { id: recording.id } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Recordings for one batch, most recent first — teacher can only list
// recordings for a batch actually assigned to them.
const getBatchRecordings = async (req, res) => {
  try {
    const { batchId } = req.params;
    const batch = await Batch.findOne({
      where: { id: batchId, teacher_id: req.teacher.teacherId, active: true },
    });
    if (!batch) {
      return res.status(404).json({ success: false, message: "Batch not found" });
    }
    const recordings = await ClassRecording.findAll({
      where: { batch_id: batch.id, is_deleted: false },
      order: [["created_at", "DESC"]],
    });
    res.status(200).json({
      success: true,
      data: recordings.map((r) => ({
        id: r.id,
        session_date: r.session_date,
        duration_seconds: r.duration_seconds,
        file_size_mb: r.file_size_mb,
        created_at: r.created_at,
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Fresh presigned GET URL for one recording — never a stored/permanent
// link, matching the bucket's own Block Public Access setting.
const getRecordingPlaybackUrl = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const recording = await ClassRecording.findOne({
      where: { id: recordingId, is_deleted: false },
    });
    if (!recording) {
      return res.status(404).json({ success: false, message: "Recording not found." });
    }
    const batch = await Batch.findOne({
      where: { id: recording.batch_id, teacher_id: req.teacher.teacherId },
    });
    if (!batch) {
      return res.status(403).json({ success: false, message: "This recording doesn't belong to you." });
    }
    const playback_url = await getPlaybackUrl({ key: recording.s3_key });
    res.status(200).json({ success: true, data: { playback_url } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Topics already covered in this batch — shown as suggestions when
// starting class, so the teacher can pick a repeat instead of retyping it.
const getBatchTopicSuggestions = async (req, res) => {
  try {
    const { batchId } = req.params;
    const batch = await Batch.findOne({
      where: { id: batchId, teacher_id: req.teacher.teacherId, active: true },
    });
    if (!batch) {
      return res.status(404).json({ success: false, message: "Batch not found" });
    }
    const sessions = await BatchSession.findAll({
      where: { batch_id: batch.id, topic_covered: { [Op.ne]: null }, cancelled_at: null },
      order: [["date", "DESC"]],
    });
    const topics = [...new Set(sessions.map((s) => s.topic_covered))];
    res.status(200).json({ success: true, data: topics });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Concept 2 — full progress view for every batch this teacher has (not just
// today's): covered topics with per-session attendance, and whether the
// batch is on track to finish within its num_days target.
const getBatchProgress = async (req, res) => {
  try {
    const { slug } = req.params;
    const teacher = await Teacher.findOne({
      where: { slug, active: true, id: req.teacher.teacherId },
    });
    if (!teacher) {
      return res.status(404).json({ success: false, message: "Teacher not found or not verified" });
    }

    const batches = await Batch.findAll({
      where: { teacher_id: teacher.id, admin_id: teacher.admin_id, active: true },
      include: [
        { model: Subject, attributes: ["subject_name"] },
        { model: Admission, as: "Students", through: { attributes: [] } },
      ],
      order: [["id", "ASC"]],
    });

    const batchIds = batches.map((b) => b.id);
    const sessions = batchIds.length
      ? await BatchSession.findAll({
          where: { batch_id: batchIds, topic_covered: { [Op.ne]: null }, cancelled_at: null },
          order: [["date", "ASC"]],
        })
      : [];
    const attendanceRows = batchIds.length
      ? await Attendance.findAll({ where: { batch_id: batchIds } })
      : [];

    const data = batches.map((b) => {
      const students = (b.Students || []).map((s) => ({
        id: s.id,
        applicant_name: s.applicant_name,
        comn_enrol_no: s.comn_enrol_no,
      }));
      const batchSessions = sessions.filter((s) => s.batch_id === b.id);
      const sessionDetails = batchSessions.map((s) => {
        const attendanceByStudent = new Map(
          attendanceRows
            .filter((a) => a.batch_id === b.id && a.date === s.date)
            .map((a) => [a.admission_id, a])
        );
        const present = students
          .filter((st) => attendanceByStudent.has(st.id))
          .map((st) => ({
            ...st,
            in_time: attendanceByStudent.get(st.id).in_time,
            out_time: attendanceByStudent.get(st.id).out_time,
          }));
        const absent = students.filter((st) => !attendanceByStudent.has(st.id));
        return {
          id: s.id,
          date: s.date,
          started_at: s.started_at,
          ended_at: s.ended_at,
          topic_covered: s.topic_covered,
          present,
          absent,
          presentCount: present.length,
          absentCount: absent.length,
        };
      });

      const daysCompleted = batchSessions.length;
      const daysRemaining = b.num_days ? b.num_days - daysCompleted : null;

      return {
        id: b.id,
        batch_name: b.batch_name,
        subject_name: b.Subject?.subject_name || null,
        section: b.section,
        section_label: SECTION_LABELS[b.section] || b.section,
        timing: b.timing,
        num_days: b.num_days,
        students,
        sessions: sessionDetails,
        daysCompleted,
        daysRemaining,
        isNearingDeadline:
          b.num_days != null && daysRemaining !== null && daysRemaining <= 1 && daysRemaining >= 0,
        isOverdue: b.num_days != null && daysRemaining !== null && daysRemaining < 0,
        subjectCompleted: b.subject_completed,
        subjectCompletedAt: b.subject_completed_at,
        created_by_teacher_id: b.created_by_teacher_id,
      };
    });

    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const validateSessionInput = (body) => {
  const { date, start_time, end_time, topic_covered } = body;
  if (!date || !start_time || !end_time || !topic_covered || !topic_covered.trim()) {
    return "Date, start time, end time and topic are all required.";
  }
  const todayStr = new Date().toISOString().slice(0, 10);
  if (date > todayStr) {
    return "Date can't be in the future.";
  }
  const startedAt = new Date(`${date}T${start_time}`);
  const endedAt = new Date(`${date}T${end_time}`);
  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) {
    return "Invalid start or end time.";
  }
  if (endedAt <= startedAt) {
    return "End time must be after start time.";
  }
  return null;
};

// "Forgot Class" — backfill a class the teacher never tracked live (missed
// clicking Start/End that day). Independent of the live Start/End Class
// flow above: takes an explicit date + start/end time + topic + who was
// present, instead of capturing "now".
const addPastSession = async (req, res) => {
  try {
    const { batch_id, date, start_time, end_time, topic_covered, present_students } = req.body;
    if (!batch_id) {
      return res.status(400).json({ success: false, message: "Batch is required." });
    }
    const validationError = validateSessionInput(req.body);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const batch = await Batch.findOne({
      where: { id: batch_id, teacher_id: req.teacher.teacherId, active: true },
      include: [{ model: Admission, as: "Students", through: { attributes: [] } }],
    });
    if (!batch) {
      return res.status(404).json({ success: false, message: "Batch not found" });
    }

    const existing = await BatchSession.findOne({ where: { batch_id: batch.id, date } });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: "A class is already recorded for this batch on that date — edit it instead.",
      });
    }

    const session = await BatchSession.create({
      batch_id: batch.id,
      date,
      teacher_id: req.teacher.teacherId,
      started_at: new Date(`${date}T${start_time}`),
      ended_at: new Date(`${date}T${end_time}`),
      topic_covered: topic_covered.trim(),
    });

    const allowedIds = new Set((batch.Students || []).map((s) => s.id));
    const presentRows = (present_students || [])
      .filter((p) => allowedIds.has(Number(p.admission_id)))
      .map((p) => ({
        admission_id: Number(p.admission_id),
        date,
        batch_id: batch.id,
        status: "Present",
        in_time: p.in_time || null,
        out_time: p.out_time || null,
      }));
    if (presentRows.length) {
      await Attendance.bulkCreate(presentRows);
    }

    res.status(201).json({ success: true, message: "Class added.", data: { session_id: session.id } });
  } catch (error) {
    if (error.name === "SequelizeUniqueConstraintError") {
      return res.status(409).json({
        success: false,
        message: "A class is already recorded for this batch on that date — edit it instead.",
      });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

// Edits an existing session entry (whether it came from the live Start/End
// flow or was itself backfilled via addPastSession) — date, times, topic
// and who was present are all replaced with what's submitted here.
const editSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { date, present_students } = req.body;
    const validationError = validateSessionInput(req.body);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const session = await BatchSession.findByPk(sessionId);
    if (!session) {
      return res.status(404).json({ success: false, message: "Class entry not found." });
    }
    const batch = await Batch.findOne({
      where: { id: session.batch_id, teacher_id: req.teacher.teacherId, active: true },
      include: [{ model: Admission, as: "Students", through: { attributes: [] } }],
    });
    if (!batch) {
      return res.status(403).json({ success: false, message: "This class doesn't belong to you." });
    }

    if (date !== session.date) {
      const clash = await BatchSession.findOne({
        where: { batch_id: batch.id, date, id: { [Op.ne]: session.id } },
      });
      if (clash) {
        return res.status(409).json({
          success: false,
          message: "A class is already recorded for this batch on that date.",
        });
      }
    }

    // Attendance rows are keyed off the session's date — always re-derive
    // from what's submitted rather than trying to diff the old list.
    await Attendance.destroy({ where: { batch_id: batch.id, date: session.date } });

    const allowedIds = new Set((batch.Students || []).map((s) => s.id));
    const presentRows = (present_students || [])
      .filter((p) => allowedIds.has(Number(p.admission_id)))
      .map((p) => ({
        admission_id: Number(p.admission_id),
        date,
        batch_id: batch.id,
        status: "Present",
        in_time: p.in_time || null,
        out_time: p.out_time || null,
      }));
    if (presentRows.length) {
      await Attendance.bulkCreate(presentRows);
    }

    await session.update({
      date,
      started_at: new Date(`${date}T${req.body.start_time}`),
      ended_at: new Date(`${date}T${req.body.end_time}`),
      topic_covered: req.body.topic_covered.trim(),
    });

    res.status(200).json({ success: true, message: "Class updated." });
  } catch (error) {
    if (error.name === "SequelizeUniqueConstraintError") {
      return res.status(409).json({
        success: false,
        message: "A class is already recorded for this batch on that date.",
      });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await BatchSession.findByPk(sessionId);
    if (!session) {
      return res.status(404).json({ success: false, message: "Class entry not found." });
    }
    const batch = await Batch.findOne({
      where: { id: session.batch_id, teacher_id: req.teacher.teacherId, active: true },
    });
    if (!batch) {
      return res.status(403).json({ success: false, message: "This class doesn't belong to you." });
    }

    await Attendance.destroy({ where: { batch_id: batch.id, date: session.date } });
    await session.destroy();

    res.status(200).json({ success: true, message: "Class entry deleted." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Teacher declares "I've covered every topic for this subject in this
// batch" — there's no master topic checklist to verify against (topics are
// free text per session), so this is their own call, surfaced to admin's
// Student Tracking page as the batch's official completion status.
const markSubjectComplete = async (req, res) => {
  try {
    const { batch_id } = req.body;
    const batch = await Batch.findOne({
      where: { id: batch_id, teacher_id: req.teacher.teacherId, active: true },
    });
    if (!batch) {
      return res.status(404).json({ success: false, message: "Batch not found" });
    }
    await batch.update({ subject_completed: true, subject_completed_at: new Date() });
    res.status(200).json({
      success: true,
      message: "Subject marked as completed for this batch.",
      data: { subjectCompleted: true, subjectCompletedAt: batch.subject_completed_at },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const unmarkSubjectComplete = async (req, res) => {
  try {
    const { batch_id } = req.body;
    const batch = await Batch.findOne({
      where: { id: batch_id, teacher_id: req.teacher.teacherId, active: true },
    });
    if (!batch) {
      return res.status(404).json({ success: false, message: "Batch not found" });
    }
    await batch.update({ subject_completed: false, subject_completed_at: null });
    res.status(200).json({
      success: true,
      message: "Subject completion undone.",
      data: { subjectCompleted: false, subjectCompletedAt: null },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ---- Teacher self-service batch creation ----
// Off for every teacher until an admin flips Teacher.can_create_batches on
// for them (Teacher Management). A teacher can only create batches for
// themselves (teacher_id is never client-supplied) and can only edit/
// delete batches where created_by_teacher_id is their own id — an
// admin-created batch assigned to them (created_by_teacher_id: null)
// is read-only from this side, same as any other teacher's batch.

const getTeacherSubjects = async (req, res) => {
  try {
    const subjects = await Subject.findAll({
      where: { admin_id: req.teacher.admin_id, active: true },
      order: [["subject_name", "ASC"]],
    });
    res.status(200).json({ success: true, data: subjects });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getTeacherSubjectStudents = async (req, res) => {
  try {
    const { subjectId } = req.query;
    const adminId = req.teacher.admin_id;
    if (!subjectId) {
      return res.status(400).json({ success: false, message: "subjectId is required." });
    }
    const courses = await coursesForSubject(subjectId, adminId);
    const courseNames = new Set(
      courses.map((c) => (c.course_name || "").trim().toLowerCase())
    );
    if (courseNames.size === 0) {
      return res.status(200).json({ success: true, data: [] });
    }
    const admissions = await Admission.findAll({
      where: { admin_id: adminId, active: true },
    });
    const matched = admissions.filter((a) =>
      courseNames.has((a.course_name || "").trim().toLowerCase())
    );
    res.status(200).json({ success: true, data: matched });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const createOwnBatch = async (req, res) => {
  try {
    const teacher = await Teacher.findOne({
      where: { id: req.teacher.teacherId, active: true },
    });
    if (!teacher) {
      return res.status(404).json({ success: false, message: "Teacher not found or not verified" });
    }
    if (!teacher.can_create_batches) {
      return res.status(403).json({
        success: false,
        message: "You don't have permission to create batches. Ask your admin to enable it.",
      });
    }

    const { batch_name, section, subject_id, timing, num_days, admission_ids } = req.body;
    const errors = {};
    if (!batch_name || !batch_name.trim()) errors.batch_name = "Batch Name is required.";
    if (!VALID_SECTIONS.includes(section)) errors.section = "Invalid section.";
    if (!subject_id) errors.subject_id = "Subject is required.";
    if (!timing || !timing.trim()) errors.timing = "Timing is required.";
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ success: false, errors });
    }

    const subject = await Subject.findOne({
      where: { id: subject_id, admin_id: teacher.admin_id },
    });
    if (!subject) {
      return res.status(404).json({ success: false, errors: { subject_id: "Subject not found" } });
    }

    const conflictMessage = await findConflicts({
      adminId: teacher.admin_id,
      section,
      timing,
      subjectId: subject_id,
      teacherId: teacher.id,
    });
    if (conflictMessage) {
      return res.status(409).json({ success: false, message: conflictMessage });
    }

    const batch = await Batch.create({
      admin_id: teacher.admin_id,
      batch_name: batch_name.trim(),
      section,
      subject_id,
      teacher_id: teacher.id,
      created_by_teacher_id: teacher.id,
      timing: timing.trim(),
      num_days: num_days === "" || num_days === undefined ? null : num_days,
    });

    if (admission_ids && admission_ids.length > 0) {
      const ownedCount = await Admission.count({
        where: { id: admission_ids, admin_id: teacher.admin_id },
      });
      if (ownedCount !== admission_ids.length) {
        return res.status(404).json({ success: false, message: "One or more students not found" });
      }
      await batch.setStudents(admission_ids);
    }

    const created = await Batch.findByPk(batch.id, {
      include: includeOptionsFor(new Date().toISOString().slice(0, 10)),
    });
    res.status(201).json({
      success: true,
      message: "Batch created successfully",
      data: created,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateOwnBatch = async (req, res) => {
  try {
    const { id } = req.params;
    const batch = await Batch.findOne({
      where: {
        id,
        admin_id: req.teacher.admin_id,
        teacher_id: req.teacher.teacherId,
        created_by_teacher_id: req.teacher.teacherId,
      },
    });
    if (!batch) {
      return res.status(404).json({
        success: false,
        message:
          "Batch not found, or you don't have permission to edit it — you can only edit batches you created yourself.",
      });
    }

    const { batch_name, section, subject_id, timing, num_days, admission_ids } = req.body;
    const errors = {};
    if (!batch_name || !batch_name.trim()) errors.batch_name = "Batch Name is required.";
    if (!VALID_SECTIONS.includes(section)) errors.section = "Invalid section.";
    if (!subject_id) errors.subject_id = "Subject is required.";
    if (!timing || !timing.trim()) errors.timing = "Timing is required.";
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ success: false, errors });
    }

    const subject = await Subject.findOne({
      where: { id: subject_id, admin_id: req.teacher.admin_id },
    });
    if (!subject) {
      return res.status(404).json({ success: false, errors: { subject_id: "Subject not found" } });
    }

    const conflictMessage = await findConflicts({
      adminId: req.teacher.admin_id,
      section,
      timing,
      subjectId: subject_id,
      teacherId: req.teacher.teacherId,
      excludeId: id,
    });
    if (conflictMessage) {
      return res.status(409).json({ success: false, message: conflictMessage });
    }

    await batch.update({
      batch_name: batch_name.trim(),
      section,
      subject_id,
      timing: timing.trim(),
      num_days: num_days === "" || num_days === undefined ? null : num_days,
    });

    if (admission_ids) {
      const ownedCount = await Admission.count({
        where: { id: admission_ids, admin_id: req.teacher.admin_id },
      });
      if (ownedCount !== admission_ids.length) {
        return res.status(404).json({ success: false, message: "One or more students not found" });
      }
      await batch.setStudents(admission_ids);
    }

    const updated = await Batch.findByPk(batch.id, {
      include: includeOptionsFor(new Date().toISOString().slice(0, 10)),
    });
    res.status(200).json({
      success: true,
      message: "Batch updated successfully",
      data: updated,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteOwnBatch = async (req, res) => {
  try {
    const { id } = req.params;
    const batch = await Batch.findOne({
      where: {
        id,
        admin_id: req.teacher.admin_id,
        teacher_id: req.teacher.teacherId,
        created_by_teacher_id: req.teacher.teacherId,
      },
    });
    if (!batch) {
      return res.status(404).json({
        success: false,
        message:
          "Batch not found, or you don't have permission to delete it — you can only delete batches you created yourself.",
      });
    }
    await batch.update({ active: false });
    res.status(200).json({ success: true, message: "Batch removed successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
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
};
