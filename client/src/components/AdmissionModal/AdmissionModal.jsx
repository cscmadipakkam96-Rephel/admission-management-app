import { useRef, useState, useEffect } from "react";
import { Modal } from "bootstrap";
import API from "../../api/api";
import {
  hasRequiredStudentAppFields,
  registerToStudentApp,
  checkStudentAppRegistered,
  deleteFromStudentApp,
} from "../../utils/studentAppSync";

const FIELD_LABELS = {
  course_name: "Course Name",
  session: "Session",
  applicant_name: "Name",
  initial: "Initial",
  father_husband_name: "Father's / Husband's Name",
  father_initial: "Father Initial",
  guardian_occupation: "Occupation of Father / Guardian",
  date_of_birth: "Date of Birth",
  age: "Age",
  sex: "Sex",
  educational_qualification: "Educational Qualification",
  religion: "Religion",
  community: "Community",
  occupation: "Occupation",
  aadhar_no: "Aadhar Card No",
  address: "Address",
  telephone_no: "Telephone No",
  mobile_no: "Mobile No",
  email: "Email ID",
  company_name: "Company Name",
};

const REQUIRED_FIELDS = [];

const NAME_ONLY_FIELDS = [
  "applicant_name",
  "initial",
  "father_husband_name",
  "father_initial",
];
const NAME_PATTERN = /[^a-zA-Z.'\s]/g;

const DIGIT_ONLY_FIELDS = ["aadhar_no", "telephone_no", "mobile_no"];
const DIGIT_PATTERN = /\D/g;
const DIGIT_LENGTHS = { aadhar_no: 12, telephone_no: 10, mobile_no: 10 };

// The one canonical shape the Admission Analytics timing chart can merge
// reliably: "11:00am-12:00pm" — hour:minute + am/pm on both sides, no space
// around the "-". Case-insensitive so "AM"/"PM"/"am"/"pm" all work.
const TIMINGS_PATTERN =
  /^(0?[1-9]|1[0-2]):[0-5]\d\s?(am|pm)-(0?[1-9]|1[0-2]):[0-5]\d\s?(am|pm)$/i;

const calculateAge = (dob) => {
  if (!dob) return "";
  const birthDate = new Date(dob);
  if (Number.isNaN(birthDate.getTime())) return "";
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age -= 1;
  }
  return age >= 0 ? age.toString() : "";
};

const QUALIFICATION_OPTIONS = [
  "10th & Below",
  "12th",
  "Diploma",
  "UG",
  "PG",
  "Other",
];

const initialState = {
  submitted_on: "",
  course_name: "",
  session: "",
  applicant_name: "",
  initial: "",
  father_husband_name: "",
  father_initial: "",
  guardian_occupation: "",
  date_of_birth: "",
  age: "",
  sex: "",
  educational_qualification: "",
  religion: "",
  community: "",
  occupation: "",
  aadhar_no: "",
  company_name: "",
  address: "",
  telephone_no: "",
  mobile_no: "",
  email: "",
  total_fee: "",
  first_installment_amount: "",
  bill_no: "",
  comn_enrol_no: "",
  admission_date: "",
  scheme: "",
  timings: "",
};

