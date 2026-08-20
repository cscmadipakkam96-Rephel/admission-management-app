const { Op } = require("sequelize");
const Batch = require("../models/Batch");
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

module.exports = { findConflicts };
