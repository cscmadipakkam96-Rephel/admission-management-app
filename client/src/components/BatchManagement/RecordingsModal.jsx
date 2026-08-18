import { useEffect, useState } from "react";
import API from "../../api/api";

// Opened via the fixed DOM id "recordingsModal" (Modal.getOrCreateInstance),
// same convention every other modal in this app already uses. `batch`
// controls which batch's recordings are shown — set just before .show().
function RecordingsModal({ batch }) {
  const [recordings, setRecordings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [playingId, setPlayingId] = useState(null);

  useEffect(() => {
    if (!batch) return;
    setLoading(true);
    setError("");
    API.get(`/batches/${batch.id}/recordings`)
      .then((response) => setRecordings(response.data.data))
      .catch((err) =>
        setError(err.response?.data?.message || "Failed to load recordings.")
      )
      .finally(() => setLoading(false));
  }, [batch]);

  const play = async (recordingId) => {
    setPlayingId(recordingId);
    try {
      const response = await API.get(`/batches/recordings/${recordingId}/playback-url`);
      window.open(response.data.data.playback_url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err.response?.data?.message || "Failed to open recording.");
    } finally {
      setPlayingId(null);
    }
  };

  const formatDuration = (seconds) => {
    if (!seconds) return "—";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  return (
    <div className="modal fade" id="recordingsModal" tabIndex="-1">
      <div className="modal-dialog modal-lg">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">
              <i className="bi bi-camera-video me-2"></i>
              Recordings — {batch?.batch_name}
            </h5>
            <button type="button" className="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div className="modal-body">
            {loading && <div className="text-muted">Loading recordings...</div>}
            {!loading && error && <div className="alert alert-danger py-2">{error}</div>}
            {!loading && !error && recordings.length === 0 && (
              <div className="text-muted">No recordings for this batch yet.</div>
            )}
            {!loading && !error && recordings.length > 0 && (
              <div className="table-responsive">
                <table className="table table-sm align-middle">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Duration</th>
                      <th>Size</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {recordings.map((r) => (
                      <tr key={r.id}>
                        <td>{r.session_date}</td>
                        <td>{formatDuration(r.duration_seconds)}</td>
                        <td>{r.file_size_mb ? `${r.file_size_mb.toFixed(1)} MB` : "—"}</td>
                        <td className="text-end">
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-primary"
                            disabled={playingId === r.id}
                            onClick={() => play(r.id)}
                          >
                            <i className="bi bi-play-fill me-1"></i>
                            {playingId === r.id ? "Opening..." : "Play"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default RecordingsModal;
