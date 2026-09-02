import { useEffect, useRef, useState } from "react";
import { Modal } from "bootstrap";
import API from "../../api/api";

const initialForm = { title: "", price: "", duration_minutes: "" };

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatPrice(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return "-";
  return `₹${num.toLocaleString("en-IN")}`;
}

// Admin-side management for the paid Course Video catalog — upload a
// video with a title + price, and every upload/edit/delete here fans out
// to the Student App's own S3 bucket (server/controllers/courseVideoController.js)
// so Flutter has the same file + up-to-date price/title to build its own
// Razorpay-gated listing against.
function CourseVideoDelivery() {
  const editModalRef = useRef(null);
  const deleteModalRef = useRef(null);

  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);

  const [uploadForm, setUploadForm] = useState(initialForm);
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadErrors, setUploadErrors] = useState({});
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);

  const [editingVideo, setEditingVideo] = useState(null);
  const [editForm, setEditForm] = useState(initialForm);
  const [editErrors, setEditErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const [previewingId, setPreviewingId] = useState(null);

  const fetchVideos = async () => {
    try {
      const response = await API.get("/course-videos");
      setVideos(response.data.data);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load course videos.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVideos();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  const validate = (form) => {
    const errors = {};
    if (!form.title.trim()) errors.title = "Title is required.";
    if (form.price === "" || Number(form.price) < 0) {
      errors.price = "A valid, non-negative price is required.";
    }
    return errors;
  };

  const handleUploadChange = (e) => {
    const { name, value } = e.target;
    setUploadForm((prev) => ({ ...prev, [name]: value }));
    setUploadErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const putToS3 = (uploadUrl, file, onProgress) =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", uploadUrl);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`S3 upload failed with status ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error("S3 upload failed — network error."));
      xhr.send(file);
    });

  const handleUpload = async (e) => {
    e.preventDefault();
    const errors = validate(uploadForm);
    if (!uploadFile) errors.file = "Choose a video file to upload.";
    if (Object.keys(errors).length > 0) {
      setUploadErrors(errors);
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    try {
      const urlResponse = await API.post("/course-videos/upload-url", {
        filename: uploadFile.name,
        contentType: uploadFile.type || "application/octet-stream",
      });
      const { upload_url, s3_key } = urlResponse.data.data;

      await putToS3(upload_url, uploadFile, setUploadProgress);

      await API.post("/course-videos", {
        title: uploadForm.title.trim(),
        price: uploadForm.price,
        duration_minutes: uploadForm.duration_minutes,
        s3_key,
        file_size_mb: Math.round((uploadFile.size / (1024 * 1024)) * 100) / 100,
        content_type: uploadFile.type || "application/octet-stream",
      });

      setUploadForm(initialForm);
      setUploadFile(null);
      setUploadProgress(0);
      const fileInput = document.getElementById("courseVideoFileInput");
      if (fileInput) fileInput.value = "";
      await fetchVideos();
      setToast({ variant: "success", message: "Course video uploaded and delivered to the Student App." });
    } catch (err) {
      const serverErrors = err.response?.data?.errors;
      if (serverErrors) {
        setUploadErrors(serverErrors);
      } else {
        setToast({
          variant: "danger",
          message: err.response?.data?.message || err.message || "Upload failed.",
        });
      }
    } finally {
      setUploading(false);
    }
  };

  const openEditModal = (video) => {
    setEditingVideo(video);
    setEditForm({
      title: video.title,
      price: video.price,
      duration_minutes: video.duration_minutes ?? "",
    });
    setEditErrors({});
    Modal.getOrCreateInstance(editModalRef.current).show();
  };

  const handleEditChange = (e) => {
    const { name, value } = e.target;
    setEditForm((prev) => ({ ...prev, [name]: value }));
    setEditErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const handleEditSave = async (e) => {
    e.preventDefault();
    const errors = validate(editForm);
    if (Object.keys(errors).length > 0) {
      setEditErrors(errors);
      return;
    }
    setSaving(true);
    try {
      await API.put(`/course-videos/${editingVideo.id}`, {
        title: editForm.title.trim(),
        price: editForm.price,
        duration_minutes: editForm.duration_minutes,
      });
      Modal.getOrCreateInstance(editModalRef.current).hide();
      await fetchVideos();
      setToast({ variant: "success", message: "Course video updated and re-synced to the Student App." });
    } catch (err) {
      const serverErrors = err.response?.data?.errors;
      if (serverErrors) {
        setEditErrors(serverErrors);
      } else {
        setToast({
          variant: "danger",
          message: err.response?.data?.message || "Failed to update course video.",
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (id) => {
    setPendingDeleteId(id);
    Modal.getOrCreateInstance(deleteModalRef.current).show();
  };

  const handleDelete = async () => {
    try {
      await API.delete(`/course-videos/${pendingDeleteId}`);
      Modal.getOrCreateInstance(deleteModalRef.current).hide();
      await fetchVideos();
      setToast({ variant: "success", message: "Course video removed from both buckets." });
    } catch (err) {
      setToast({
        variant: "danger",
        message: err.response?.data?.message || "Failed to delete course video.",
      });
    }
  };

  const handlePreview = async (video) => {
    setPreviewingId(video.id);
    try {
      const response = await API.get(`/course-videos/${video.id}/playback-url`);
      window.open(response.data.data.playback_url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setToast({
        variant: "danger",
        message: err.response?.data?.message || "Failed to open preview.",
      });
    } finally {
      setPreviewingId(null);
    }
  };

  if (loading)
    return (
      <div className="text-center p-5">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
      </div>
    );
  if (error) return <p className="text-center text-danger p-4">{error}</p>;

  return (
    <div className="container-fluid" style={{ maxWidth: "1100px" }}>
      {toast && (
        <div className="toast-container position-fixed top-0 end-0 p-3" style={{ zIndex: 1080 }}>
          <div className={`toast show text-white bg-${toast.variant}`}>
            <div className="d-flex">
              <div className="toast-body">{toast.message}</div>
              <button
                type="button"
                className="btn-close btn-close-white me-2 m-auto"
                onClick={() => setToast(null)}
              ></button>
            </div>
          </div>
        </div>
      )}

      <div className="card shadow-sm mb-4">
        <div className="card-body">
          <h4 className="mb-1">Course Video Delivery</h4>
          <p className="text-muted small mb-3">
            Upload a paid course video with its title and price. It's stored in our own S3 bucket and
            automatically delivered to the Student App's bucket so it can be listed there.
          </p>
          <form onSubmit={handleUpload}>
            <div className="row g-3 align-items-start">
              <div className="col-md-3">
                <label className="form-label">Course Video Title</label>
                <input
                  type="text"
                  name="title"
                  className={`form-control ${uploadErrors.title ? "is-invalid" : ""}`}
                  value={uploadForm.title}
                  onChange={handleUploadChange}
                  disabled={uploading}
                />
                {uploadErrors.title && <div className="invalid-feedback">{uploadErrors.title}</div>}
              </div>
              <div className="col-md-2">
                <label className="form-label">Price (₹)</label>
                <input
                  type="number"
                  name="price"
                  min="0"
                  className={`form-control ${uploadErrors.price ? "is-invalid" : ""}`}
                  value={uploadForm.price}
                  onChange={handleUploadChange}
                  disabled={uploading}
                />
                {uploadErrors.price && <div className="invalid-feedback">{uploadErrors.price}</div>}
              </div>
              <div className="col-md-2">
                <label className="form-label">Duration (min)</label>
                <input
                  type="number"
                  name="duration_minutes"
                  min="0"
                  className={`form-control ${uploadErrors.duration_minutes ? "is-invalid" : ""}`}
                  value={uploadForm.duration_minutes}
                  onChange={handleUploadChange}
                  disabled={uploading}
                />
                {uploadErrors.duration_minutes && (
                  <div className="invalid-feedback">{uploadErrors.duration_minutes}</div>
                )}
              </div>
              <div className="col-md-3">
                <label className="form-label">Video File</label>
                <input
                  id="courseVideoFileInput"
                  type="file"
                  accept="video/*"
                  className={`form-control ${uploadErrors.file ? "is-invalid" : ""}`}
                  onChange={(e) => {
                    setUploadFile(e.target.files[0] || null);
                    setUploadErrors((prev) => ({ ...prev, file: undefined }));
                  }}
                  disabled={uploading}
                />
                {uploadErrors.file && <div className="invalid-feedback">{uploadErrors.file}</div>}
              </div>
              <div className="col-md-2">
                <label className="form-label d-block">&nbsp;</label>
                <button type="submit" className="btn btn-primary w-100" disabled={uploading}>
                  {uploading ? "Uploading..." : "Upload"}
                </button>
              </div>
            </div>
            {uploading && (
              <div className="progress mt-3" style={{ height: "8px" }}>
                <div
                  className="progress-bar bg-primary"
                  style={{ width: `${uploadProgress}%` }}
                ></div>
              </div>
            )}
          </form>
        </div>
      </div>

      <div className="card shadow-sm">
        <div className="card-body">
          <h5 className="mb-3">Uploaded Course Videos ({videos.length})</h5>
          <div className="table-responsive">
            <table className="table table-striped table-hover align-middle">
              <thead className="table-primary">
                <tr>
                  <th>#</th>
                  <th>Title</th>
                  <th>Price</th>
                  <th>Duration</th>
                  <th>Size</th>
                  <th>Uploaded On</th>
                  <th>Student App Sync</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {videos.length === 0 ? (
                  <tr>
                    <td className="text-center text-muted py-4" colSpan={8}>
                      <i className="bi bi-camera-video fs-3 d-block mb-2"></i>
                      No course videos uploaded yet.
                    </td>
                  </tr>
                ) : (
                  videos.map((v, index) => (
                    <tr key={v.id}>
                      <td>{index + 1}</td>
                      <td>{v.title}</td>
                      <td>{formatPrice(v.price)}</td>
                      <td>{v.duration_minutes ? `${v.duration_minutes} min` : "-"}</td>
                      <td>{v.file_size_mb ? `${v.file_size_mb} MB` : "-"}</td>
                      <td>{formatDate(v.created_at)}</td>
                      <td>
                        {v.student_app_s3_key ? (
                          <span className="badge bg-success">
                            <i className="bi bi-check-circle me-1"></i>Synced
                          </span>
                        ) : (
                          <span className="badge bg-warning text-dark">
                            <i className="bi bi-exclamation-triangle me-1"></i>Pending
                          </span>
                        )}
                      </td>
                      <td className="d-flex gap-2">
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-secondary"
                          title="Preview"
                          disabled={previewingId === v.id}
                          onClick={() => handlePreview(v)}
                        >
                          <i className="bi bi-play-fill"></i>
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-primary"
                          title="Edit"
                          onClick={() => openEditModal(v)}
                        >
                          <i className="bi bi-pencil"></i>
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-danger"
                          title="Delete"
                          onClick={() => confirmDelete(v.id)}
                        >
                          <i className="bi bi-trash"></i>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      <div className="modal fade" id="courseVideoEditModal" tabIndex="-1" ref={editModalRef}>
        <div className="modal-dialog">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">Edit Course Video</h5>
              <button type="button" className="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <form onSubmit={handleEditSave}>
              <div className="modal-body">
                <div className="mb-3">
                  <label className="form-label">Title</label>
                  <input
                    type="text"
                    name="title"
                    className={`form-control ${editErrors.title ? "is-invalid" : ""}`}
                    value={editForm.title}
                    onChange={handleEditChange}
                  />
                  {editErrors.title && <div className="invalid-feedback">{editErrors.title}</div>}
                </div>
                <div className="mb-3">
                  <label className="form-label">Price (₹)</label>
                  <input
                    type="number"
                    name="price"
                    min="0"
                    className={`form-control ${editErrors.price ? "is-invalid" : ""}`}
                    value={editForm.price}
                    onChange={handleEditChange}
                  />
                  {editErrors.price && <div className="invalid-feedback">{editErrors.price}</div>}
                </div>
                <div className="mb-3">
                  <label className="form-label">Duration (min)</label>
                  <input
                    type="number"
                    name="duration_minutes"
                    min="0"
                    className={`form-control ${editErrors.duration_minutes ? "is-invalid" : ""}`}
                    value={editForm.duration_minutes}
                    onChange={handleEditChange}
                  />
                  {editErrors.duration_minutes && (
                    <div className="invalid-feedback">{editErrors.duration_minutes}</div>
                  )}
                </div>
                <div className="text-muted small">
                  The video file itself doesn't change here — only the title and price, which will
                  also be re-synced to the Student App's copy.
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" data-bs-dismiss="modal">
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      <div className="modal fade" id="courseVideoDeleteModal" tabIndex="-1" ref={deleteModalRef}>
        <div className="modal-dialog">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">Delete Course Video</h5>
              <button type="button" className="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div className="modal-body">
              Are you sure? This permanently removes the video from both our bucket and the Student
              App's bucket — students will no longer be able to purchase or watch it.
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" data-bs-dismiss="modal">
                Cancel
              </button>
              <button type="button" className="btn btn-danger" onClick={handleDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CourseVideoDelivery;
