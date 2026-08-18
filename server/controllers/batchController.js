const { Op } = require("sequelize");
const Batch = require("../models/Batch");
const Subject = require("../models/Subject");
const Course = require("../models/Course");
const Teacher = require("../models/Teacher");
const Admission = require("../models/Admission");
const BatchSession = require("../models/BatchSession");
const BatchSubstitution = require("../models/BatchSubstitution");
const Attendance = require("../models/Attendance");
const FeePayment = require("../models/FeePayment");
const ClassRecording = require("../models/ClassRecording");
const { getPlaybackUrl, deleteObject } = require("../utils/s3");
const {
  VALID_SECTIONS,
  SECTION_LABELS,
  isSectionActiveToday,
} = require("../utils/sections");
const { findConflicts } = require("../utils/batchConflicts");
const { classifyStudentRisk } = require("../utils/studentRisk");

const includeOptionsFor = (todayStr) => [
  {
    model: Subject,
    attributes: ["id", "subject_name", "parent_id"],
    include: [{ model: Subject, as: "Parent", attributes: ["id", "subject_name"] }],
  },
  { model: Teacher, attributes: ["id", "teacher_name"] },
  { model: Admission, as: "Students", through: { attributes: [] } },
  {
    model: BatchSession,
    where: { date: todayStr },
    required: false,
  },
  {
    model: BatchSubstitution,
    as: "Substitutions",
    where: { date: todayStr },
    required: false,
    include: [{ model: Teacher, as: "SubstituteTeacher" }],
  },
];

const todayStr = () => new Date().toISOString().slice(0, 10);

// Courses whose syllabus includes this subject, for a given admin.
const coursesForSubject = async (subjectId, adminId) => {
  const subject = await Subject.findOne({
    where: { id: subjectId, admin_id: adminId },
    include: [{ model: Course, where: { admin_id: adminId }, required: false }],
  });
  return subject ? subject.Courses || [] : [];
};

