const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const Admin = require("./Admin");
const Batch = require("./Batch");
const Teacher = require("./Teacher");

const ClassRecording = sequelize.define(
  "ClassRecording",
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
    batch_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: Batch, key: "id" },
    },
    // Pairs with batch_id the same way Online Class already identifies a
    // BatchSession — no FK to BatchSession.id, just the same batch+date
    // lookup pattern used everywhere else this session touched it.
    session_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    teacher_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: Teacher, key: "id" },
    },
    // Never a full/public URL — always resolved through a fresh presigned
    // GET URL at playback time (server/utils/s3.js).
    s3_key: {
      type: DataTypes.STRING(500),
      allowNull: false,
    },
    duration_seconds: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    file_size_mb: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
    uploaded_by: {
      type: DataTypes.STRING(10),
      allowNull: false,
      defaultValue: "Teacher",
    },
    is_deleted: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  },
  {
    tableName: "class_recordings",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
  }
);

// Deliberately no Batch.hasMany(ClassRecording)/ClassRecording.belongsTo(Batch)
// (or the Teacher equivalent) here — same reasoning as FollowUp.js: Batch
// already has other associations declared against it elsewhere, and adding
// one more previously made sequelize.sync({alter:true}) miscompute and try
// to drop an unrelated, still-in-use foreign key constraint. The plain
// `references` above still gives real FK integrity at the DB level;
// controllers do their own batched lookups instead of a Sequelize `include`.
module.exports = ClassRecording;
