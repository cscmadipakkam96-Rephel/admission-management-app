import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { JitsiMeeting } from "@jitsi/react-sdk";
import API from "../../api/api";

function OnlineClassJoin() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [classInfo, setClassInfo] = useState(null);
  const [error, setError] = useState("");
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    API.get(`/teacher-auth/online-class/join/${token}`)
      .then((response) => setClassInfo(response.data.data))
      .catch((err) =>
        setError(err.response?.data?.message || "This join link isn't working right now.")
      )
      .finally(() => setLoading(false));
  }, [token]);

  if (joined && classInfo) {
    return (
      <div style={{ height: "100vh", width: "100vw" }}>
        <JitsiMeeting
          domain={classInfo.jitsi_domain}
          roomName={classInfo.room}
          jwt={classInfo.jitsi_token}
          configOverwrite={{ prejoinPageEnabled: false }}
          getIFrameRef={(iframeRef) => {
            iframeRef.style.height = "100%";
            iframeRef.style.width = "100%";
          }}
        />
      </div>
    );
  }

  return (
    <div
      className="container-fluid d-flex justify-content-center align-items-center"
      style={{ minHeight: "100vh", padding: "24px", background: "#f4f6fb" }}
    >
      <div className="card shadow-sm w-100" style={{ maxWidth: "460px" }}>
        <div className="card-header bg-primary text-white py-3">
          <h4 className="mb-0">
            <i className="bi bi-camera-video-fill me-2"></i>Online Class
          </h4>
        </div>
        <div className="card-body text-center py-4">
          {loading && <div className="text-muted">Checking your class link...</div>}

          {!loading && error && (
            <div>
              <i className="bi bi-exclamation-triangle text-warning" style={{ fontSize: "2rem" }}></i>
              <p className="mt-3 mb-0">{error}</p>
            </div>
          )}

          {!loading && !error && classInfo && (
            <div>
              <div className="fw-semibold fs-5">{classInfo.batch_name}</div>
              {classInfo.topic_covered && (
                <div className="text-muted small mt-1">
                  <i className="bi bi-journal-text me-1"></i>
                  {classInfo.topic_covered}
                </div>
              )}
              {classInfo.teacher_name && (
                <div className="text-muted small">
                  <i className="bi bi-person me-1"></i>
                  {classInfo.teacher_name}
                </div>
              )}
              <button
                type="button"
                className="btn btn-primary w-100 mt-4"
                onClick={() => setJoined(true)}
              >
                <i className="bi bi-camera-video me-1"></i>
                Join Class
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default OnlineClassJoin;
