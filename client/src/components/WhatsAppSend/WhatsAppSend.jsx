import { useState } from "react";
import API from "../../api/api";

// Bare-bones test page for the wacrm integration: type a number + message,
// send, and see the raw result. Console-logs the error on failure so it's
// easy to inspect what wacrm/Meta actually rejected.
function WhatsAppSend() {
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const handleSend = async (e) => {
    e.preventDefault();
    setSending(true);
    setResult(null);
    setError("");
    try {
      const response = await API.post("/whatsapp/send", { to, message });
      setResult(response.data.data);
    } catch (err) {
      console.error("WhatsApp send failed:", err);
      setError(err.response?.data?.message || "Failed to send message.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="container-fluid" style={{ maxWidth: "500px" }}>
      <h4 className="mb-3">Send WhatsApp Message (test)</h4>
      <form onSubmit={handleSend} className="card shadow-sm">
        <div className="card-body">
          <div className="mb-3">
            <label className="form-label">Phone Number</label>
            <input
              type="text"
              className="form-control"
              placeholder="+919876543210"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              required
            />
          </div>
          <div className="mb-3">
            <label className="form-label">Message</label>
            <textarea
              className="form-control"
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary w-100" disabled={sending}>
            {sending ? "Sending..." : "Send"}
          </button>
          {error && <div className="alert alert-danger mt-3 mb-0">{error}</div>}
          {result && (
            <div className="alert alert-success mt-3 mb-0">
              Sent. Message ID: {result.whatsapp_message_id}
            </div>
          )}
        </div>
      </form>
    </div>
  );
}

export default WhatsAppSend;
