const express = require("express");
const router = express.Router();
const { sendWhatsappMessage } = require("../controllers/whatsappController");

router.post("/send", sendWhatsappMessage);

module.exports = router;