function AdmissionModal({ editingRecord, onSuccess }) {
  const modalRef = useRef(null);
  const [formData, setFormData] = useState(initialState);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);
  const [courseOptions, setCourseOptions] = useState([]);
  const [isPublished, setIsPublished] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [checkingPublishStatus, setCheckingPublishStatus] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const fetchCourses = async () => {
      try {
        const response = await API.get("/courses?active=true");
        const names = (response.data.data || response.data)
          .map((c) => c.course_name)
          .filter(Boolean);
        setCourseOptions([...new Set(names)]);
      } catch {
        setCourseOptions([]);
      }
    };
    fetchCourses();
  }, []);

  const isEditMode = Boolean(editingRecord && editingRecord.id);

  useEffect(() => {
    if (editingRecord) {
      const populated = {};
      Object.keys(initialState).forEach((key) => {
        populated[key] = editingRecord[key] ?? "";
      });
      populated.submitted_on = editingRecord.created_at
        ? editingRecord.created_at.slice(0, 10)
        : "";
      setFormData(populated);
    } else {
      setFormData(initialState);
    }
    setErrors({});
    // Optimistic guess from our own (possibly stale) flag, corrected below
    // by the live check — our flag only gets set going forward from the
    // Publish/Remove actions themselves, so it can't be trusted for
    // students published before this tracking existed.
    setIsPublished(Boolean(editingRecord?.published_to_student_app));
  }, [editingRecord]);

  // Source of truth is the Flutter app's own DB, not our local flag — asks
  // it directly whenever the modal opens for a given student, so a student
  // registered there before we started tracking this locally still shows
  // correctly as published.
  useEffect(() => {
    const comnEnrolNo = editingRecord?.comn_enrol_no;
    if (!comnEnrolNo) return;
    let cancelled = false;
    setCheckingPublishStatus(true);
    checkStudentAppRegistered(comnEnrolNo)
      .then((exists) => {
        if (!cancelled) setIsPublished(exists);
      })
      .catch((error) => {
        console.error("Couldn't check Student App publish status:", error);
        // Leave the optimistic guess in place — don't block the modal on
        // this backend being unreachable.
      })
      .finally(() => {
        if (!cancelled) setCheckingPublishStatus(false);
      });
    return () => {
      cancelled = true;
    };
  }, [editingRecord]);

  useEffect(() => {
    const modalEl = modalRef.current;
    const forceCleanup = () => {
      document.querySelectorAll(".modal-backdrop").forEach((el) => el.remove());
      document.body.classList.remove("modal-open");
      document.body.style.removeProperty("overflow");
      document.body.style.removeProperty("padding-right");
    };
    modalEl.addEventListener("hidden.bs.modal", forceCleanup);
    return () => modalEl.removeEventListener("hidden.bs.modal", forceCleanup);
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    let cleanValue = value;

    if (NAME_ONLY_FIELDS.includes(name)) {
      cleanValue = value.replace(NAME_PATTERN, "");
    } else if (DIGIT_ONLY_FIELDS.includes(name)) {
      const maxLen = DIGIT_LENGTHS[name];
      cleanValue = value.replace(DIGIT_PATTERN, "").slice(0, maxLen);
    }

    setFormData((prev) => ({
      ...prev,
      [name]: cleanValue,
      // As soon as Date of Birth is picked, auto-fill Age — still editable
      // afterward if it needs a manual correction.
      ...(name === "date_of_birth" ? { age: calculateAge(cleanValue) } : {}),
    }));
    setErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const validate = () => {
    const nextErrors = {};

    REQUIRED_FIELDS.forEach((field) => {
      if (formData[field].toString().trim() === "") {
        nextErrors[field] = `${FIELD_LABELS[field]} is required.`;
      }
    });

    DIGIT_ONLY_FIELDS.forEach((field) => {
      const value = formData[field];
      const requiredLength = DIGIT_LENGTHS[field];
      if (value && value.length !== requiredLength) {
        nextErrors[field] = `${FIELD_LABELS[field]} must be exactly ${requiredLength} digits.`;
      }
    });

    if (
      formData.occupation === "Employed" &&
      formData.company_name.trim() === ""
    ) {
      nextErrors.company_name =
        "Company Name is required since Occupation is Employed.";
    }

    if (formData.timings.trim() && !TIMINGS_PATTERN.test(formData.timings.trim())) {
      nextErrors.timings = "Format must be like 11:00am-12:00pm.";
    }

    return nextErrors;
  };

  const closeModal = () => {
    const instance = Modal.getOrCreateInstance(modalRef.current);
    instance.hide();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const nextErrors = validate();
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});

    const { submitted_on, ...restFormData } = formData;
    const payload = {
      ...restFormData,
      ...(submitted_on ? { created_at: submitted_on } : {}),
    };

    setSubmitting(true);
    try {
      const response = isEditMode
        ? await API.put(`/admissions/${editingRecord.id}`, payload)
        : await API.post("/admissions", payload);
      const successMessage =
        response.data.message ||
        (isEditMode
          ? "Admission updated successfully"
          : "Admission submitted successfully");

      // Auto-sync to the Student App right after a successful save — no
      // separate "Publish" step anymore. Silently skipped when required
      // fields (Enrollment No / Name / E-mail / DOB) aren't all filled in
      // yet; it'll sync on a later save once they are. Never blocks or
      // fails the admission save itself.
      const savedAdmission = response.data.data || { id: editingRecord?.id, ...payload };
      if (hasRequiredStudentAppFields(savedAdmission)) {
        try {
          // Enrollment No changed on an already-registered student — the
          // Flutter app upserts by comn_enrol_no, so registering under the
          // new number alone would leave the old number's row behind as an
          // orphan (still loggable-into) instead of a clean rename. Clear
          // it out first.
          const oldComnEnrolNo = editingRecord?.comn_enrol_no?.toString().trim();
          const newComnEnrolNo = savedAdmission.comn_enrol_no?.toString().trim();
          if (isEditMode && oldComnEnrolNo && oldComnEnrolNo !== newComnEnrolNo) {
            try {
              await deleteFromStudentApp(oldComnEnrolNo);
            } catch (renameError) {
              console.error("Couldn't clear old Enrollment No before rename:", renameError);
            }
          }
          await registerToStudentApp(savedAdmission);
          if (savedAdmission.id) {
            await API.put(`/admissions/${savedAdmission.id}`, {
              published_to_student_app: true,
            });
          }
        } catch (syncError) {
          console.error("Student App auto-sync failed:", syncError);
        }
      }

      setFormData(initialState);
      closeModal();
      if (onSuccess) onSuccess();
      setToast({ variant: "success", message: successMessage });
    } catch (error) {
      const field = error.response?.data?.field;
      const message =
        error.response?.data?.message ||
        "Something went wrong. Please try again.";

      if (field) {
        setErrors((prev) => ({ ...prev, [field]: message }));
      } else {
        setToast({ variant: "danger", message });
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Manual retry for the same auto-sync handleSubmit does — for when it's
  // missed (e.g. the Flutter backend wasn't running at save time) and the
  // admin wants to try again without re-saving the whole form.
  const handleSyncNow = async () => {
    if (!hasRequiredStudentAppFields(formData)) {
      setToast({
        variant: "danger",
        message: "Enrollment Number, Name, E-mail ID, and Date of Birth are all required to register.",
      });
      return;
    }
    setSyncing(true);
    try {
      await registerToStudentApp(formData);
      await API.put(`/admissions/${editingRecord.id}`, {
        published_to_student_app: true,
      });
      setToast({ variant: "success", message: "Registered to Student App." });
      setIsPublished(true);
    } catch (error) {
      console.error("Student App sync failed:", error);
      setToast({
        variant: "danger",
        message: error.message || "Couldn't reach the Student App backend.",
      });
    } finally {
      setSyncing(false);
    }
  };

  // Deletes this student's row from the Flutter app's register table.
  // Attendance history there is preserved by that app's own delete
  // handler — this only removes the login credentials.
  const handleRemovePublish = async () => {
    if (!formData.comn_enrol_no.trim()) {
      setToast({ variant: "danger", message: "No Enrollment Number to remove." });
      return;
    }

    setRemoving(true);
    try {
      await deleteFromStudentApp(formData.comn_enrol_no.trim());
      try {
        await API.put(`/admissions/${editingRecord.id}`, {
          published_to_student_app: false,
        });
      } catch (flagError) {
        console.error("Failed to record publish status locally:", flagError);
      }
      setToast({ variant: "success", message: "Removed from Student App." });
      setIsPublished(false);
      if (onSuccess) onSuccess();
    } catch (error) {
      console.error("Remove from Student App failed:", error);
      setToast({
        variant: "danger",
        message: error.message || "Couldn't reach the Student App backend.",
      });
    } finally {
      setRemoving(false);
    }
  };

  return (
    <>
      {toast && (
        <div
          className="toast-container position-fixed top-0 end-0 p-3"
          style={{ zIndex: 1080 }}
        >
          <div
            className={`toast show text-white bg-${toast.variant}`}
            role="alert"
          >
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
      <div
        className="modal fade"
        id="addAdmissionModal"
        tabIndex="-1"
        ref={modalRef}
      >
      <div className="modal-dialog modal-lg modal-dialog-scrollable">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">
              {isEditMode ? "Edit Admission" : "Add Admission"}
            </h5>
            <button
              type="button"
              className="btn-close"
              data-bs-dismiss="modal"
            ></button>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="modal-body" style={{ maxHeight: "70vh", overflowY: "auto" }}>
              <div className="row g-3">
                <div className="col-md-6">
                  <label className="form-label">Submitted On (Date)</label>
                  <input
                    type="date"
                    name="submitted_on"
                    className="form-control"
                    value={formData.submitted_on}
                    onChange={handleChange}
                  />
                  <div className="form-text">
                    Leave blank to use today's date. Set a custom date for
                    testing analytics.
                  </div>
                </div>
                <div className="col-md-6">
                  <label className="form-label">Course Name</label>
                  <select
                    name="course_name"
                    className={`form-select ${errors.course_name ? "is-invalid" : ""}`}
                    value={formData.course_name}
                    onChange={handleChange}
                  >
                    <option value="">-- Select Course --</option>
                    {formData.course_name &&
                      !courseOptions.includes(formData.course_name) && (
                        <option value={formData.course_name}>
                          {formData.course_name}
                        </option>
                      )}
                    {courseOptions.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                  {errors.course_name && (
                    <div className="invalid-feedback">{errors.course_name}</div>
                  )}
                </div>
                <div className="col-md-6">
                  <label className="form-label">Session</label>
                  <input
                    type="text"
                    name="session"
                    className={`form-control ${errors.session ? "is-invalid" : ""}`}
                    value={formData.session}
                    onChange={handleChange}
                  />
                  {errors.session && (
                    <div className="invalid-feedback">{errors.session}</div>
                  )}
                </div>

                <div className="w-100"></div>
                <div className="col-md-3">
                  <label className="form-label">Initial</label>
                  <input
                    type="text"
                    name="initial"
                    className={`form-control ${errors.initial ? "is-invalid" : ""}`}
                    value={formData.initial}
                    onChange={handleChange}
                  />
                  {errors.initial && (
                    <div className="invalid-feedback">{errors.initial}</div>
                  )}
                </div>
                <div className="col-md-6">
                  <label className="form-label">Name Mr. / Mrs. / Ms.</label>
                  <input
                    type="text"
                    name="applicant_name"
                    className={`form-control ${errors.applicant_name ? "is-invalid" : ""}`}
                    value={formData.applicant_name}
                    onChange={handleChange}
                  />
                  {errors.applicant_name && (
                    <div className="invalid-feedback">
                      {errors.applicant_name}
                    </div>
                  )}
                </div>

                <div className="w-100"></div>
                <div className="col-md-3">
                  <label className="form-label">Father Initial</label>
                  <input
                    type="text"
                    name="father_initial"
                    className={`form-control ${errors.father_initial ? "is-invalid" : ""}`}
                    value={formData.father_initial}
                    onChange={handleChange}
                  />
                  {errors.father_initial && (
                    <div className="invalid-feedback">
                      {errors.father_initial}
                    </div>
                  )}
                </div>
                <div className="col-md-6">
                  <label className="form-label">
                    Father's / Husband's Name
                  </label>
                  <input
                    type="text"
                    name="father_husband_name"
                    className={`form-control ${errors.father_husband_name ? "is-invalid" : ""}`}
                    value={formData.father_husband_name}
                    onChange={handleChange}
                  />
                  {errors.father_husband_name && (
                    <div className="invalid-feedback">
                      {errors.father_husband_name}
                    </div>
                  )}
                </div>

                <div className="col-md-6">
                  <label className="form-label">
                    Occupation of Father / Guardian
                  </label>
                  <input
                    type="text"
                    name="guardian_occupation"
                    className={`form-control ${errors.guardian_occupation ? "is-invalid" : ""}`}
                    value={formData.guardian_occupation}
                    onChange={handleChange}
                  />
                  {errors.guardian_occupation && (
                    <div className="invalid-feedback">
                      {errors.guardian_occupation}
                    </div>
                  )}
                </div>
                <div className="col-md-3">
                  <label className="form-label">Date of Birth</label>
                  <input
                    type="date"
                    name="date_of_birth"
                    className={`form-control ${errors.date_of_birth ? "is-invalid" : ""}`}
                    value={formData.date_of_birth}
                    onChange={handleChange}
                  />
                  {errors.date_of_birth && (
                    <div className="invalid-feedback">
                      {errors.date_of_birth}
                    </div>
                  )}
                </div>
                <div className="col-md-3">
                  <label className="form-label">Age</label>
                  <input
                    type="number"
                    name="age"
                    className={`form-control ${errors.age ? "is-invalid" : ""}`}
                    value={formData.age}
                    onChange={handleChange}
                  />
                  {errors.age && (
                    <div className="invalid-feedback">{errors.age}</div>
                  )}
                </div>

                <div className="col-md-6">
                  <label className="form-label d-block">Sex</label>
                  {["M", "F"].map((opt) => (
                    <div className="form-check form-check-inline" key={opt}>
                      <input
                        className="form-check-input"
                        type="radio"
                        name="sex"
                        value={opt}
                        checked={formData.sex === opt}
                        onChange={handleChange}
                      />
                      <label className="form-check-label">{opt}</label>
                    </div>
                  ))}
                  {errors.sex && (
                    <div className="text-danger small mt-1">{errors.sex}</div>
                  )}
                </div>
                <div className="col-md-6">
                  <label className="form-label">
                    Educational Qualification
                  </label>
                  <select
                    name="educational_qualification"
                    className={`form-select ${errors.educational_qualification ? "is-invalid" : ""}`}
                    value={formData.educational_qualification}
                    onChange={handleChange}
                  >
                    <option value="">-- Select --</option>
                    {QUALIFICATION_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                  {errors.educational_qualification && (
                    <div className="invalid-feedback">
                      {errors.educational_qualification}
                    </div>
                  )}
                </div>

                <div className="col-md-4">
                  <label className="form-label d-block">Religion</label>
                  {["Hindu", "Christian", "Muslim", "Others"].map((opt) => (
                    <div className="form-check form-check-inline" key={opt}>
                      <input
                        className="form-check-input"
                        type="radio"
                        name="religion"
                        value={opt}
                        checked={formData.religion === opt}
                        onChange={handleChange}
                      />
                      <label className="form-check-label">{opt}</label>
                    </div>
                  ))}
                  {errors.religion && (
                    <div className="text-danger small mt-1">
                      {errors.religion}
                    </div>
                  )}
                </div>
                <div className="col-md-4">
                  <label className="form-label d-block">Community</label>
                  {["OC", "BC", "MBC", "ST/SC"].map((opt) => (
                    <div className="form-check form-check-inline" key={opt}>
                      <input
                        className="form-check-input"
                        type="radio"
                        name="community"
                        value={opt}
                        checked={formData.community === opt}
                        onChange={handleChange}
                      />
                      <label className="form-check-label">{opt}</label>
                    </div>
                  ))}
                  {errors.community && (
                    <div className="text-danger small mt-1">
                      {errors.community}
                    </div>
                  )}
                </div>
                <div className="col-md-4">
                  <label className="form-label d-block">Occupation</label>
                  {[
                    "Student",
                    "House Wife",
                    "Employed",
                    "Un-employed",
                    "Business",
                  ].map((opt) => (
                    <div className="form-check form-check-inline" key={opt}>
                      <input
                        className="form-check-input"
                        type="radio"
                        name="occupation"
                        value={opt}
                        checked={formData.occupation === opt}
                        onChange={handleChange}
                      />
                      <label className="form-check-label">{opt}</label>
                    </div>
                  ))}
                  {errors.occupation && (
                    <div className="text-danger small mt-1">
                      {errors.occupation}
                    </div>
                  )}
                </div>

                <div className="col-md-6">
                  <label className="form-label">
                    Aadhar Card No (12 digits)
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={12}
                    name="aadhar_no"
                    className={`form-control ${errors.aadhar_no ? "is-invalid" : ""}`}
                    value={formData.aadhar_no}
                    onChange={handleChange}
                  />
                  {errors.aadhar_no && (
                    <div className="invalid-feedback">{errors.aadhar_no}</div>
                  )}
                </div>
                <div className="col-md-6">
                  <label className="form-label">
                    If Employed, Company Name
                  </label>
                  <input
                    type="text"
                    name="company_name"
                    className={`form-control ${errors.company_name ? "is-invalid" : ""}`}
                    value={formData.company_name}
                    onChange={handleChange}
                  />
                  {errors.company_name && (
                    <div className="invalid-feedback">
                      {errors.company_name}
                    </div>
                  )}
                </div>

                <div className="col-12">
                  <label className="form-label">
                    Address for Communication
                  </label>
                  <textarea
                    name="address"
                    className={`form-control ${errors.address ? "is-invalid" : ""}`}
                    value={formData.address}
                    onChange={handleChange}
                    rows={2}
                  ></textarea>
                  {errors.address && (
                    <div className="invalid-feedback">{errors.address}</div>
                  )}
                </div>

                <div className="col-md-3">
                  <label className="form-label">Telephone No</label>
                  <input
                    type="text"
                    inputMode="tel"
                    maxLength={10}
                    name="telephone_no"
                    className={`form-control ${errors.telephone_no ? "is-invalid" : ""}`}
                    value={formData.telephone_no}
                    onChange={handleChange}
                  />
                  {errors.telephone_no && (
                    <div className="invalid-feedback">{errors.telephone_no}</div>
                  )}
                </div>
                <div className="col-md-3">
                  <label className="form-label">Mobile No</label>
                  <input
                    type="text"
                    inputMode="tel"
                    maxLength={10}
                    name="mobile_no"
                    className={`form-control ${errors.mobile_no ? "is-invalid" : ""}`}
                    value={formData.mobile_no}
                    onChange={handleChange}
                  />
                  {errors.mobile_no && (
                    <div className="invalid-feedback">{errors.mobile_no}</div>
                  )}
                </div>
                <div className="col-md-6">
                  <label className="form-label">E-mail ID</label>
                  <input
                    type="email"
                    name="email"
                    className={`form-control ${errors.email ? "is-invalid" : ""}`}
                    value={formData.email}
                    onChange={handleChange}
                  />
                  {errors.email && (
                    <div className="invalid-feedback">{errors.email}</div>
                  )}
                </div>

                <div className="col-12">
                  <div className="border rounded p-3 bg-light">
                    <span className="badge bg-secondary mb-2">
                      Office Use Only
                    </span>
                    <div className="row g-3">
                      <div className="col-md-6">
                        <label className="form-label">Total Fee (Rs.)</label>
                        <input
                          type="number"
                          name="total_fee"
                          className="form-control"
                          value={formData.total_fee}
                          onChange={handleChange}
                        />
                      </div>
                      <div className="col-md-6">
                        <label className="form-label">
                          First Installment Amount (Rs.)
                        </label>
                        <input
                          type="number"
                          name="first_installment_amount"
                          className="form-control"
                          value={formData.first_installment_amount}
                          onChange={handleChange}
                        />
                      </div>
                      <div className="col-md-4">
                        <label className="form-label">Bill No</label>
                        <input
                          type="text"
                          name="bill_no"
                          className="form-control"
                          value={formData.bill_no}
                          onChange={handleChange}
                        />
                      </div>
                      <div className="col-md-4">
                        <label className="form-label">Enrollment Number</label>
                        <input
                          type="text"
                          name="comn_enrol_no"
                          className="form-control"
                          value={formData.comn_enrol_no}
                          onChange={handleChange}
                        />
                      </div>
                      <div className="col-md-4">
                        <label className="form-label">Admission Date</label>
                        <input
                          type="date"
                          name="admission_date"
                          className="form-control"
                          value={formData.admission_date}
                          onChange={handleChange}
                        />
                      </div>
                      <div className="col-md-4">
                        <label className="form-label">Scheme</label>
                        <input
                          type="text"
                          name="scheme"
                          className="form-control"
                          value={formData.scheme}
                          onChange={handleChange}
                        />
                      </div>
                      <div className="col-md-4">
                        <label className="form-label">Timings</label>
                        <input
                          type="text"
                          name="timings"
                          className={`form-control ${errors.timings ? "is-invalid" : ""}`}
                          placeholder="e.g. 11:00am-12:00pm"
                          value={formData.timings}
                          onChange={handleChange}
                        />
                        {errors.timings && (
                          <div className="invalid-feedback">{errors.timings}</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {isEditMode && (
                  <div className="col-12">
                    <div className="border rounded p-3 bg-light">
                      <div className="d-flex align-items-center gap-2 mb-2">
                        <span className="badge bg-secondary">Student App</span>
                        {checkingPublishStatus && (
                          <span className="text-muted small">Checking...</span>
                        )}
                      </div>

                      {isPublished ? (
                        <div className="d-flex align-items-center gap-2">
                          <span className="badge bg-success">Published</span>
                          <button
                            type="button"
                            className="btn btn-outline-danger btn-sm"
                            onClick={handleRemovePublish}
                            disabled={removing}
                          >
                            {removing ? "Removing..." : "Remove from Student App"}
                          </button>
                        </div>
                      ) : hasRequiredStudentAppFields(formData) ? (
                        <div className="d-flex align-items-center gap-2">
                          <span className="text-muted small">
                            Not registered yet — this saves and registers
                            automatically, or:
                          </span>
                          <button
                            type="button"
                            className="btn btn-outline-primary btn-sm"
                            onClick={handleSyncNow}
                            disabled={syncing}
                          >
                            {syncing ? "Registering..." : "Register now"}
                          </button>
                        </div>
                      ) : (
                        <div className="text-muted small">
                          Fill in Enrollment Number, Name, E-mail ID, and
                          Date of Birth, then save — this student will
                          register to the Student App automatically.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                data-bs-dismiss="modal"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={submitting}
              >
                {submitting
                  ? isEditMode
                    ? "Updating..."
                    : "Submitting..."
                  : isEditMode
                    ? "Update Admission"
                    : "Save Admission"}
              </button>
            </div>
          </form>
        </div>
      </div>
      </div>
    </>
  );
}

export default AdmissionModal;
