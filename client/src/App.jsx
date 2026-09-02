import { BrowserRouter, Routes, Route, NavLink, Outlet, useNavigate, useOutletContext } from "react-router-dom";
import { FiFileText, FiUsers, FiBookOpen, FiDollarSign, FiClipboard, FiLayers, FiCheckSquare, FiBook, FiUserCheck, FiCalendar, FiLogIn, FiTrendingUp, FiActivity, FiPhoneCall, FiStar, FiMessageCircle, FiVideo } from "react-icons/fi";
import Form from "./components/AdmissionForm/Form";
import List from "./components/AdmissionList/List";
import InactiveList from "./components/InactiveList/InactiveList";
import FeeHistory from "./components/FeeHistory/FeeHistory";
import FeeEntry from "./components/FeeEntry/FeeEntry";
import InformationSheetEntry from "./components/InformationSheet/InformationSheetEntry";
import InactiveInformationSheets from "./components/InformationSheet/InactiveInformationSheets";
import CourseManagement from "./components/CourseManagement/CourseManagement";
import InactiveCourses from "./components/CourseManagement/InactiveCourses";
import SubjectManagement from "./components/SubjectManagement/SubjectManagement";
import InactiveSubjects from "./components/SubjectManagement/InactiveSubjects";
import TeacherManagement from "./components/TeacherManagement/TeacherManagement";
import InactiveTeachers from "./components/TeacherManagement/InactiveTeachers";
import BatchManagement from "./components/BatchManagement/BatchManagement";
import ExpenseTracking from "./components/ExpenseTracking/ExpenseTracking";
import InactiveExpenses from "./components/ExpenseTracking/InactiveExpenses";
import StudentTracking from "./components/StudentTracking/StudentTracking";
import FollowUpManagement from "./components/FollowUpManagement/FollowUpManagement";
import WhatsAppSend from "./components/WhatsAppSend/WhatsAppSend";
import CourseVideoDelivery from "./components/CourseVideoDelivery/CourseVideoDelivery";
import StudentReview from "./components/StudentReview/StudentReview";
import OnlineClassJoin from "./components/OnlineClassJoin/OnlineClassJoin";
import AttendanceList from "./components/AttendanceList/AttendanceList";
import AttendanceScanner from "./components/AttendanceScanner/AttendanceScanner";
import AttendanceRegister from "./components/AttendanceRegister/AttendanceRegister";
import EntryAttendance from "./components/EntryAttendance/EntryAttendance";
import EntryAttendanceScanner from "./components/EntryAttendance/EntryAttendanceScanner";
import TeacherRegister from "./components/TeacherRegister/TeacherRegister";
import Detail from "./components/AdmissionDetail/Detail";
import AdminLogin from "./components/AdminAuth/AdminLogin";
import AdminRegister from "./components/AdminAuth/AdminRegister";
import ProtectedRoute from "./components/AdminAuth/ProtectedRoute";
import TeacherLogin from "./components/TeacherLogin/TeacherLogin";
import TeacherProtectedRoute from "./components/TeacherLogin/TeacherProtectedRoute";
import Landing from "./components/Landing/Landing";
import AdminProfileMenu from "./components/AdminAuth/AdminProfileMenu";
import API from "./api/api";
import "./App.css";

