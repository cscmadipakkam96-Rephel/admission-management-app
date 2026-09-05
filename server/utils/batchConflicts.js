const { Op } = require("sequelize");
const Batch = require("../models/Batch");
const Teacher = require("../models/Teacher");
const { parseTimeRange, rangesOverlap } = require("./timeRange");
const { sectionsOverlapOnDays } = require("./sections");

// Shared by both the admin batch CRUD (batchController.js) and the
// teacher self-service batch CRUD (teacherAuthController.js) so the two
// entry points can never drift apart on what counts as a scheduling
// conflict.
const findConflicts = async ({ adminId, section, timing, subjectId, teacherId, excludeId }) => {
  const newRange = parseTimeRange(timing);
  // subject_completed batches have finished occupying their slot — a
  // teacher who declares a batch done frees its timing/section up for a
  // new batch, without needing to also deactivate (and so disappear from
  // Student Tracking) the completed one.
  const where = { admin_id: adminId, active: true, subject_completed: false };
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

// Used by the Batch Transfer flow — same overlap rules as findConflicts,
// but run against every other teacher for this admin instead of one
// candidate, so only teachers genuinely free at this exact section+timing
// are ever offered as a transfer target.
const getAvailableTeachersForTransfer = async ({ adminId, section, timing, excludeTeacherId }) => {
  const targetRange = parseTimeRange(timing);

  const [teachers, allBatches] = await Promise.all([
    Teacher.findAll({
      where: { admin_id: adminId, active: true, id: { [Op.ne]: excludeTeacherId } },
      attributes: ["id", "teacher_name"],
    }),
    Batch.findAll({ where: { admin_id: adminId, active: true, subject_completed: false } }),
  ]);

  return teachers.filter((t) => {
    const teacherBatches = allBatches.filter((b) => b.teacher_id === t.id);
    const hasClash = teacherBatches.some((b) => {
      if (!sectionsOverlapOnDays(b.section, section)) return false;
      const existingRange = parseTimeRange(b.timing);
      if (!existingRange || !targetRange) return false;
      return rangesOverlap(targetRange, existingRange);
    });
    return !hasClash;
  });
};

module.exports = { findConflicts, getAvailableTeachersForTransfer };
