# School organisations, branches and students

## Setup and use

1. Publish the updated `firestore.rules` and restart the local server with `npm start`. Use the server's URL for administration (the pages call same-origin `/api` routes). No production data is migrated automatically.
2. Sign in with an active `schoolAdmins/{uid}` marker or an `admin` role claim. Open **Organisations** (`organisations.html`), enter a unique code and name, and save.
3. Open **Branches** (`branches.html`), select the organisation, and enter a globally unique branch code and name. Codes accept 1–32 letters, digits or hyphens, are normalized to uppercase, and cannot be renamed. A branch cannot move to a different organisation. Name, address and enabled status can be edited.
4. On the sections page, edit an existing section and select its branch, or select a branch when creating a section. Sections remain at `classSections/{sectionId}`. The branch filter includes **Unassigned sections**. Assignment requires a school admin; section admins can subsequently manage their assigned roster. A branch association cannot be changed after assignment.
5. Enter a student admission number, for example `00755`. The new-student form generates a read-only ID such as `SGD-00755`, where `SGD` is the selected section's branch code. Admission numbers are uppercased, preserve leading zeros, and accept letters, digits, underscores and hyphens. Registered admission numbers cannot be changed through the form.

Enabled status on organisations and branches is metadata; it does not independently revoke student access. Use the existing student membership controls to revoke access.

## Firestore layout

```text
schoolOrganisations/{ORGCODE}
  code, name, address, enabled, createdAt, updatedAt, updatedBy

schoolBranches/{BRANCHCODE}
  code, orgId, name, address, enabled, createdAt, updatedAt, updatedBy

schoolBranches/{BRANCHCODE}/admissions/{ADMISSIONNUMBER}
  admissionNo, studentId, name, phoneDigits, sections, updatedAt

classSections/{sectionId}
  ...existing fields, orgId, branchId, branchCode

classSections/{sectionId}/students/{BRANCHCODE-ADMISSIONNUMBER}
  ...existing fields, orgId, branchId, branchStudentId, admissionNo
```

Code-based document IDs enforce uniqueness across concurrent transactions. Organisation codes are unique across organisations. Branch codes are unique across **all** organisations. Admission claims are stored under the branch, so a number can be used in another branch without conflict.

A student can belong to multiple sections of the same branch: those roster entries share one canonical `branchStudentId` and one admission claim. The claim's `sections` map stores each section ID and its roster document ID. When adding an existing admission to another section, the name (ignoring case) and full phone digits must match; otherwise the server returns a conflict. A different roster ID cannot claim the same admission in one section. Do not change an admission to work around a conflict without first reviewing the original student record.

## Existing sections and logins

Assigning a branch to a populated section reserves its existing admissions in one transaction and adds organisation/branch metadata. Existing roster document IDs, admission-number spelling, Firebase Auth UIDs, student keys and login profiles are preserved. Existing IDs such as `755` are not renamed to `SGD-755`; the roster receives the canonical `branchStudentId: SGD-755` instead. Existing records can be edited at their original IDs.

The assignment is rejected without writes if duplicate/conflicting admissions are found. For safety, legacy sections containing more than 200 students require a staged migration before branch assignment; this UI does not perform that migration. Existing unassigned sections remain readable but must be assigned before new roster saves/imports. The separate quiz-taking app can continue using section IDs and the existing login membership schema.

## Student CSV import

The section's **Student Template** now provides a prefixed example:

```csv
id,studentName,phone,enabled,email,admissionNo
SGD-00755,Ananya,9666033404,true,755@school.example,00755
```

Every input ID must exactly equal `BRANCHCODE-ADMISSIONNUMBER`. The entire CSV is checked for prefix/ID consistency, required names/admissions and duplicate admissions before any rows are saved. The backend repeats validation and reserves each admission transactionally, including requests made outside the browser. Each row is saved independently, so a later server conflict can leave earlier rows saved; fix the conflict and retry. Import does not rename legacy IDs: use Edit for those records or plan an explicit migration. Passwords are not accepted by student CSV import.

Section CSV export/template includes a `branchId` column. New section imports require a valid branch; updates use the assigned branch when the column is omitted.

## CRUD and permissions

School organisation/branch CRUD uses the trusted admin API. Browser writes to structure and admission documents are denied. Section creation, branch assignment, roster changes and deletions also use the API, preventing direct writes from bypassing uniqueness.

- Organisations with branches cannot be deleted.
- Branches with sections or registered admissions cannot be deleted.
- Sections containing students cannot be deleted; disable them instead.
- Linked students cannot be deleted; use the existing membership disable controls.
- Deleting an unlinked roster entry releases that section's admission claim; other memberships are preserved.

Existing collection rules unrelated to school structure are retained. School metadata is readable to signed-in users; admission records, including normalized phone digits, are not exposed through browser reads.

API operations: `manageSchoolStructure`, `saveSchoolSection`, `saveSchoolStudent`, `deleteSchoolSection`, and `deleteSchoolStudent`. The local server exposes these under `/api/`; callable exports are available if using the Cloud Functions deployment. Code changes alone do not deploy rules or functions.

## Verification

With a local Firestore emulator running:

```sh
FIRESTORE_RULES_TEST_HOST=127.0.0.1:8190 npm test
```

`tests/school-service.test.js` covers concurrent code claims, cross-organisation branch collisions, per-branch admission ownership, multi-section reuse, malformed imports, legacy assignment and deletion guards. `tests/firestore-rules.test.js` verifies that direct client writes cannot bypass the API.

For browser checks, set `PLAYWRIGHT_MODULE` (or install Playwright locally), optionally set `PLAYWRIGHT_EXECUTABLE`, and run `FIRESTORE_RULES_TEST_HOST=127.0.0.1:8190 node tests/schools-browser.cjs`. Firebase Auth is mocked and data is written only to a separate demo emulator project.