function AdminLayout() {
  const navigate = useNavigate();
  const adminInfo = useOutletContext();

  const handleLogout = async () => {
    try {
      await API.post("/admin-auth/logout");
    } catch {
      // Cookie clearing on the server is best-effort; still send them to
      // login either way since staying on an admin page would be worse.
    }
    navigate("/welcome", { replace: true });
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <FiBookOpen />
          <span>Course Admission</span>
        </div>
        <nav className="topbar-nav">
          <NavLink to="/" end>
            <FiUsers /> Admission List
          </NavLink>
          <NavLink to="/form">
            <FiFileText /> Admission Form
          </NavLink>
          <NavLink to="/fee-entry">
            <FiDollarSign /> Fee Entry
          </NavLink>
          <NavLink to="/expense-tracking">
            <FiTrendingUp /> Expense Tracking
          </NavLink>
          <NavLink to="/information-sheet">
            <FiClipboard /> Information Sheet
          </NavLink>
          <NavLink to="/courses">
            <FiLayers /> Course Management
          </NavLink>
          <NavLink to="/subjects">
            <FiBook /> Subject Management
          </NavLink>
          <NavLink to="/teachers">
            <FiUserCheck /> Teacher Management
          </NavLink>
          <NavLink to="/batches">
            <FiCalendar /> Batch Management
          </NavLink>
          <NavLink to="/student-tracking">
            <FiActivity /> Student Tracking
          </NavLink>
          <NavLink to="/follow-ups">
            <FiPhoneCall /> Follow-Up Management
          </NavLink>
          <NavLink to="/attendance">
            <FiCheckSquare /> Attendance
          </NavLink>
          <NavLink to="/entry-attendance">
            <FiLogIn /> Entry Attendance
          </NavLink>
          <NavLink to="/whatsapp-send">
            <FiMessageCircle /> WhatsApp
          </NavLink>
          <NavLink to="/course-videos">
            <FiVideo /> Course Videos
          </NavLink>
          <a href="/feedback" target="_blank" rel="noopener noreferrer">
            <FiStar /> Student Feedback
          </a>
        </nav>
        <div className="d-flex align-items-center gap-2 text-white flex-shrink-0">
          <AdminProfileMenu adminInfo={adminInfo} onLogout={handleLogout} />
        </div>
      </header>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/welcome" element={<Landing />} />
        <Route path="/feedback" element={<StudentReview />} />
        <Route path="/online-class/join/:token" element={<OnlineClassJoin />} />
        <Route
          path="/attendance/register/:slug"
          element={<AttendanceRegister />}
        />
        <Route path="/teacher-login" element={<TeacherLogin />} />
        <Route path="/teacher-login/:slug" element={<TeacherLogin />} />
        <Route element={<TeacherProtectedRoute />}>
          <Route path="/teacher/dashboard" element={<TeacherRegister />} />
        </Route>
        <Route path="/login" element={<AdminLogin />} />
        <Route path="/register" element={<AdminRegister />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AdminLayout />}>
            <Route path="/" element={<List />} />
            <Route path="/inactive" element={<InactiveList />} />
            <Route path="/form" element={<Form />} />
            <Route path="/fee-entry" element={<FeeEntry />} />
            <Route path="/expense-tracking" element={<ExpenseTracking />} />
            <Route
              path="/expense-tracking/inactive"
              element={<InactiveExpenses />}
            />
            <Route
              path="/information-sheet"
              element={<InformationSheetEntry />}
            />
            <Route
              path="/information-sheet/inactive"
              element={<InactiveInformationSheets />}
            />
            <Route path="/courses" element={<CourseManagement />} />
            <Route path="/courses/inactive" element={<InactiveCourses />} />
            <Route path="/subjects" element={<SubjectManagement />} />
            <Route path="/subjects/inactive" element={<InactiveSubjects />} />
            <Route path="/teachers" element={<TeacherManagement />} />
            <Route path="/teachers/inactive" element={<InactiveTeachers />} />
            <Route path="/batches" element={<BatchManagement />} />
            <Route path="/student-tracking" element={<StudentTracking />} />
            <Route path="/follow-ups" element={<FollowUpManagement />} />
            <Route path="/whatsapp-send" element={<WhatsAppSend />} />
            <Route path="/course-videos" element={<CourseVideoDelivery />} />
            <Route path="/attendance" element={<AttendanceList />} />
            <Route path="/attendance/scan" element={<AttendanceScanner />} />
            <Route path="/entry-attendance" element={<EntryAttendance />} />
            <Route path="/entry-attendance/scan" element={<EntryAttendanceScanner />} />
            <Route path="/admissions/:id" element={<FeeHistory />} />
            <Route path="/admissions/:id/details" element={<Detail />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
