# School Admin Class Sections

Independent static app for school admins to sign in with Google and manage `classSections`.

## Features

- Google login with Firebase Auth.
- Dedicated `/classrooms` list page for all users, with search, refresh, and CSV export.
- Bulk delete classrooms from `/classrooms`, including matching quiz submissions.
- Dedicated submissions admin page with filterable, sortable rows and bulk delete.
- Question moderation page for filtering by type and likes/dislikes, a correct answer column, bulk verified flag updates, and previewed bulk deletes.
- Student Records page listing every submitted answer next to the correct answer, with filters and CSV export.
- Taxonomy moderation page for filtering, bulk verified flag updates, previewed deletes, and merging duplicate taxonomy references.
- Create, edit, delete, search, and refresh class sections.
- CSV export for current filtered sections.
- CSV import for creating or updating sections.
- Download a section CSV template before importing.
- Open any section to create, edit, delete, search, export, and import students in its `students` subcollection.
- Download a student CSV template before importing.
- Responsive layout for phones, tablets, and desktop.

## Section CSV Columns

```txt
id,sectionName,className,title,sortOrder,enabled,members
```

Rows with an `id` update that section document using merge. Rows without an `id` create a new section.
Use `email:role` pairs separated by semicolons in `members`, such as `teacher@example.com:admin;parent@example.com:viewer`.

The homepage queries `members` with `array-contains-any` using the signed-in lowercase email and the `admin`/`viewer` roles. The matching rules are in `firestore.rules`, based on the supplied project rules. Publish that file in the Firebase console's Firestore Rules tab for `eschool-dev-4c6b4` to apply the correction. The section membership helper uses a map `in sectionData.members`; the previous `members is list` and `hasAny()` expression denied the query in emulator verification. A school-admin marker alone does not grant section read access under these rules.

The submissions page loads classrooms owned by the signed-in UID and classrooms in sections where that email has the `admin` role. Submissions are queried by each owned classroom's document ID and each administered section's ID, then deduplicated. A viewer membership alone does not grant submission review access. Owner access requires submissions to reference the classroom document ID; historical class-code references need an authorized `sectionId` to appear through section-admin access. Deletion is disabled because the supplied rules forbid deleting submissions. Date filters initially show today; widen the range to see older results. Failed loads display an error instead of an empty result.

To verify section access against an isolated local Firestore emulator, run `FIRESTORE_RULES_TEST_HOST=127.0.0.1:8190 node --test tests/firestore-rules.test.js`. This test installs the rules and writes fixtures only to the emulator's `demo-section-rules` project.

## Student CSV Columns

```txt
id,studentName,phone,enabled
```

Student imports are scoped to the section currently open in the admin UI. Rows with an `id` update that student document using merge. Rows without an `id` create a new student.

The student create/edit form shows the Firestore document ID. Leave it blank when creating a student to auto-generate an ID, or enter a custom ID for a new student. Existing student IDs are read-only while editing.

## Classroom CSV Columns

```txt
id,classCode,className,sectionId,sectionName,questionBankListId,randomQuestionTypeCounts,studentDifficultyLevels,classEnabled,createdBy,creatorId,createdAt,createdDate
```

The classroom page reads all documents from `/classrooms`, shows creator email, created time, question randomization counts, and student difficulty overrides, and sorts newest classrooms first.

## Submissions Admin

The submissions page reads all documents from `qb_quiz_submissions_v1`, joins them with `/classrooms` by classroom document ID, class code, or section ID fallback, and filters by a From/To date range (inclusive, both default to today; clear either to leave that side open).

## Student Records

The `students.html` page lists every answer from `qb_quiz_submissions_v1` in one table: Question, Teacher's Answer, and Student's Answer. A small line under each question shows the student, section, subject, and date. The student's answer is green when correct and red when wrong.

