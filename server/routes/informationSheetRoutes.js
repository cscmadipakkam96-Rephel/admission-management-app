const express = require("express");
const router = express.Router();
const {
  getAllInformationSheets,
  createInformationSheet,
  updateInformationSheet,
  deleteInformationSheet,
  restoreInformationSheet,
} = require("../controllers/informationSheetController");

router.get("/", getAllInformationSheets);
router.post("/", createInformationSheet);
router.put("/:id/restore", restoreInformationSheet);
router.put("/:id", updateInformationSheet);
router.delete("/:id", deleteInformationSheet);

module.exports = router;
