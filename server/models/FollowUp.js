const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const Admin = require("./Admin");
const Admission = require("./Admission");
const InformationSheet = require("./InformationSheet");

const FollowUp = sequelize.define(
  "FollowUp",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    admin_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: Admin,
        key: "adminId",
      },
    },
    // Exactly one of admission_id / information_sheet_id should be set —
    // enforced in followUpController.js (app-level, matching how every
    // other cross-field rule in this codebase works — no DB constraint).
    admission_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: Admission, key: "id" },
    },
    information_sheet_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: InformationSheet, key: "id" },
    },
    // Controlled list: Attendance | Academic | Fee | Enquiry | General —
    // validated in followUpController.js, same as Course.status/Teacher.status.
    follow_up_type: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    reason: {
      type: DataTypes.STRING(150),
      allowNull: true,
    },
    note: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    due_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    // Controlled list: Open | Completed.
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: "Open",
    },
    // Set/cleared only server-side (on the Open<->Completed transition in
    // updateFollowUp) — never trusted from the client.
    completed_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    is_deleted: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  },
  {
    tableName: "follow_ups",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
  }
);

// Deliberately no Admission.hasMany(FollowUp)/FollowUp.belongsTo(Admission)
// (or the InformationSheet equivalent) here. Admission/InformationSheet
// already each have several other hasMany associations declared against
// them elsewhere; adding one more here made sequelize.sync({alter:true})
// (server/index.js) miscompute and try to DROP a still-in-use foreign key
// constraint on the existing "admissions" table (verified via a read-only
// pg_constraint query — the live constraint is named "admissions_admin_id_fkey",
// sequelize's alter-diff was instead trying to drop a nonexistent
// "admissions_admin_id_fkey1", failing the whole sync and refusing to boot
// at all). The plain `references` on admission_id/information_sheet_id
// above still gives real FK referential integrity at the DB level; the
// controller does its own batched lookups (Admission.findAll/InformationSheet.findAll
// by id, same pattern already used in attendanceController.js's
// getAllAttendance/getBatchWiseAttendance) instead of a Sequelize `include`.
module.exports = FollowUp;
