# Firestore Schema

The teacher dashboard reads classroom and quiz submission data. It can create and update classrooms owned by the signed-in teacher. The separate admin pages manage class sections, section rosters, section access roles, classrooms across all users, and all quiz submissions.

## Firebase Auth

Teachers sign in with Google. The app uses the signed-in Firebase Auth UID to find classrooms:

```txt
classrooms where creatorId == currentUser.uid
```

The classroom admin list reads all classroom documents:

```txt
classrooms
```

The submissions admin list reads all quiz submission documents:

```txt
qb_quiz_submissions_v1
```

## Collections

### `classrooms`

Path:

```txt
/classrooms/{classroomId}
```

Document shape:

```js
{
  classCode: '176260',
  classEnabled: true,
  className: 'DSS grade 8 aug 31 quiz',
  createdBy: '',
  createdAt: Timestamp,
  createdDate: 1788177950135,
  creatorId: 'SPwA523UClVxTpX5m8XPMu5Imiy1',
  sectionId: 'QQAP9O4UyvlaYhqz7jdE',
  sectionName: 'DSS grade 8',
  questionBankListId: 'qb_lists_v1 document id',
  updatedAt: Timestamp
}
```

Important fields:

- `creatorId` - must match the signed-in teacher UID for the teacher dashboard. The admin classroom list shows classrooms from all creators and displays this value.
- `createdBy` - creator email shown in the admin classroom list when available.
- `createdAt` - shown as a human-readable timestamp in the admin classroom list. Classrooms are sorted newest first using `createdAt`, then `createdDate`.
- `classCode` - shown in classroom cards and used as a submission lookup fallback.
- `classEnabled` - shown as enabled/disabled.
- `sectionId` - used as a submission lookup fallback for all students in the classroom section.
- `sectionName` - shown in the dashboard.
- `questionBankListId` - optional reference to a private question list selected by the teacher.

Admin deletion behavior:

- Bulk deleting classrooms deletes selected `/classrooms/{classroomId}` documents.
- It also deletes matching `qb_quiz_submissions_v1` documents found by `classroomId == classroom.id`, `classroomId == classroom.classCode`, or `sectionId == classroom.sectionId`.

### `classSections`

Path:

```txt
/classSections/{sectionId}
```

The classroom editor loads section documents for the create/edit dropdown:

```txt
classSections
```

Supported display fields:

```js
{
  sectionName: 'DSS grade 8',
  name: 'DSS grade 8',
  className: 'DSS grade 8',
  title: 'DSS grade 8',
  sortOrder: 0,
  enabled: true,
  members: [
    {
      email: 'teacher@example.com',
      role: 'admin'
    },
    {
      email: 'viewer@example.com',
      role: 'viewer'
    }
  ],
  createdBy: 'admin@example.com',
  updatedBy: 'admin@example.com',
  createdAt: Timestamp,
  updatedAt: Timestamp,
  createdDate: 1788177950135
}
```

Section admin access:

- `members` - array of email/role assignments for the section.
- `members[].email` - normalized lowercase email.
- `members[].role` - either `viewer` or `admin`.
- Section CSV import/export represents members as semicolon-separated `email:role` pairs, for example `teacher@example.com:admin;viewer@example.com:viewer`.

The selected option is saved into classrooms as:

```js
{
  sectionId: 'classSections document id',
  sectionName: 'DSS grade 8'
}
```

Section rosters are read from:

```txt
/classSections/{sectionId}/students/{studentDocId}
```

Student document shape:

```js
{
  studentName: 'Parunandi Sai Adithya',
  name: 'Parunandi Sai Adithya',
  phone: '8328303045',
  enabled: true,
  createdBy: 'admin@example.com',
  updatedBy: 'admin@example.com',
  createdAt: Timestamp,
  updatedAt: Timestamp,
  createdDate: 1788177950135
}
```

Student CSV import/export columns:

```txt
id,studentName,phone,enabled
```

### `qb_lists_v1`

Path:

```txt
/qb_lists_v1/{listId}
```

