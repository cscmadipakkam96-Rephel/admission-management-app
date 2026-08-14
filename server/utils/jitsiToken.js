const jwt = require("jsonwebtoken");
const crypto = require("crypto");

// Deterministic, non-guessable room slug for a batch's session on a given
// date — HMAC-keyed on the Jitsi app secret so it can't be derived without
// it, and stable across calls so the teacher and every student land in the
// same room without any extra coordination. Batch ids are already unique
// app-wide, so no admin_id needs to be folded in separately.
const getRoomSlug = (batchId, date) =>
  crypto
    .createHmac("sha256", process.env.JITSI_APP_SECRET)
    .update(`${batchId}-${date}`)
    .digest("hex")
    .slice(0, 24);

// Signs a short-lived Jitsi JWT — a distinct trust domain from this app's
// own JWT_SECRET (admin/teacher session cookies). Verified entirely by the
// self-hosted Jitsi deployment, never by this app.
const signJitsiToken = ({ room, name, isModerator }) => {
  const appId = process.env.JITSI_APP_ID;
  return jwt.sign(
    {
      context: { user: { name, moderator: !!isModerator } },
      aud: appId,
      iss: appId,
      sub: process.env.JITSI_DOMAIN,
      room,
    },
    process.env.JITSI_APP_SECRET,
    { expiresIn: "3h", algorithm: "HS256" }
  );
};

module.exports = { getRoomSlug, signJitsiToken };
