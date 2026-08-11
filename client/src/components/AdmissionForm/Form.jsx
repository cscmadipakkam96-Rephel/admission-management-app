import { useState } from "react";
import { FiSend } from "react-icons/fi";
import API from "../../api/api";
import "./Form.css";

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

const REQUIRED_FIELDS = [
  "course_name",
  "session",
  "applicant_name",
  "father_husband_name",
  "guardian_occupation",
  "date_of_birth",
  "age",
  "sex",
  "educational_qualification",
  "religion",
  "community",
  "occupation",
  "aadhar_no",
  "address",
  "mobile_no",
  "email",
];

const initialState = {
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
  scheme: "",
  timings: "",
};

function Form() {
  const [formData, setFormData] = useState(initialState);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    let cleanValue = value;
    let liveError = null;

    if (NAME_ONLY_FIELDS.includes(name)) {
      cleanValue = value.replace(NAME_PATTERN, "");
    } else if (DIGIT_ONLY_FIELDS.includes(name)) {
      cleanValue = value.replace(DIGIT_PATTERN, "");
      const maxLen = DIGIT_LENGTHS[name];
      if (cleanValue.length > maxLen) {
        liveError = `${FIELD_LABELS[name]} cannot exceed ${maxLen} digits.`;
      }
    }

    setFormData((prev) => ({
      ...prev,
      [name]: cleanValue,
      ...(name === "date_of_birth" ? { age: calculateAge(cleanValue) } : {}),
    }));
    setErrors((prev) => {
      const next = { ...prev };
      if (liveError) {
        next[name] = liveError;
      } else {
        delete next[name];
      }
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
      nextErrors.company_name = "Company Name is required since Occupation is Employed.";
    }

    return nextErrors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const nextErrors = validate();
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});

    setSubmitting(true);
    try {
      const response = await API.post("/admissions", formData);
      alert(response.data.message || "Admission submitted successfully");
      setFormData(initialState);
    } catch (error) {
      const field = error.response?.data?.field;
      const message =
        error.response?.data?.message ||
        "Something went wrong. Please try again.";

      if (field) {
        setErrors((prev) => ({ ...prev, [field]: message }));
      } else {
        alert(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="admission-form" onSubmit={handleSubmit} noValidate>
      <h2>Application for Admission to the Computer Programming Course</h2>

      <div className="row">
        <div className="field">
          <label>Course Name</label>
          <input
            type="text"
            name="course_name"
            className={errors.course_name ? "input-error" : ""}
            value={formData.course_name}
            onChange={handleChange}
          />
          {errors.course_name && (
            <span className="error-text">{errors.course_name}</span>
          )}
        </div>
        <div className="field">
          <label>Session</label>
          <input
            type="text"
            name="session"
            className={errors.session ? "input-error" : ""}
            value={formData.session}
            onChange={handleChange}
          />
          {errors.session && (
            <span className="error-text">{errors.session}</span>
          )}
        </div>
      </div>

      <div className="field">
        <label>Initial</label>
        <input
          type="text"
          name="initial"
          className={errors.initial ? "input-error" : ""}
          value={formData.initial}
          onChange={handleChange}
        />
        {errors.initial && (
          <span className="error-text">{errors.initial}</span>
        )}
      </div>

      <div className="field">
        <label>Name Mr. / Mrs. / Ms.</label>
        <input
          type="text"
          name="applicant_name"
          className={errors.applicant_name ? "input-error" : ""}
          value={formData.applicant_name}
          onChange={handleChange}
        />
        {errors.applicant_name && (
          <span className="error-text">{errors.applicant_name}</span>
        )}
      </div>

      <div className="field">
        <label>Father Initial</label>
        <input
          type="text"
          name="father_initial"
          className={errors.father_initial ? "input-error" : ""}
          value={formData.father_initial}
          onChange={handleChange}
        />
        {errors.father_initial && (
          <span className="error-text">{errors.father_initial}</span>
        )}
      </div>

      <div className="field">
        <label>Father's / Husband's Name</label>
        <input
          type="text"
          name="father_husband_name"
          className={errors.father_husband_name ? "input-error" : ""}
          value={formData.father_husband_name}
          onChange={handleChange}
        />
        {errors.father_husband_name && (
          <span className="error-text">{errors.father_husband_name}</span>
        )}
      </div>

      <div className="field">
        <label>Occupation of Father / Guardian</label>
        <input
          type="text"
          name="guardian_occupation"
          className={errors.guardian_occupation ? "input-error" : ""}
          value={formData.guardian_occupation}
          onChange={handleChange}
        />
        {errors.guardian_occupation && (
          <span className="error-text">{errors.guardian_occupation}</span>
        )}
      </div>

      <div className="row">
        <div className="field">
          <label>Date of Birth</label>
          <input
            type="date"
            name="date_of_birth"
            className={errors.date_of_birth ? "input-error" : ""}
            value={formData.date_of_birth}
            onChange={handleChange}
          />
          {errors.date_of_birth && (
            <span className="error-text">{errors.date_of_birth}</span>
          )}
        </div>
        <div className="field">
          <label>Age</label>
          <input
            type="number"
            name="age"
            className={errors.age ? "input-error" : ""}
            value={formData.age}
            onChange={handleChange}
          />
          {errors.age && <span className="error-text">{errors.age}</span>}
        </div>
        <div className="field">
          <label>Sex</label>
          <div className="options">
            <label className="option">
              <input
                type="radio"
                name="sex"
                value="M"
                checked={formData.sex === "M"}
                onChange={handleChange}
              />
              M
            </label>
            <label className="option">
              <input
                type="radio"
                name="sex"
                value="F"
                checked={formData.sex === "F"}
                onChange={handleChange}
              />
              F
            </label>
          </div>
          {errors.sex && <span className="error-text">{errors.sex}</span>}
        </div>
      </div>

      <div className="field">
        <label>Educational Qualification</label>
        <input
          type="text"
          name="educational_qualification"
          className={errors.educational_qualification ? "input-error" : ""}
          value={formData.educational_qualification}
          onChange={handleChange}
        />
        {errors.educational_qualification && (
          <span className="error-text">
            {errors.educational_qualification}
          </span>
        )}
      </div>

      <div className="field">
        <label>Religion</label>
        <div className="options">
          {["Hindu", "Christian", "Muslim", "Others"].map((item) => (
            <label className="option" key={item}>
              <input
                type="radio"
                name="religion"
                value={item}
                checked={formData.religion === item}
                onChange={handleChange}
              />
              {item}
            </label>
          ))}
        </div>
        {errors.religion && (
          <span className="error-text">{errors.religion}</span>
        )}
      </div>

      <div className="field">
        <label>Community</label>
        <div className="options">
          {["OC", "BC", "MBC", "ST/SC"].map((item) => (
            <label className="option" key={item}>
              <input
                type="radio"
                name="community"
                value={item}
                checked={formData.community === item}
                onChange={handleChange}
              />
              {item}
            </label>
          ))}
        </div>
        {errors.community && (
          <span className="error-text">{errors.community}</span>
        )}
      </div>

      <div className="field">
        <label>Occupation</label>
        <div className="options">
          {["Student", "House Wife", "Employed", "Un-employed", "Business"].map(
            (item) => (
              <label className="option" key={item}>
                <input
                  type="radio"
                  name="occupation"
                  value={item}
                  checked={formData.occupation === item}
                  onChange={handleChange}
                />
                {item}
              </label>
            )
          )}
        </div>
        {errors.occupation && (
          <span className="error-text">{errors.occupation}</span>
        )}
      </div>

      <div className="field">
        <label>Aadhar Card No. (Xerox Copy)</label>
        <input
          type="text"
          name="aadhar_no"
          inputMode="numeric"
          className={errors.aadhar_no ? "input-error" : ""}
          value={formData.aadhar_no}
          onChange={handleChange}
        />
        {errors.aadhar_no && (
          <span className="error-text">{errors.aadhar_no}</span>
        )}
      </div>

      <div className="field">
        <label>If Employed, Company Name</label>
        <input
          type="text"
          name="company_name"
          className={errors.company_name ? "input-error" : ""}
          value={formData.company_name}
          onChange={handleChange}
        />
        {errors.company_name && (
          <span className="error-text">{errors.company_name}</span>
        )}
      </div>

      <div className="field">
        <label>Address for Communication</label>
        <textarea
          name="address"
          className={errors.address ? "input-error" : ""}
          value={formData.address}
          onChange={handleChange}
        ></textarea>
        {errors.address && (
          <span className="error-text">{errors.address}</span>
        )}
      </div>

      <div className="row">
        <div className="field">
          <label>Telephone No</label>
          <input
            type="text"
            name="telephone_no"
            inputMode="numeric"
            className={errors.telephone_no ? "input-error" : ""}
            value={formData.telephone_no}
            onChange={handleChange}
          />
          {errors.telephone_no && (
            <span className="error-text">{errors.telephone_no}</span>
          )}
        </div>
        <div className="field">
          <label>Mobile No</label>
          <input
            type="text"
            name="mobile_no"
            inputMode="numeric"
            className={errors.mobile_no ? "input-error" : ""}
            value={formData.mobile_no}
            onChange={handleChange}
          />
          {errors.mobile_no && (
            <span className="error-text">{errors.mobile_no}</span>
          )}
        </div>
        <div className="field">
          <label>E-mail ID</label>
          <input
            type="email"
            name="email"
            className={errors.email ? "input-error" : ""}
            value={formData.email}
            onChange={handleChange}
          />
          {errors.email && (
            <span className="error-text">{errors.email}</span>
          )}
        </div>
      </div>

      <p className="declaration">
        I hereby agree that, in case I am admitted, I shall pay in full the
        fees prescribed in the latest prospectus and any fee paid by me is
        non-refundable.
      </p>

      <div className="office-use">
        <span className="office-use-badge">Office Use Only</span>

        <div className="row">
          <div className="field">
            <label>Total Fee (Rs.)</label>
            <input
              type="number"
              name="total_fee"
              value={formData.total_fee}
              onChange={handleChange}
            />
          </div>
          <div className="field">
            <label>First Installment Amount (Rs.)</label>
            <input
              type="number"
              name="first_installment_amount"
              value={formData.first_installment_amount}
              onChange={handleChange}
            />
          </div>
        </div>

        <div className="row">
          <div className="field">
            <label>Bill No</label>
            <input
              type="text"
              name="bill_no"
              value={formData.bill_no}
              onChange={handleChange}
            />
          </div>
          <div className="field">
            <label>Scheme</label>
            <input
              type="text"
              name="scheme"
              value={formData.scheme}
              onChange={handleChange}
            />
          </div>
          <div className="field">
            <label>Timings</label>
            <input
              type="text"
              name="timings"
              placeholder="e.g. 9:00 AM - 11:00 AM"
              value={formData.timings}
              onChange={handleChange}
            />
          </div>
        </div>
      </div>

      <button type="submit" disabled={submitting}>
        <FiSend /> {submitting ? "Submitting..." : "Submit"}
      </button>
    </form>
  );
}

export default Form;
