const InformationSheet = require("../models/InformationSheet");
const Admission = require("../models/Admission");

// Normalizes a phone number to its last 10 digits so formatting
// differences (+91 prefix, spaces, dashes) don't break matching.
const normalizePhone = (value) => {
  const digits = (value || "").replace(/\D/g, "");
  return digits.slice(-10);
};

const FIELDS = [
  "applicant_name",
  "father_husband_name",
  "address",
  "mobile_no",
  "email",
  "sex",
  "religion",
  "community",
  "educational_qualification",
  "occupation",
  "pin_code",
  "qualification_status",
  "qualification_year",
  "qualification_subject",
  "prior_course_institution",
  "prior_course_subject",
  "family_income",
  "study_reason",
  "course_interested",
  "preferred_timings",
  "plan_to_join",
  "status",
  "heard_source",
  "interested_updates",
  "sheet_date",
  "enrol_no",
  "course",
  "date_of_joining",
  "counselling_handled_by",
  "counselling_date",
  "counselling_time",
];

const DATE_FIELDS = ["sheet_date", "date_of_joining", "counselling_date"];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const pickFields = (body) => {
  const data = {};
  FIELDS.forEach((field) => {
    let value = body[field] ?? null;
    if (DATE_FIELDS.includes(field) && !DATE_PATTERN.test(value || "")) {
      value = null;
    }
    data[field] = value;
  });
  return data;
};

const getAllInformationSheets = async (req, res) => {
  try {
    const isActive = req.query.active !== "false";
    const sheets = await InformationSheet.findAll({
      where: { active: isActive, admin_id: req.admin.adminId },
      order: [["id", "DESC"]],
    });

    const admissions = await Admission.findAll({
      where: { admin_id: req.admin.adminId, active: true },
      attributes: ["mobile_no"],
    });
    const admittedPhones = new Set(
      admissions.map((a) => normalizePhone(a.mobile_no)).filter(Boolean)
    );

    const data = sheets.map((s) => {
      const sheetPhones = (s.mobile_no || "")
        .split("/")
        .map((p) => normalizePhone(p))
        .filter(Boolean);
      const is_joined = sheetPhones.some((p) => admittedPhones.has(p));
      return {
        ...s.toJSON(),
        is_joined,
        effective_plan_to_join: is_joined ? "Joined" : s.plan_to_join,
      };
    });

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const createInformationSheet = async (req, res) => {
  try {
    const sheet = await InformationSheet.create({
      ...pickFields(req.body),
      admin_id: req.admin?.adminId || null,
    });
    res.status(201).json({
      success: true,
      message: "Information sheet saved successfully",
      data: sheet,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const updateInformationSheet = async (req, res) => {
  try {
    const { id } = req.params;
    const sheet = await InformationSheet.findOne({
      where: { id, admin_id: req.admin.adminId },
    });
    if (!sheet) {
      return res.status(404).json({
        success: false,
        message: "Information sheet not found",
      });
    }

    await sheet.update(pickFields(req.body));

    res.status(200).json({
      success: true,
      message: "Information sheet updated successfully",
      data: sheet,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const deleteInformationSheet = async (req, res) => {
  try {
    const { id } = req.params;
    const sheet = await InformationSheet.findOne({
      where: { id, admin_id: req.admin.adminId },
    });
    if (!sheet) {
      return res.status(404).json({
        success: false,
        message: "Information sheet not found",
      });
    }
    await sheet.update({ active: false });
    res.status(200).json({
      success: true,
      message: "Information sheet removed successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const restoreInformationSheet = async (req, res) => {
  try {
    const { id } = req.params;
    const sheet = await InformationSheet.findOne({
      where: { id, admin_id: req.admin.adminId },
    });
    if (!sheet) {
      return res.status(404).json({
        success: false,
        message: "Information sheet not found",
      });
    }
    await sheet.update({ active: true });
    res.status(200).json({
      success: true,
      message: "Information sheet restored successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  getAllInformationSheets,
  createInformationSheet,
  updateInformationSheet,
  deleteInformationSheet,
  restoreInformationSheet,
};
