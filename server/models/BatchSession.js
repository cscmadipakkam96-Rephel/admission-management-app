const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const Batch = require("./Batch");
const Teacher = require("./Teacher");

const BatchSession = sequelize.define(
  "BatchSession",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    batch_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: Batch, key: "id" },
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    teacher_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: Teacher, key: "id" },
    },
    started_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    ended_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    topic_covered: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    // "Offline" (default) or "Online" — an Online Class is a mode of this
    // same session, not a separate entity. meeting_link/meeting_provider
    // are only ever set when class_mode is "Online".
    class_mode: {
      type: DataTypes.STRING(10),
      allowNull: false,
      defaultValue: "Offline",
    },
    meeting_link: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    meeting_provider: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    // Mirrors ended_at — set when a teacher cancels an online class before
    // it ends. The row is kept (never destroyed) so a cancelled attempt
    // stays visible as history; only restartBatch ever deletes the row,
    // and only when the teacher explicitly retries.
    cancelled_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "batch_sessions",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
    indexes: [{ unique: true, fields: ["batch_id", "date"] }],
  }
);

Batch.hasOne(BatchSession, { foreignKey: "batch_id" });
BatchSession.belongsTo(Batch, { foreignKey: "batch_id" });
BatchSession.belongsTo(Teacher, { foreignKey: "teacher_id" });

module.exports = BatchSession;
