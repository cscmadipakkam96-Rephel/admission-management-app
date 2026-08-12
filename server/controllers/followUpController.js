const FollowUp = require("../models/FollowUp");
const Admission = require("../models/Admission");
const InformationSheet = require("../models/InformationSheet");
const Admin = require("../models/Admin");
const { classifyFollowUpBucket } = require("../utils/followUpStatus");

const FOLLOW_UP_TYPES = ["Attendance", "Academic", "Fee", "Enquiry", "General"];
const STATUSES = ["Open", "Completed"];

const todayStr = () => new Date().toISOString().slice(0, 10);

// Attaches display info (linked Admission/InformationSheet) + the derived
// bucket to a list of FollowUp rows in a fixed number of batched queries —
// no Sequelize `include` here (see models/FollowUp.js for why: it breaks
// sequelize.sync({alter:true}) for the unrelated "admissions" table), and no
// per-row query either. Same batch-then-map pattern already used in
// attendanceController.js's getAllAttendance/getBatchWiseAttendance.
const attachDisplayInfo = async (followUps, adminId) => {
  const admissionIds = [
    ...new Set(followUps.map((f) => f.admission_id).filter(Boolean)),
  ];
  const sheetIds = [
    ...new Set(followUps.map((f) => f.information_sheet_id).filter(Boolean)),
  ];

  const [admissions, sheets, admin] = await Promise.all([
    admissionIds.length
      ? Admission.findAll({
          where: { id: admissionIds, admin_id: adminId },
          attributes: [
            "id",
            "applicant_name",
            "initial",
            "comn_enrol_no",
            "mobile_no",
            "course_name",
          ],
        })
      : [],
    sheetIds.length
      ? InformationSheet.findAll({
          where: { id: sheetIds, admin_id: adminId },
          attributes: [
            "id",
            "applicant_name",
            "initial",
            "father_husband_name",
            "father_initial",
            "mobile_no",
            "telephone_no",
            "course_interested",
          ],
        })
      : [],
    Admin.findByPk(adminId),
  ]);
  const admissionById = new Map(admissions.map((a) => [a.id, a]));
  const sheetById = new Map(sheets.map((s) => [s.id, s]));
  const createdBy = admin?.name || admin?.email || "Admin";
  const today = todayStr();

  return followUps.map((f) => {
    const json = f.toJSON ? f.toJSON() : f;
    return {
      ...json,
      Admission: json.admission_id
        ? admissionById.get(json.admission_id) || null
        : null,
      InformationSheet: json.information_sheet_id
        ? sheetById.get(json.information_sheet_id) || null
        : null,
      created_by: createdBy,
      bucket: classifyFollowUpBucket({
        status: json.status,
        due_date: json.due_date,
        today,
      }),
    };
  });
};

