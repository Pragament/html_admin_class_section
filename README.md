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

## Student CSV Columns

```txt
id,studentName,phone,enabled
```

Student imports are scoped to the section currently open in the admin UI. Rows with an `id` update that student document using merge. Rows without an `id` create a new student.

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

Questions can be filtered by type (MCQ, short answer, fill in the blank, true/false). The Correct Answer column shows the answer already stored on each question: the option marked correct for MCQs, `shortAnswerHtml` for short answers, `trueAnswer` for true/false, and the accepted `fibBanks` answers for fill in the blank.

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

## Run Locally

From the repository root:

```bash
python3 -m http.server 8000
```

Open:

```txt
http://localhost:8000/school-admin/
```
