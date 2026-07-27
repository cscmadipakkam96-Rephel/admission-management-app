const { Op } = require("sequelize");
const Batch = require("../models/Batch");
const Subject = require("../models/Subject");
const Course = require("../models/Course");
const Teacher = require("../models/Teacher");
const Admission = require("../models/Admission");
const BatchSession = require("../models/BatchSession");
const BatchSubstitution = require("../models/BatchSubstitution");
const Attendance = require("../models/Attendance");
const StudentEntryAttendance = require("../models/StudentEntryAttendance");
const { parseTimeRange, rangesOverlap } = require("../utils/timeRange");
const {
  VALID_SECTIONS,
  SECTION_LABELS,
  sectionsOverlapOnDays,
  isSectionActiveToday,
} = require("../utils/sections");

const includeOptionsFor = (todayStr) => [
  { model: Subject, attributes: ["id", "subject_name", "parent_id"] },
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

const findConflicts = async ({ adminId, section, timing, subjectId, teacherId, excludeId }) => {
  const newRange = parseTimeRange(timing);
  const where = { admin_id: adminId, active: true };
  if (excludeId) where.id = { [Op.ne]: excludeId };

  const existingBatches = await Batch.findAll({ where });

  const sameSlotSameSubject = existingBatches.find(
    (b) =>
      b.section === section &&
      b.subject_id === Number(subjectId) &&
      b.timing === timing
  );
  if (sameSlotSameSubject) {
    return `This subject already has a batch in this section at this exact timing.`;
  }

  if (newRange) {
    const teacherClash = existingBatches.find((b) => {
      if (b.teacher_id !== Number(teacherId)) return false;
      if (!sectionsOverlapOnDays(b.section, section)) return false;
      const existingRange = parseTimeRange(b.timing);
      if (!existingRange) return false;
      return rangesOverlap(newRange, existingRange);
    });
    if (teacherClash) {
      return `This teacher already has "${teacherClash.batch_name}" (${teacherClash.timing}) scheduled on an overlapping day. Choose a different time or teacher.`;
    }
  }

  return null;
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
          where: { batch_id: batchIds, topic_covered: { [Op.ne]: null } },
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
const getSubjectCompletionChart = async (req, res) => {
  try {
    const adminId = req.admin.adminId;
    const batches = await Batch.findAll({
      where: { admin_id: adminId, active: true, num_days: { [Op.ne]: null } },
      include: [
        { model: Subject, attributes: ["id", "subject_name"] },
        { model: Admission, as: "Students", through: { attributes: [] } },
      ],
    });

    const batchIds = batches.map((b) => b.id);
    const attendanceRows = batchIds.length
      ? await Attendance.findAll({ where: { batch_id: batchIds } })
      : [];

    const bySubject = new Map();
    batches.forEach((b) => {
      const key = b.subject_id;
      if (!bySubject.has(key)) {
        bySubject.set(key, {
          subject_id: b.subject_id,
          subject_name: b.Subject?.subject_name || "Unknown",
          completedStudents: [],
          notCompletedStudents: [],
        });
      }
      const bucket = bySubject.get(key);
      (b.Students || []).forEach((s) => {
        const presentCount = attendanceRows.filter(
          (a) => a.batch_id === b.id && a.admission_id === s.id
        ).length;
        const entry = {
          id: s.id,
          applicant_name: s.applicant_name,
          comn_enrol_no: s.comn_enrol_no,
          batch_id: b.id,
          batch_name: b.batch_name,
          presentCount,
          num_days: b.num_days,
        };
        if (presentCount >= b.num_days) {
          bucket.completedStudents.push(entry);
        } else {
          bucket.notCompletedStudents.push(entry);
        }
      });
    });

    const data = Array.from(bySubject.values()).map((s) => ({
      subject_id: s.subject_id,
      subject_name: s.subject_name,
      completedCount: s.completedStudents.length,
      notCompletedCount: s.notCompletedStudents.length,
      completedStudents: s.completedStudents,
      notCompletedStudents: s.notCompletedStudents,
    }));

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

// Admin view — per-student, per-subject topic completion. A topic only
// counts as "completed" for a student when BOTH signals agree they were
// really there that day: class attendance (Attendance row for that
// batch+date) AND campus entry attendance (StudentEntryAttendance for that
// date) — same double-check already used elsewhere for entry attendance.
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
          where: { batch_id: batchIds, topic_covered: { [Op.ne]: null } },
          order: [["date", "ASC"]],
        })
      : [];
    const classAttendance = batchIds.length
      ? await Attendance.findAll({ where: { batch_id: batchIds } })
      : [];

    const admissionIds = [
      ...new Set(batches.flatMap((b) => (b.Students || []).map((s) => s.id))),
    ];
    const entryAttendance = admissionIds.length
      ? await StudentEntryAttendance.findAll({ where: { admission_id: admissionIds } })
      : [];
    const entryDatesByAdmission = new Map();
    entryAttendance.forEach((e) => {
      if (!entryDatesByAdmission.has(e.admission_id)) {
        entryDatesByAdmission.set(e.admission_id, new Set());
      }
      entryDatesByAdmission.get(e.admission_id).add(e.date);
    });

    const studentMap = new Map();

    batches.forEach((b) => {
      const batchSessions = sessions.filter((s) => s.batch_id === b.id);
      (b.Students || []).forEach((student) => {
        const attendanceByDate = new Map(
          classAttendance
            .filter((a) => a.batch_id === b.id && a.admission_id === student.id)
            .map((a) => [a.date, a])
        );
        const entryDates = entryDatesByAdmission.get(student.id) || new Set();

        const completedTopics = [];
        const missedTopics = [];
        batchSessions.forEach((s) => {
          const hasClassAttendance = attendanceByDate.has(s.date);
          const hasEntryAttendance = entryDates.has(s.date);
          const topic = {
            date: s.date,
            topic_covered: s.topic_covered,
            in_time: attendanceByDate.get(s.date)?.in_time || null,
            out_time: attendanceByDate.get(s.date)?.out_time || null,
          };
          if (hasClassAttendance && hasEntryAttendance) {
            completedTopics.push(topic);
          } else {
            missedTopics.push({
              ...topic,
              reason:
                !hasClassAttendance && !hasEntryAttendance
                  ? "Absent from class and no campus entry recorded"
                  : !hasClassAttendance
                    ? "Not marked present in class"
                    : "No campus entry recorded that day",
            });
          }
        });

        const totalTopics = batchSessions.length;
        const completionPercent = totalTopics
          ? Math.round((completedTopics.length / totalTopics) * 100)
          : 0;

        if (!studentMap.has(student.id)) {
          studentMap.set(student.id, {
            id: student.id,
            applicant_name: student.applicant_name,
            comn_enrol_no: student.comn_enrol_no,
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
        });
      });
    });

    res.status(200).json({ success: true, data: Array.from(studentMap.values()) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
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
};