const getAllFollowUps = async (req, res) => {
  try {
    const adminId = req.admin.adminId;
    const followUps = await FollowUp.findAll({
      where: { admin_id: adminId, is_deleted: false },
      order: [["due_date", "ASC"]],
    });
    const data = await attachDisplayInfo(followUps, adminId);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getFollowUpById = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.admin.adminId;
    const followUp = await FollowUp.findOne({
      where: { id, admin_id: adminId, is_deleted: false },
    });
    if (!followUp) {
      return res
        .status(404)
        .json({ success: false, message: "Follow-up not found" });
    }
    const [data] = await attachDisplayInfo([followUp], adminId);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const createFollowUp = async (req, res) => {
  try {
    const adminId = req.admin.adminId;
    const {
      admission_id,
      information_sheet_id,
      follow_up_type,
      reason,
      note,
      due_date,
      status,
    } = req.body;

    const errors = {};
    if (!FOLLOW_UP_TYPES.includes(follow_up_type)) {
      errors.follow_up_type = "Select a valid follow-up type.";
    }
    if (status && !STATUSES.includes(status)) {
      errors.status = "Invalid status.";
    }
    if (!due_date) {
      errors.due_date = "Due date is required.";
    }
    const hasAdmission = !!admission_id;
    const hasSheet = !!information_sheet_id;
    if (hasAdmission === hasSheet) {
      errors.source = "Select exactly one: a Student or an Enquiry.";
    }
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ success: false, errors });
    }

    if (hasAdmission) {
      const admission = await Admission.findOne({
        where: { id: admission_id, admin_id: adminId },
      });
      if (!admission) {
        return res
          .status(404)
          .json({ success: false, message: "Student not found" });
      }
    } else {
      const sheet = await InformationSheet.findOne({
        where: { id: information_sheet_id, admin_id: adminId },
      });
      if (!sheet) {
        return res
          .status(404)
          .json({ success: false, message: "Information sheet not found" });
      }
    }

    const finalStatus = status && STATUSES.includes(status) ? status : "Open";
    const followUp = await FollowUp.create({
      admin_id: adminId,
      admission_id: hasAdmission ? admission_id : null,
      information_sheet_id: hasSheet ? information_sheet_id : null,
      follow_up_type,
      reason: reason || null,
      note: note || null,
      due_date,
      status: finalStatus,
      completed_at: finalStatus === "Completed" ? new Date() : null,
    });

    const [data] = await attachDisplayInfo([followUp], adminId);
    res.status(201).json({
      success: true,
      message: "Follow-up created successfully",
      data,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Only follow_up_type/reason/note/due_date/status are ever accepted here —
// admission_id/information_sheet_id/completed_at are never read from the
// body, so the linked person can't be reassigned after creation and
// completed_at can't be spoofed by the client.
const updateFollowUp = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.admin.adminId;
    const followUp = await FollowUp.findOne({
      where: { id, admin_id: adminId, is_deleted: false },
    });
    if (!followUp) {
      return res
        .status(404)
        .json({ success: false, message: "Follow-up not found" });
    }

    const { follow_up_type, reason, note, due_date, status } = req.body;
    const errors = {};
    if (follow_up_type !== undefined && !FOLLOW_UP_TYPES.includes(follow_up_type)) {
      errors.follow_up_type = "Select a valid follow-up type.";
    }
    if (status !== undefined && !STATUSES.includes(status)) {
      errors.status = "Invalid status.";
    }
    if (due_date !== undefined && !due_date) {
      errors.due_date = "Due date is required.";
    }
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ success: false, errors });
    }

    const updates = {};
    if (follow_up_type !== undefined) updates.follow_up_type = follow_up_type;
    if (reason !== undefined) updates.reason = reason || null;
    if (note !== undefined) updates.note = note || null;
    if (due_date !== undefined) updates.due_date = due_date;
    if (status !== undefined && status !== followUp.status) {
      updates.status = status;
      updates.completed_at = status === "Completed" ? new Date() : null;
    }

    await followUp.update(updates);
    const [data] = await attachDisplayInfo([followUp], adminId);
    res.status(200).json({
      success: true,
      message: "Follow-up updated successfully",
      data,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteFollowUp = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.admin.adminId;
    const followUp = await FollowUp.findOne({
      where: { id, admin_id: adminId, is_deleted: false },
    });
    if (!followUp) {
      return res
        .status(404)
        .json({ success: false, message: "Follow-up not found" });
    }
    await followUp.update({ is_deleted: true });
    res
      .status(200)
      .json({ success: true, message: "Follow-up removed successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const restoreFollowUp = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.admin.adminId;
    const followUp = await FollowUp.findOne({
      where: { id, admin_id: adminId, is_deleted: true },
    });
    if (!followUp) {
      return res
        .status(404)
        .json({ success: false, message: "Follow-up not found" });
    }
    await followUp.update({ is_deleted: false });
    res
      .status(200)
      .json({ success: true, message: "Follow-up restored successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getAllFollowUps,
  getFollowUpById,
  createFollowUp,
  updateFollowUp,
  deleteFollowUp,
  restoreFollowUp,
};
