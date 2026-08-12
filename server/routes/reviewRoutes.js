const express = require("express");
const router = express.Router();
const { getReviewFormOptions, generateReview } = require("../controllers/reviewController");

router.get("/form-options", getReviewFormOptions);
router.post("/generate", generateReview);

module.exports = router;
