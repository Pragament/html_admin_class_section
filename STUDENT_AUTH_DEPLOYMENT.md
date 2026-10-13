# Student login setup and migration

The roster remains at `/classSections/{sectionId}/students/{studentDocId}`. Existing IDs and fields are preserved. The school email is the login username; a separate username login is not supported by Firebase email/password authentication.

Run locally before using account controls:

1. Enable Email/Password in Firebase Authentication.
2. In Firebase Console → Project settings → Service accounts, generate a private key for `eschool-dev-4c6b4`. Save it outside this repository, for example `/Users/nik/.config/school-admin/service-account.json`. Never upload the key into this chat or place it in a web folder.
3. Use Node.js 22 or newer. From the repository root run:

   ```bash
   npm install
   export GOOGLE_APPLICATION_CREDENTIALS="/Users/nik/.config/school-admin/service-account.json"
   npm start
   ```

4. Open `http://127.0.0.1:8000/` and sign in with Google. Set `PORT=8010 npm start` to choose a different port. Ensure `localhost` is in Firebase Authentication's authorized domains if Google sign-in reports an unauthorized domain.
5. Using a trusted console or Admin SDK, create `/schoolAdmins/{ADMIN_AUTH_UID}` with `{ active: true }`, or grant the `role: admin` custom claim. The browser allowlist does not authorize account operations. The service account needs Firebase Authentication user-management and Firestore read/write permissions.
6. Merge the rules below into existing project rules and review all overlapping matches before deploying. Existing rules were not provided; this repository does not automatically deploy replacement rules.

The server listens only on `127.0.0.1`, verifies Firebase ID tokens including revocation, checks admin authorization, and rejects foreign Host/Origin headers. Only an explicit list of frontend HTML/JS/CSS files is served. The JSON credential, backend source, and dependency files are never served. Requests and passwords are not logged. The server refuses keys inside the repository or for a different project.

Cloud Functions deployment is not required. `functions/index.js` is retained as an optional wrapper around the shared account service, but the browser now uses same-origin `/api/` requests to the local server. Serving the app with `python3 -m http.server` supports ordinary browser features but does not provide the account API.

Internet access is required. The server writes to the real `eschool-dev-4c6b4` project. Normal roster and other admin pages still use the browser Firebase SDK and existing Firestore rules; the local API handles student account operations and login profile migration.

Run `npm test` to check the local API and shared account service using mock Firebase dependencies. Tests do not change real Firebase data.

```js
function isSchoolAdmin() {
  return request.auth != null && (
    request.auth.token.role == 'admin' ||
    (exists(/databases/$(database)/documents/schoolAdmins/$(request.auth.uid)) &&
     get(/databases/$(database)/documents/schoolAdmins/$(request.auth.uid)).data.active == true)
  );
}
match /schoolAdmins/{uid} { allow read, write: if false; }
match /studentProfiles/{uid} {
  allow get: if isSchoolAdmin() || (request.auth != null && request.auth.uid == uid && resource.data.active == true);
  allow list: if isSchoolAdmin();
  allow write: if false; // Trusted backend owns profiles.
}
match /classSections/{sectionId}/students/{studentId} {
  allow read: if isSchoolAdmin();
  // Prevent client edits from bypassing Auth synchronization for linked students.
  allow create: if isSchoolAdmin() && !request.resource.data.keys().hasAny(['authUid', 'studentKey', 'password']);
  allow update: if isSchoolAdmin() && !resource.data.keys().hasAny(['authUid']) && !request.resource.data.diff(resource.data).affectedKeys().hasAny(['authUid', 'studentKey', 'password']);
  allow delete: if isSchoolAdmin() && !resource.data.keys().hasAny(['authUid']);
}
```

For each existing student, edit their school email and admission number and set a password (8–128 characters). Saving creates a Firebase Auth account and atomically links the roster and profile. Existing unrelated email accounts are rejected, never automatically adopted. Existing accounts can be linked only by a trusted operator who verifies identity and sets `authUid` on the roster.

**Migrate Login Profiles** processes all students in the open section in pages of 100. It backfills profiles for linked accounts and reports students needing accounts and individual failures. It does not invent emails/passwords, delete old collections, or alter historical submissions. Rerunning is safe. Export a roster backup before migration. No production data migration has been executed by adding this feature.

The profile contains `authUid`, `email`, `username`, `sectionId`, `studentDocId`, `admissionNo`, `studentKey`, `studentName`, `active`, `createdAt`, and `updatedAt`. `studentKey` uses the section and admission number, falling back to the existing document ID. Preserve admission numbers once used by submissions.

Set a new password in Edit Student to reset it. Uncheck Enabled and save to disable Auth, revoke refresh tokens, and set the profile inactive. Linked students cannot be deleted through this app. Passwords are sent only to the local backend and never persisted or exported.

Auth and Firestore cannot share one transaction. The stable account UID lets a retry recover an account after an interrupted profile write. If synchronization fails, the saved roster may temporarily differ from Auth/profile; retry Save and inspect the failure. Student app rules must check active profiles for access revocation, since existing ID tokens can remain valid until expiry.

The student app still needs the login and submission changes described in the supplied plan: sign in with email/password, read its own UID profile, and use authenticated identity in submission rules. This admin repository does not contain that app.

## Server error logs

API failures appear in the terminal running `npm start` as JSON with an operation, stage, request ID, recognized Firebase/gRPC error code, and troubleshooting hint. The browser's error includes the same request ID. Restart the server after updating backend files, retry the operation, and use the matching terminal entry to diagnose it. Individual migration failures also log a synchronization diagnostic. Raw SDK messages, stacks, request bodies, tokens, passwords, and credential contents are excluded.

## Bulk account creation

In the open section choose **Bulk Create Accounts**, then **Download Account Template**. The template includes every roster student without a linked account, regardless of the search filter:

```csv
id,email,password,admissionNo
106,student106@school.edu,ChooseInitialPassword,106
119,student119@school.edu,AnotherInitialPassword,119
```

Fill in each email and an 8–128 character password. Use **Preview Account CSV**, review the student IDs, emails and validation results, then **Create Accounts**. All rows must pass validation before creation starts. Passwords are never shown in the preview or written to Firestore. This account CSV is distinct from the normal student import, which rejects passwords.

The CSV contains initial credentials; keep it private and delete it when no longer needed. The browser holds credentials in memory only while the dialog is in use and clears them on completion or close. Each request creates the account, links the existing roster document, and writes its login profile. Existing linked accounts are skipped on the server without resetting passwords. Accounts created successfully stay created if a later row fails. Quota, authorization, network and server failures stop processing. **Stop After Current Student** preserves completed work. Reload the CSV to retry remaining students; already linked accounts will be skipped. No extra migration is required after successful creation.
