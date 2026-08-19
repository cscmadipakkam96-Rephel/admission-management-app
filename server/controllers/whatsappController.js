// Proxies outbound WhatsApp sends through our own self-hosted wacrm
// instance (see docs/public-api.md there) — this server holds the
// wacrm API key, never the browser, so it never reaches the client.
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

const sendWhatsappMessage = async (req, res) => {
  try {
    const { to, message } = req.body;

    if (!to || !E164_PATTERN.test(to.trim())) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid phone number in international format, e.g. +919876543210.",
      });
    }
    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: "Message is required." });
    }
    if (!process.env.WACRM_API_URL || !process.env.WACRM_API_KEY) {
      return res.status(500).json({
        success: false,
        message: "WhatsApp sending is not configured on the server yet.",
      });
    }

    const wacrmResponse = await fetch(`${process.env.WACRM_API_URL}/api/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.WACRM_API_KEY}`,
      },
      body: JSON.stringify({
        to: to.trim(),
        type: "text",
        text: message.trim(),
      }),
    });

    const wacrmData = await wacrmResponse.json();
    if (!wacrmResponse.ok) {
      return res.status(502).json({
        success: false,
        message: wacrmData?.error?.message || "Failed to send WhatsApp message right now.",
      });
    }

    res.status(200).json({ success: true, data: wacrmData.data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { sendWhatsappMessage };