const getSubjectTeachers = async (req, res) => {
  try {
    const { subjectId } = req.params;
    const adminId = req.admin.adminId;
    const courses = await coursesForSubject(subjectId, adminId);
    if (courses.length === 0) {
      return res.status(200).json({ success: true, data: [] });
    }
    const coursesWithTeachers = await Course.findAll({
      where: { id: courses.map((c) => c.id), admin_id: adminId },
      include: [{ model: Teacher, where: { active: true }, required: false }],
    });
    const teacherMap = new Map();
    coursesWithTeachers.forEach((course) => {
      (course.Teachers || []).forEach((t) => teacherMap.set(t.id, t));
    });
    res.status(200).json({
      success: true,
      data: Array.from(teacherMap.values()),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getSubjectStudents = async (req, res) => {
  try {
    const { subjectId } = req.query;
    const adminId = req.admin.adminId;
    if (!subjectId) {
      return res.status(400).json({
        success: false,
        message: "subjectId is required.",
      });
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
    // Every student admitted in a course whose syllabus includes this
    // subject is eligible — batch timing doesn't need to match their
    // registered timing preference (that field is free-typed and rarely
    // matches an exact batch slot string).
    const matched = admissions.filter((a) =>
      courseNames.has((a.course_name || "").trim().toLowerCase())
    );
    res.status(200).json({ success: true, data: matched });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const createBatch = async (req, res) => {
  try {
    const adminId = req.admin.adminId;
    const {
      batch_name,
      section,
      subject_id,
      teacher_id,
      timing,
      num_days,
      admission_ids,
    } = req.body;

    const errors = {};
    if (!batch_name || !batch_name.trim()) errors.batch_name = "Batch Name is required.";
    if (!VALID_SECTIONS.includes(section)) errors.section = "Invalid section.";
    if (!subject_id) errors.subject_id = "Subject is required.";
    if (!teacher_id) errors.teacher_id = "Teacher is required.";
    if (!timing || !timing.trim()) errors.timing = "Timing is required.";
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ success: false, errors });
    }

    const [subject, teacher] = await Promise.all([
      Subject.findOne({ where: { id: subject_id, admin_id: adminId } }),
      Teacher.findOne({ where: { id: teacher_id, admin_id: adminId, active: true } }),
    ]);
    if (!subject) {
      return res.status(404).json({ success: false, errors: { subject_id: "Subject not found" } });
    }
    if (!teacher) {
      return res.status(404).json({ success: false, errors: { teacher_id: "Teacher not found" } });
    }

    const conflictMessage = await findConflicts({
      adminId,
      section,
      timing,
      subjectId: subject_id,
      teacherId: teacher_id,
    });
    if (conflictMessage) {
      return res.status(409).json({ success: false, message: conflictMessage });
    }

    const batch = await Batch.create({
      admin_id: adminId,
      batch_name: batch_name.trim(),
      section,
      subject_id,
      teacher_id,
      timing: timing.trim(),
      num_days: num_days === "" || num_days === undefined ? null : num_days,
    });

    if (admission_ids && admission_ids.length > 0) {
      const ownedCount = await Admission.count({
        where: { id: admission_ids, admin_id: adminId },
      });
      if (ownedCount !== admission_ids.length) {
        return res.status(404).json({ success: false, message: "One or more students not found" });
      }
      await batch.setStudents(admission_ids);
    }

    const created = await Batch.findByPk(batch.id, {
      include: includeOptionsFor(todayStr()),
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

const getAllBatches = async (req, res) => {
  try {
    const isActive = req.query.active !== "false";
    const batches = await Batch.findAll({
      where: { active: isActive, admin_id: req.admin.adminId },
      include: includeOptionsFor(todayStr()),
      order: [["id", "ASC"]],
    });
    const data = batches.map((b) => {
      const json = b.toJSON();
      json.section_active_today = isSectionActiveToday(b.section);
      return json;
    });
    res.status(200).json({ success: true, data, sectionLabels: SECTION_LABELS });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateBatch = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.admin.adminId;
    const batch = await Batch.findOne({ where: { id, admin_id: adminId } });
    if (!batch) {
      return res.status(404).json({ success: false, message: "Batch not found" });
    }

    const {
      batch_name,
      section,
      subject_id,
      teacher_id,
      timing,
      num_days,
      admission_ids,
    } = req.body;

    const errors = {};
    if (!batch_name || !batch_name.trim()) errors.batch_name = "Batch Name is required.";
    if (!VALID_SECTIONS.includes(section)) errors.section = "Invalid section.";
    if (!subject_id) errors.subject_id = "Subject is required.";
    if (!teacher_id) errors.teacher_id = "Teacher is required.";
    if (!timing || !timing.trim()) errors.timing = "Timing is required.";
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ success: false, errors });
    }

    const conflictMessage = await findConflicts({
      adminId,
      section,
      timing,
      subjectId: subject_id,
      teacherId: teacher_id,
      excludeId: id,
    });
    if (conflictMessage) {
      return res.status(409).json({ success: false, message: conflictMessage });
    }

    await batch.update({
      batch_name: batch_name.trim(),
      section,
      subject_id,
      teacher_id,
      timing: timing.trim(),
      num_days: num_days === "" || num_days === undefined ? null : num_days,
    });

    if (admission_ids) {
      const ownedCount = await Admission.count({
        where: { id: admission_ids, admin_id: adminId },
      });
      if (ownedCount !== admission_ids.length) {
        return res.status(404).json({ success: false, message: "One or more students not found" });
      }
      await batch.setStudents(admission_ids);
    }

    const updated = await Batch.findByPk(id, {
      include: includeOptionsFor(todayStr()),
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

// Drag-and-drop: move an existing batch to a different section, re-running
// the same conflict checks against the new section (subject/timing/teacher
// stay the same, only the section changes).
const moveBatchSection = async (req, res) => {
  try {
    const { id } = req.params;
    const { section } = req.body;
    const adminId = req.admin.adminId;

    if (!VALID_SECTIONS.includes(section)) {
      return res.status(400).json({ success: false, message: "Invalid section." });
    }

    const batch = await Batch.findOne({ where: { id, admin_id: adminId } });
    if (!batch) {
      return res.status(404).json({ success: false, message: "Batch not found" });
    }

    if (batch.section === section) {
      return res.status(200).json({ success: true, message: "No change", data: batch });
    }

    const conflictMessage = await findConflicts({
      adminId,
      section,
      timing: batch.timing,
      subjectId: batch.subject_id,
      teacherId: batch.teacher_id,
      excludeId: id,
    });
    if (conflictMessage) {
      return res.status(409).json({ success: false, message: conflictMessage });
    }

    await batch.update({ section });
    const updated = await Batch.findByPk(id, {
      include: includeOptionsFor(todayStr()),
    });
    res.status(200).json({
      success: true,
      message: "Batch moved successfully",
      data: updated,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Today-only substitute for a batch whose regular teacher is unavailable —
// mirrors the WeeklyScheduleSlot substitution flow, scoped to this Batch.
const assignBatchSubstitute = async (req, res) => {
  try {
    const { id } = req.params;
    const { date, substitute_teacher_id, reason } = req.body;
    const adminId = req.admin.adminId;
    if (!date || !substitute_teacher_id) {
      return res.status(400).json({
        success: false,
        message: "Date and Substitute Teacher are required.",
      });
    }

    const batch = await Batch.findOne({ where: { id, admin_id: adminId } });
    if (!batch) {
      return res.status(404).json({ success: false, message: "Batch not found" });
    }

    const teacher = await Teacher.findOne({
      where: { id: substitute_teacher_id, admin_id: adminId, active: true },
    });
    if (!teacher) {
      return res.status(404).json({ success: false, message: "Substitute teacher not found" });
    }

    const [sub, created] = await BatchSubstitution.findOrCreate({
      where: { batch_id: id, date },
      defaults: { substitute_teacher_id, reason: reason || null },
    });
    if (!created) {
      await sub.update({ substitute_teacher_id, reason: reason || null });
    }

    res.status(200).json({
      success: true,
      message: `${teacher.teacher_name} set as temporary substitute for ${date}`,
      data: sub,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const removeBatchSubstitute = async (req, res) => {
  try {
    const { id } = req.params;
    const { date } = req.query;
    const adminId = req.admin.adminId;
    if (!date) {
      return res.status(400).json({ success: false, message: "Date is required." });
    }
    const batch = await Batch.findOne({ where: { id, admin_id: adminId } });
    if (!batch) {
      return res.status(404).json({ success: false, message: "Batch not found" });
    }
    await BatchSubstitution.destroy({ where: { batch_id: id, date } });
    res.status(200).json({
      success: true,
      message: "Substitute removed — original teacher continues.",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Admin view — every batch for this admin (all teachers), each with full
// covered-topic/session history and per-session present/absent breakdown.
// Mirrors the teacher-side "My Batches — Progress" view but across everyone,
// grouped by teacher on the frontend.
const getTeacherBatchProgress = async (req, res) => {
  try {
    const adminId = req.admin.adminId;
    const batches = await Batch.findAll({
      where: { admin_id: adminId, active: true },
      include: [
        { model: Subject, attributes: ["id", "subject_name"] },
        { model: Teacher, attributes: ["id", "teacher_name"] },
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
        const presentIds = new Set(
          attendanceRows
            .filter((a) => a.batch_id === b.id && a.date === s.date)
            .map((a) => a.admission_id)
        );
        const present = students.filter((st) => presentIds.has(st.id));
        const absent = students.filter((st) => !presentIds.has(st.id));
        return {
          date: s.date,
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
        subject_id: b.subject_id,
        subject_name: b.Subject?.subject_name || null,
        teacher_id: b.teacher_id,
        teacher_name: b.Teacher?.teacher_name || null,
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
      };
    });

    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Admin view — subject-wise chart of how many students have "completed"
// (attended at least num_days Present sessions) vs not, across every batch
// for that subject. Batches with no num_days target are skipped since
// completion can't be measured for them.
//
// A student can be enrolled in more than one batch for the same subject
// (e.g. two different teachers both teaching Windows) — each student
// appears once per subject with an `enrollments` array covering every one
// of their batches for it, each carrying its own teacher, attendance
// count, and topic-by-topic completed/missed breakdown. The student
// counts as subject-complete only if every one of their enrollments is.
const getSubjectCompletionChart = async (req, res) => {
  try {
    const adminId = req.admin.adminId;
    const batches = await Batch.findAll({
      where: { admin_id: adminId, active: true, num_days: { [Op.ne]: null } },
      include: [
        { model: Subject, attributes: ["id", "subject_name"] },
        { model: Teacher, attributes: ["id", "teacher_name"] },
        { model: Admission, as: "Students", through: { attributes: [] } },
      ],
    });

    const batchIds = batches.map((b) => b.id);
    const attendanceRows = batchIds.length
      ? await Attendance.findAll({ where: { batch_id: batchIds } })
      : [];
    const sessions = batchIds.length
      ? await BatchSession.findAll({
          where: { batch_id: batchIds, topic_covered: { [Op.ne]: null }, cancelled_at: null },
          order: [["date", "ASC"]],
        })
      : [];

    const bySubject = new Map();
    batches.forEach((b) => {
      const key = b.subject_id;
      if (!bySubject.has(key)) {
        bySubject.set(key, {
          subject_id: b.subject_id,
          subject_name: b.Subject?.subject_name || "Unknown",
          studentsById: new Map(),
        });
      }
      const bucket = bySubject.get(key);
      const batchSessions = sessions.filter((s) => s.batch_id === b.id);

      (b.Students || []).forEach((s) => {
        const presentDates = new Set(
          attendanceRows
            .filter((a) => a.batch_id === b.id && a.admission_id === s.id)
            .map((a) => a.date)
        );
        const completedTopics = [];
        const missedTopics = [];
        batchSessions.forEach((session) => {
          const topic = { date: session.date, topic_covered: session.topic_covered };
          if (presentDates.has(session.date)) {
            completedTopics.push(topic);
          } else {
            missedTopics.push(topic);
          }
        });

        if (!bucket.studentsById.has(s.id)) {
          bucket.studentsById.set(s.id, {
            id: s.id,
            applicant_name: s.applicant_name,
            comn_enrol_no: s.comn_enrol_no,
            enrollments: [],
          });
        }
        bucket.studentsById.get(s.id).enrollments.push({
          batch_id: b.id,
          batch_name: b.batch_name,
          teacher_name: b.Teacher?.teacher_name || "Unassigned",
          num_days: b.num_days,
          presentCount: presentDates.size,
          totalTopics: batchSessions.length,
          // Completed = attended at least num_days classes (the batch's
          // planned duration) — not "attended every topic ever covered".
          completed: presentDates.size >= b.num_days,
          completedTopics,
          missedTopics,
        });
      });
    });

    // Total students "in" a subject overall — every active admission whose
    // Course includes this Subject, regardless of whether they've been put
    // into a batch yet. Broader than completed+notCompleted on purpose:
    // those two only cover students already enrolled in a tracked batch.
    const subjectIds = Array.from(bySubject.keys());
    const subjectsWithCourses = subjectIds.length
      ? await Subject.findAll({
          where: { id: subjectIds },
          include: [
            { model: Course, through: { attributes: [] }, attributes: ["course_name"] },
          ],
        })
      : [];
    const courseNamesBySubject = new Map(
      subjectsWithCourses.map((subj) => [
        subj.id,
        (subj.Courses || [])
          .map((c) => (c.course_name || "").toLowerCase().trim())
          .filter(Boolean),
      ])
    );
    const allAdmissions = await Admission.findAll({
      where: { admin_id: adminId, active: true },
      attributes: ["id", "applicant_name", "comn_enrol_no", "course_name"],
    });

    const data = Array.from(bySubject.values()).map((subj) => {
      const students = Array.from(subj.studentsById.values());
      // A student learning the same subject from two teachers only needs to
      // finish it with ONE of them to count as done overall — each
      // enrollment still shows its own Completed/Not Completed badge in the
      // drilldown, so it's clear which teacher(s) it was finished with.
      const completedStudents = students.filter((st) =>
        st.enrollments.some((e) => e.completed)
      );
      const notCompletedStudents = students.filter((st) =>
        st.enrollments.every((e) => !e.completed)
      );
      const batchedIds = new Set(students.map((st) => st.id));
      const courseNames = courseNamesBySubject.get(subj.subject_id) || [];
      const subjectAdmissions = allAdmissions.filter((a) =>
        courseNames.includes((a.course_name || "").toLowerCase().trim())
      );
      // Admitted for a course covering this subject, but never put into any
      // batch for it — too early to call them "not completed" since they
      // haven't started, so they're their own category.
      const notAssignedStudents = subjectAdmissions.filter(
        (a) => !batchedIds.has(a.id)
      );
      return {
        subject_id: subj.subject_id,
        subject_name: subj.subject_name,
        completedCount: completedStudents.length,
        notCompletedCount: notCompletedStudents.length,
        notAssignedCount: notAssignedStudents.length,
        totalStudents: subjectAdmissions.length,
        completedStudents,
        notCompletedStudents,
        notAssignedStudents,
      };
    });

    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteBatch = async (req, res) => {
  try {
    const { id } = req.params;
    const batch = await Batch.findOne({
      where: { id, admin_id: req.admin.adminId },
    });
    if (!batch) {
      return res.status(404).json({ success: false, message: "Batch not found" });
    }
    await batch.update({ active: false });
    res.status(200).json({ success: true, message: "Batch removed successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Admin view — per-student, per-subject topic completion. A topic counts
// as "completed" for a student when the teacher marked them Present that
// day (Attendance row for that batch+date). Campus entry (fingerprint)
// attendance isn't set up yet, so it isn't factored in here — once it's
// actually being captured, this can go back to requiring both signals.
// Subject-level "done" is a separate, teacher-declared flag (subject_completed
// on Batch) since there's no master topic checklist to verify against.
const getStudentTracking = async (req, res) => {
  try {
    const adminId = req.admin.adminId;
    const batches = await Batch.findAll({
      where: { admin_id: adminId, active: true },
      include: [
        { model: Subject, attributes: ["id", "subject_name"] },
        { model: Teacher, attributes: ["id", "teacher_name"] },
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
    const classAttendance = batchIds.length
      ? await Attendance.findAll({ where: { batch_id: batchIds } })
      : [];

    const studentMap = new Map();

    batches.forEach((b) => {
      const batchSessions = sessions.filter((s) => s.batch_id === b.id);
      (b.Students || []).forEach((student) => {
        const attendanceByDate = new Map(
          classAttendance
            .filter((a) => a.batch_id === b.id && a.admission_id === student.id)
            .map((a) => [a.date, a])
        );

        const completedTopics = [];
        const missedTopics = [];
        batchSessions.forEach((s) => {
          const hasClassAttendance = attendanceByDate.has(s.date);
          const topic = {
            date: s.date,
            topic_covered: s.topic_covered,
            in_time: attendanceByDate.get(s.date)?.in_time || null,
            out_time: attendanceByDate.get(s.date)?.out_time || null,
          };
          if (hasClassAttendance) {
            completedTopics.push(topic);
          } else {
            missedTopics.push({ ...topic, reason: "Not marked present in class" });
          }
        });

        const totalTopics = batchSessions.length;
        const completionPercent = totalTopics
          ? Math.round((completedTopics.length / totalTopics) * 100)
          : 0;

        // Batch (duration) progress — separate concept from topic
        // completion above: classes attended vs the batch's PLANNED total
        // days, not vs however many topics have actually been taught so
        // far. Deliberately not merged with completionPercent.
        const daysCompleted = completedTopics.length;
        const durationPercent = b.num_days
          ? Math.min(100, Math.round((daysCompleted / b.num_days) * 100))
          : null;

        if (!studentMap.has(student.id)) {
          studentMap.set(student.id, {
            id: student.id,
            applicant_name: student.applicant_name,
            comn_enrol_no: student.comn_enrol_no,
            course_name: student.course_name,
            admission_date: student.admission_date,
            total_fee: student.total_fee,
            subjects: [],
          });
        }
        studentMap.get(student.id).subjects.push({
          batch_id: b.id,
          batch_name: b.batch_name,
          subject_id: b.subject_id,
          subject_name: b.Subject?.subject_name || null,
          teacher_name: b.Teacher?.teacher_name || null,
          teacherMarkedComplete: b.subject_completed,
          teacherMarkedCompleteAt: b.subject_completed_at,
          totalTopics,
          completedTopics,
          missedTopics,
          completionPercent,
          studentCoveredAllSoFar: totalTopics > 0 && completedTopics.length === totalTopics,
          numDays: b.num_days,
          daysCompleted,
          durationPercent,
          durationComplete: b.num_days != null && daysCompleted >= b.num_days,
        });
      });
    });

    // Fee summary — one query for every student already gathered above,
    // grouped in memory (same pattern as the Attendance/BatchSession
    // lookups), so this stays a single extra round trip regardless of how
    // many students are on screen. Read-only: never writes to fee_payments.
    const studentIds = Array.from(studentMap.keys());
    const feePayments = studentIds.length
      ? await FeePayment.findAll({
          where: { admission_id: studentIds, active: true },
          order: [["paid_date", "DESC"]],
        })
      : [];

    // Per-student overall attendance summary — across every subject/batch
    // combined, using the same completed/missed topic data above.
    const data = Array.from(studentMap.values()).map((student) => {
      const totalClasses = student.subjects.reduce((sum, s) => sum + s.totalTopics, 0);
      const present = student.subjects.reduce((sum, s) => sum + s.completedTopics.length, 0);
      const absent = student.subjects.reduce((sum, s) => sum + s.missedTopics.length, 0);
      const allAttendedDates = student.subjects.flatMap((s) =>
        s.completedTopics.map((t) => t.date)
      );
      const lastAttendedDate = allAttendedDates.length
        ? allAttendedDates.sort().at(-1)
        : null;

      const payments = feePayments.filter((p) => p.admission_id === student.id);
      const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount_paid || 0), 0);
      const totalFee = student.total_fee != null ? Number(student.total_fee) : null;
      const balance = totalFee != null ? Math.max(0, totalFee - totalPaid) : null;
      const paymentProgressPercent = totalFee
        ? Math.min(100, Math.round((totalPaid / totalFee) * 100))
        : null;
      const feeStatus =
        totalFee == null || totalFee === 0
          ? "Fee Not Set"
          : totalPaid <= 0
            ? "Pending"
            : totalPaid >= totalFee
              ? "Paid"
              : "Partially Paid";

      const overallAttendancePercent = totalClasses
        ? Math.round((present / totalClasses) * 100)
        : 0;

      // Student Risk Management — a different (stricter, all-or-nothing
      // per subject) metric than attendance %, so it's shown alongside
      // risk data for context but deliberately excluded from the risk
      // classification itself (see server/utils/studentRisk.js for why).
      const subjectCount = student.subjects.length;
      const completedSubjectCount = student.subjects.filter(
        (s) => s.studentCoveredAllSoFar
      ).length;
      const academicProgressPercent = subjectCount
        ? Math.round((completedSubjectCount / subjectCount) * 100)
        : null;

      const { riskStatus, riskReasons } = classifyStudentRisk({
        attendancePercent: overallAttendancePercent,
        totalClasses,
        lastAttendedDate,
        feeStatus,
        feeBalance: balance,
        today: todayStr(),
      });

      return {
        ...student,
        riskStatus,
        riskReasons,
        academicProgressPercent,
        attendanceSummary: {
          totalClasses,
          present,
          absent,
          overallAttendancePercent,
          lastAttendedDate,
        },
        feeSummary: {
          totalFee,
          totalPaid,
          balance,
          paymentProgressPercent,
          status: feeStatus,
          paymentHistory: payments.map((p) => ({
            date: p.paid_date,
            amount: Number(p.amount_paid || 0),
            payment_mode: p.payment_mode,
            bill_no: p.bill_no,
          })),
        },
      };
    });

    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Admin-side counterpart to Online Class recordings — scoped by admin_id
// rather than teacher_id, so an admin can see recordings across every
// teacher's batches, not just their own.
const getBatchRecordingsAdmin = async (req, res) => {
  try {
    const { batchId } = req.params;
    const batch = await Batch.findOne({
      where: { id: batchId, admin_id: req.admin.adminId, active: true },
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

const getRecordingPlaybackUrlAdmin = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const recording = await ClassRecording.findOne({
      where: { id: recordingId, is_deleted: false },
    });
    if (!recording) {
      return res.status(404).json({ success: false, message: "Recording not found." });
    }
    const batch = await Batch.findOne({
      where: { id: recording.batch_id, admin_id: req.admin.adminId },
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

// Admin-only. Removes the actual object from S3 (storage shouldn't
// accumulate from deleted/unwanted recordings) and soft-deletes the
// metadata row (kept for audit, hidden from every list/playback endpoint).
const deleteRecordingAdmin = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const recording = await ClassRecording.findOne({
      where: { id: recordingId, is_deleted: false },
    });
    if (!recording) {
      return res.status(404).json({ success: false, message: "Recording not found." });
    }
    const batch = await Batch.findOne({
      where: { id: recording.batch_id, admin_id: req.admin.adminId },
    });
    if (!batch) {
      return res.status(403).json({ success: false, message: "This recording doesn't belong to you." });
    }
    await deleteObject({ key: recording.s3_key });
    recording.is_deleted = true;
    await recording.save();
    res.status(200).json({ success: true, message: "Recording deleted." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  coursesForSubject,
  includeOptionsFor,
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
  getBatchRecordingsAdmin,
  getRecordingPlaybackUrlAdmin,
  deleteRecordingAdmin,
  getStudentTracking,
};
