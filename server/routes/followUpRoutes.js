const express = require("express");
const router = express.Router();
const {
  getAllFollowUps,
  getFollowUpById,
  createFollowUp,
  updateFollowUp,
  deleteFollowUp,
  restoreFollowUp,
} = require("../controllers/followUpController");

router.get("/", getAllFollowUps);
router.post("/", createFollowUp);
router.put("/:id/restore", restoreFollowUp);
router.get("/:id", getFollowUpById);
router.put("/:id", updateFollowUp);
router.delete("/:id", deleteFollowUp);

module.exports = router;
