# Hidden UI Sections

Tracks every UI section that has been commented out (never deleted) in the
codebase, in the order they were hidden. Each one can be found by searching
the file for its exact heading text — every hidden block is wrapped in a
`{/* <Section Name> — commented out, not deleted; re-enable if needed later. ... */}`
comment, so re-enabling it later is just removing that comment wrapper.

1) **My QR Code** — `client/src/components/TeacherRegister/TeacherRegister.jsx`
2) **My Weekly Batch Schedule** — `client/src/components/TeacherRegister/TeacherRegister.jsx`
3) **Sign in with Google** — `client/src/components/AdminAuth/AdminLogin.jsx`
4) **Mark Not Available Today** — `client/src/components/TeacherRegister/TeacherRegister.jsx`
5) **My Batches Today** — `client/src/components/TeacherRegister/TeacherRegister.jsx`
6) **My Courses — Syllabus** — `client/src/components/TeacherRegister/TeacherRegister.jsx`