Filters: search (student, admission no, question), section, class, subject, question type, question verified state, and a From/To date range. Results show 100 at a time with **Show more**. **Export CSV** downloads the filtered rows with the columns `Student ID` (admission number), `Question ID`, `Subject`, `Question`, `Correct Answer`, and `Student Answer`.

Class, subject, verified state, MCQ option text, and current short-answer model answers come from `qb_questions_v1`, because most submissions do not store class or subject. To limit reads, that question data is cached in the browser's `localStorage` for 12 hours; **Refresh** reloads it.

## Question Moderation

The questions page reads `qb_questions_v1` and `qb_reactions_v1`, computes like/dislike counts client-side, and supports bulk setting or removing `verified`. Bulk delete shows a detailed preview before deleting selected question documents.

Question moderation supports CSV import/export, table columns, filters, and sorting for `skill`, `actfl_level`, `actfl_sublevel`, and `actfl_mode`.

A **Parameters** column next to Explanation URL shows `explanationParameters`, the query string for the explanation link (such as `a=2&b=-5`). Its **Open** link opens the explanation URL with the parameters applied. It is included in CSV import/export, with no filter or sorting.

Questions can be filtered by type (MCQ, short answer, fill in the blank, true/false), complete translations (every language has its question, answer and explanation), and the distinct, non-empty `sectionId` values on loaded question documents. The Correct Answer column shows the answer already stored on each question: the option marked correct for MCQs, `shortAnswerHtml` for short answers, `trueAnswer` for true/false, and the accepted `fibBanks` answers for fill in the blank.

## Taxonomy Moderation

The taxonomy page reads `qb_taxonomy_v1` and `qb_questions_v1`, supports bulk setting or removing `verified`, CSV export, CSV paste/file import with preview, previewed deletes, and two-column taxonomy merge mapping with include/exclude filters. Merge maps selected source IDs to compatible target IDs, updates matching question reference fields, and deletes only the old source taxonomy documents.

Taxonomy CSV columns:

```txt
id,type,label,parentId,verified
```

## Admin Access

The app contains an optional `ADMIN_EMAILS` allowlist in `app.js`. Leave it empty for any signed-in Google user during development, or add lowercase admin emails:

```js
const ADMIN_EMAILS = ['admin@example.com'];
```

For production security, deploy Firestore rules that authorize admins server-side, such as a `/schoolAdmins/{uid}` marker document.

## Using Your Own Firebase Project

All pages read their config from `firebase-config.js`, which defaults to the team project. To use your own project, copy `firebase-config.local.example.js` to `firebase-config.local.js` (git-ignored) and paste your web app config. Enable Google sign-in and Firestore in that project, and add `localhost` to its authorized domains.

To seed it, open `copy-data.html`, sign in to both projects, pick collections, and copy. Document IDs are kept; same-ID documents in your project are overwritten.

## Run Locally

Use Node.js 22 or newer. Keep the service account JSON outside the repository, then run from the repository root:

```bash
npm install
export GOOGLE_APPLICATION_CREDENTIALS="/absolute/path/to/service-account.json"
npm start
```

Open `http://127.0.0.1:8000/` and sign in with Google. No Cloud Functions deployment is needed. Account operations require an active `/schoolAdmins/{uid}` marker or `role: admin` claim. See [setup instructions](STUDENT_AUTH_DEPLOYMENT.md) for credential permissions and rules. `npm test` runs mock Firebase tests without changing live data.

## Student Firebase Accounts

The student form supports school email (login username), admission number, account creation, password reset, and disabling linked accounts. **Migrate Login Profiles** backfills UID-keyed profiles for existing linked students. Student CSV adds `email,admissionNo`; passwords are excluded. See [deployment and migration instructions](STUDENT_AUTH_DEPLOYMENT.md) before using these controls.

**Bulk Create Accounts** downloads a CSV template for unlinked students in the open section. Fill `id,email,password,admissionNo`, preview it, and create accounts with per-student results. Existing linked accounts are skipped without password resets. Account CSV files contain initial credentials and should be kept private.
