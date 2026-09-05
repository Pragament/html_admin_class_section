# School Admin Class Sections

Independent static app for school admins to sign in with Google and manage `classSections`.

## Features

- Google login with Firebase Auth.
- Dedicated `/classrooms` list page for all users, with search, refresh, and CSV export.
- Bulk delete classrooms from `/classrooms`, including matching quiz submissions.
- Dedicated submissions admin page with filterable, sortable rows and bulk delete.
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
id,classCode,className,sectionId,sectionName,questionBankListId,classEnabled,creatorId,createdDate
```

The classroom page reads all documents from `/classrooms` and includes `creatorId` in the table and export.

## Submissions Admin

The submissions page reads all documents from `qb_quiz_submissions_v1` and joins them with `/classrooms` by classroom document ID, class code, or section ID fallback.

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