Document shape:

```js
{
  name: 'Favorites',
  ownerUid: 'firebase-auth-uid',
  questionIds: [
    'qb_questions_v1 document id'
  ],
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

Important fields:

- `ownerUid` - must match the signed-in teacher UID for the list to appear in the classroom editor.
- `name` - shown in the classroom question-list dropdown.
- `questionIds` - stores question document IDs, not embedded question snapshots.

### `qb_quiz_submissions_v1`

Path:

```txt
/qb_quiz_submissions_v1/{submissionId}
```

Document shape:

```js
{
  classroomId: '176260',
  sectionId: 'QQAP9O4UyvlaYhqz7jdE',
  admissionNo: '102',
  studentName: 'Parunandi Sai Adithya',
  studentKey: 'QQAP9O4UyvlaYhqz7jdE_102',

  className: 'IX',
  subject: 'Mathematics',
  chapters: ['Algebra', 'Polynomials'],
  difficulty: 'Easy',

  questionCount: 10,
  answeredCount: 8,
  gradableCount: 7,
  correctCount: 5,

  answers: [
    {
      questionId: 'question-doc-id',
      type: 'mcq',
      promptHtml: '<p>Question snapshot</p>',
      displayAnswer: 'Option A',
      isCorrect: true,
      correctAnswer: 'Option A',
      selectedOptions: [0],
      fibAnswers: [],
      trueFalseAnswer: null,
      shortAnswer: ''
    }
  ],

  submittedAt: Timestamp,
  submittedAtMillis: 1788264300000
}
```

Important fields:

- `classroomId` - used to load submissions for the selected classroom.
- `sectionId` - used as a fallback to load all student submissions for a classroom section.
- `studentKey` - `${sectionId}_${admissionNo}`.
- `answers` - contains question snapshots and student answer snapshots for detailed review.
- `isCorrect` - `true` or `false` for auto-graded items, `null` for short-answer/manual-review items.
- `submittedAtMillis` - used for newest-first client sorting.

## Query Patterns

Classroom list:

```txt
classrooms where creatorId == currentUser.uid
```

Classroom admin list:

```txt
classrooms
```

Submission admin list:

```txt
qb_quiz_submissions_v1
classrooms
```

The submissions admin page associates submissions to classrooms by document ID, class code, then section ID fallback. Its date filter defaults to today's local date and checks `submittedAtMillis`, falling back to `submittedAt` when needed.

Question list dropdown:

```txt
qb_lists_v1 where ownerUid == currentUser.uid
```

Section dropdown:

```txt
classSections
```

Section roster:

```txt
classSections/{sectionId}/students
```

Submission loading for a selected classroom:

```txt
qb_quiz_submissions_v1 where classroomId == classroom.id
qb_quiz_submissions_v1 where classroomId == classroom.classCode
qb_quiz_submissions_v1 where sectionId == classroom.sectionId
```

The app de-duplicates submissions by document ID and sorts by `submittedAtMillis` newest first.

## Suggested Indexes

```txt
classrooms:
  creatorId ASC

qb_lists_v1:
  ownerUid ASC

qb_quiz_submissions_v1:
  classroomId ASC

qb_quiz_submissions_v1:
  sectionId ASC
```

If sorting is moved into Firestore later:

```txt
qb_quiz_submissions_v1:
  classroomId ASC
  submittedAtMillis DESC

qb_quiz_submissions_v1:
  sectionId ASC
  submittedAtMillis DESC
```

## Security Notes

The cleanest production rule is to write a teacher ownership field into each submission:

```js
{
  teacherUid: 'teacher-auth-uid'
}
```

Then dashboard reads can be restricted with:

```txt
request.auth.uid == resource.data.teacherUid
```

Without `teacherUid`, rules can authorize `classroomId` reads when `classroomId` matches an actual classroom document ID. Section-level fallback reads are harder to secure in Firestore rules because rules cannot query for "a classroom owned by this teacher with this sectionId." In that case, prefer adding `teacherUid` to submissions in the quiz-taking app.
