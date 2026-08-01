const Expense = require("../models/Expense");
const Admin = require("../models/Admin");

const createExpense = async (req, res) => {
  try {
    const {
      title,
      expense_date,
      bill_no,
      category,
      paid_to,
      amount,
      payment_mode,
      description,
      notes,
    } = req.body;
    if (!amount) {
      return res.status(400).json({
        success: false,
        errors: { amount: "Amount is required." },
      });
    }
    const expense = await Expense.create({
      title: title || null,
      expense_date: expense_date || null,
      bill_no: bill_no || null,
      category: category || null,
      paid_to: paid_to || null,
      amount,
      payment_mode: payment_mode || null,
      description: description || null,
      notes: notes || null,
      admin_id: req.admin?.adminId || null,
    });
    res.status(201).json({
      success: true,
      message: "Expense entry saved successfully",
      data: expense,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const getAllExpenses = async (req, res) => {
  try {
    const isActive = req.query.active !== "false";
    const expenses = await Expense.findAll({
      where: { admin_id: req.admin.adminId, is_deleted: !isActive },
      order: [["id", "ASC"]],
    });
    const admin = await Admin.findByPk(req.admin.adminId);
    const createdBy = admin?.name || admin?.email || "Admin";
    const data = expenses.map((e) => ({ ...e.toJSON(), created_by: createdBy }));
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

const updateExpense = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      expense_date,
      bill_no,
      category,
      paid_to,
      amount,
      payment_mode,
      description,
      notes,
    } = req.body;
    const expense = await Expense.findOne({
      where: { id, admin_id: req.admin.adminId, is_deleted: false },
    });
    if (!expense) {
      return res.status(404).json({
        success: false,
        message: "Expense entry not found",
      });
    }
    if (!amount) {
      return res.status(400).json({
        success: false,
        errors: { amount: "Amount is required." },
      });
    }
    await expense.update({
      title: title || null,
      expense_date: expense_date || null,
      bill_no: bill_no || null,
      category: category || null,
      paid_to: paid_to || null,
      amount,
      payment_mode: payment_mode || null,
      description: description || null,
      notes: notes || null,
    });
    res.status(200).json({
      success: true,
      message: "Expense entry updated successfully",
      data: expense,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const deleteExpense = async (req, res) => {
  try {
    const { id } = req.params;
    const expense = await Expense.findOne({
      where: { id, admin_id: req.admin.adminId, is_deleted: false },
    });
    if (!expense) {
      return res.status(404).json({
        success: false,
        message: "Expense entry not found",
      });
    }
    await expense.update({ is_deleted: true });
    res.status(200).json({
      success: true,
      message: "Expense entry deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const restoreExpense = async (req, res) => {
  try {
    const { id } = req.params;
    const expense = await Expense.findOne({
      where: { id, admin_id: req.admin.adminId, is_deleted: true },
    });
    if (!expense) {
      return res.status(404).json({
        success: false,
        message: "Expense entry not found",
      });
    }
    await expense.update({ is_deleted: false });
    res.status(200).json({
      success: true,
      message: "Expense entry restored successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const getExpenseBudget = async (req, res) => {
  try {
    const admin = await Admin.findByPk(req.admin.adminId);
    res.status(200).json({
      success: true,
      data: { monthly_budget: admin?.monthlyExpenseBudget ?? null },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateExpenseBudget = async (req, res) => {
  try {
    const { monthly_budget } = req.body;
    const admin = await Admin.findByPk(req.admin.adminId);
    if (!admin) {
      return res.status(404).json({ success: false, message: "Admin not found" });
    }
    await admin.update({
      monthlyExpenseBudget: monthly_budget === "" || monthly_budget == null ? null : monthly_budget,
    });
    res.status(200).json({
      success: true,
      message: "Monthly budget updated successfully",
      data: { monthly_budget: admin.monthlyExpenseBudget },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  createExpense,
  getAllExpenses,
  updateExpense,
  deleteExpense,
  restoreExpense,
  getExpenseBudget,
  updateExpenseBudget,
};
