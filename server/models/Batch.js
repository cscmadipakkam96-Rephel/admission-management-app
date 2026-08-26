const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const Admin = require("./Admin");
const Subject = require("./Subject");
const Teacher = require("./Teacher");

const Batch = sequelize.define(
  "Batch",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    admin_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: Admin, key: "adminId" },
    },
    batch_name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    // 'fast_track' | 'normal_mwf' | 'normal_tts' | 'weekend'
    section: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    subject_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: Subject, key: "id" },
    },
    teacher_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: Teacher, key: "id" },
    },
    // null = created by an admin (the default for every batch until this
    // feature shipped). Set to a Teacher.id when that teacher created the
    // batch themselves via the teacher portal — drives both the "created
    // by" tag and the teacher-side edit/delete ownership check.
    created_by_teacher_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: Teacher, key: "id" },
    },
    timing: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    num_days: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    // Teacher-declared "I've covered every topic for this subject in this
    // batch" — there's no master syllabus topic list to check against
    // (topic_covered is free text per session), so this is a manual call.
    subject_completed: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    subject_completed_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    // Who last edited this batch's own fields (name/section/subject/timing)
    // via the teacher portal, and when — surfaced to both admin (Batch
    // Management) and the teacher's own batch card. Plain FK-shaped column,
    // no association call — see the note below on why.
    last_edited_by_teacher_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: Teacher, key: "id" },
    },
    last_edited_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "batches",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
  }
);

Subject.hasMany(Batch, { foreignKey: "subject_id" });
Batch.belongsTo(Subject, { foreignKey: "subject_id" });
Teacher.hasMany(Batch, { foreignKey: "teacher_id" });
Batch.belongsTo(Teacher, { foreignKey: "teacher_id" });

module.exports = Batch;
