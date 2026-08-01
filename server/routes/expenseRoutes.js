const express = require("express");
const router = express.Router();
const {
  createExpense,
  getAllExpenses,
  updateExpense,
  deleteExpense,
  restoreExpense,
  getExpenseBudget,
  updateExpenseBudget,
} = require("../controllers/expenseController");

router.get("/budget", getExpenseBudget);
router.put("/budget", updateExpenseBudget);
router.get("/", getAllExpenses);
router.post("/", createExpense);
router.put("/:id/restore", restoreExpense);
router.put("/:id", updateExpense);
router.delete("/:id", deleteExpense);

module.exports = router;
