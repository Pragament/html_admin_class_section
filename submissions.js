import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
    getAuth,
    GoogleAuthProvider,
    onAuthStateChanged,
    signInWithPopup,
    signOut
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
    collection,
    deleteDoc,
    doc,
    getDocs,
    getFirestore
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const firebaseConfig = {
    apiKey: 'AIzaSyAYlezFn0tSSQHA-vRnJeBfJ-Om1YlDghk',
    authDomain: 'eschool-dev-4c6b4.firebaseapp.com',
    projectId: 'eschool-dev-4c6b4',
    storageBucket: 'eschool-dev-4c6b4.firebasestorage.app',
    messagingSenderId: '875648503944',
    appId: '1:875648503944:web:5423a89ccd19e06c6f0f3d',
    measurementId: 'G-05GNVCMP1F'
};

const COLLECTIONS = {
    classrooms: 'classrooms',
    submissions: 'qb_quiz_submissions_v1'
};

const ADMIN_EMAILS = [];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let classrooms = [];
let submissions = [];
let selectedSubmissionIds = new Set();
let sortState = { key: 'submittedAtMillis', direction: 'desc' };
let toastTimer = null;

const $ = (id) => document.getElementById(id);
const els = {
    topbar: $('topbar'),
    statusText: $('statusText'),
    loginView: $('loginView'),
    dashboardView: $('dashboardView'),
    loginBtn: $('loginBtn'),
    logoutBtn: $('logoutBtn'),
    refreshBtn: $('refreshBtn'),
    adminLabel: $('adminLabel'),
    deleteSelectedBtn: $('deleteSelectedBtn'),
    searchInput: $('searchInput'),
    statusFilter: $('statusFilter'),
    dateFilter: $('dateFilter'),
    submissionCount: $('submissionCount'),
    selectedCount: $('selectedCount'),
    submissionTableWrap: $('submissionTableWrap'),
    confirmDialog: $('confirmDialog'),
    confirmForm: $('confirmForm'),
    confirmText: $('confirmText'),
    cancelDeleteBtn: $('cancelDeleteBtn'),
    confirmDeleteBtn: $('confirmDeleteBtn'),
    toast: $('toast')
};

bindEvents();
els.dateFilter.value = todayInputValue();

onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    const allowed = isAllowedAdmin(user);
    els.topbar.hidden = !allowed;
    els.loginView.hidden = allowed;
    els.dashboardView.hidden = !allowed;

    if (!user) {
        classrooms = [];
        submissions = [];
        selectedSubmissionIds = new Set();
        setStatus('Sign in with Google');
        renderSubmissions();
        return;
    }

    if (!allowed) {
        classrooms = [];
        submissions = [];
        selectedSubmissionIds = new Set();
        await signOut(auth);
        toast('This Google account is not allowed for admin access');
        renderSubmissions();
        return;
    }

    els.adminLabel.textContent = user.email || user.displayName || user.uid;
    await loadData();
});

function bindEvents() {
    els.loginBtn.addEventListener('click', login);
    els.logoutBtn.addEventListener('click', () => signOut(auth));
    els.refreshBtn.addEventListener('click', loadData);
    els.deleteSelectedBtn.addEventListener('click', openDeleteDialog);
    els.searchInput.addEventListener('input', renderSubmissions);
    els.statusFilter.addEventListener('change', renderSubmissions);
    els.dateFilter.addEventListener('change', renderSubmissions);
    els.submissionTableWrap.addEventListener('click', handleTableClick);
    els.submissionTableWrap.addEventListener('change', handleTableSelection);
    els.cancelDeleteBtn.addEventListener('click', () => els.confirmDialog.close());
    els.confirmForm.addEventListener('submit', deleteSelectedSubmissions);
}

async function login() {
    await signInWithPopup(auth, new GoogleAuthProvider());
}

function isAllowedAdmin(user) {
    if (!user) return false;
    if (!ADMIN_EMAILS.length) return true;
    return ADMIN_EMAILS.includes(String(user.email || '').toLowerCase());
}

async function loadData() {
    if (!currentUser) return;
    setStatus('Loading classrooms and submissions...');
    try {
        const [classroomSnap, submissionSnap] = await Promise.all([
            getDocs(collection(db, COLLECTIONS.classrooms)),
            getDocs(collection(db, COLLECTIONS.submissions))
        ]);
        classrooms = classroomSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        submissions = submissionSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        selectedSubmissionIds = new Set([...selectedSubmissionIds].filter(id => submissions.some(item => item.id === id)));
        renderSubmissions();
        setStatus(`${submissions.length} submission${submissions.length === 1 ? '' : 's'} loaded`);
    } catch (error) {
        classrooms = [];
        submissions = [];
        selectedSubmissionIds = new Set();
        renderSubmissions();
        setStatus(error.message || 'Unable to load submissions');
        toast('Unable to load submissions');
    }
}

function renderSubmissions() {
    const visible = sortedSubmissions();
    els.submissionCount.textContent = String(visible.length);
    els.submissionTableWrap.innerHTML = visible.length ? `
        <table class="section-table submissions-table">
            <thead>
                <tr>
                    <th scope="col"><input type="checkbox" data-select-all ${visible.every(item => selectedSubmissionIds.has(item.id)) ? 'checked' : ''} /></th>
                    ${sortHeader('submittedAtMillis', 'Submitted')}
                    ${sortHeader('studentName', 'Student')}
                    ${sortHeader('classroomName', 'Classroom')}
                    ${sortHeader('sectionName', 'Section')}
                    ${sortHeader('subject', 'Subject')}
                    ${sortHeader('score', 'Score')}
                    ${sortHeader('answeredCount', 'Answered')}
                    <th scope="col">Classroom ID</th>
                    <th scope="col">ID</th>
                </tr>
            </thead>
            <tbody>
                ${visible.map(submission => {
                    const classroom = associatedClassroom(submission);
                    return `
                        <tr>
                            <td><input type="checkbox" data-select-submission="${esc(submission.id)}" ${selectedSubmissionIds.has(submission.id) ? 'checked' : ''} /></td>
                            <td>${esc(formatDate(submittedMillis(submission)))}</td>
                            <td><strong>${esc(submission.studentName || submission.name || '')}</strong></td>
                            <td>${esc(classroomLabel(classroom) || submission.className || '')}</td>
                            <td>${esc(submission.sectionName || classroom?.sectionName || submission.sectionId || '')}</td>
                            <td>${esc(submission.subject || '')}</td>
                            <td>${esc(scoreLabel(submission))}</td>
                            <td>${esc(answeredLabel(submission))}</td>
                            <td><code>${esc(submission.classroomId || '')}</code></td>
                            <td><code>${esc(submission.id)}</code></td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    ` : '<div class="empty-card">No submissions found.</div>';
    updateSelectionState();
}

function sortHeader(key, label) {
    const active = sortState.key === key;
    const marker = active ? (sortState.direction === 'asc' ? ' ↑' : ' ↓') : '';
    return `<th scope="col"><button class="sort-btn" type="button" data-sort="${key}">${esc(label)}${marker}</button></th>`;
}

function handleTableClick(event) {
    const sortButton = event.target.closest('[data-sort]');
    if (!sortButton) return;
    const key = sortButton.dataset.sort;
    if (sortState.key === key) {
        sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
    } else {
        sortState = { key, direction: key === 'submittedAtMillis' || key === 'score' ? 'desc' : 'asc' };
    }
    renderSubmissions();
}

function handleTableSelection(event) {
    const selectAll = event.target.closest('[data-select-all]');
    if (selectAll) {
        sortedSubmissions().forEach(submission => {
            if (selectAll.checked) {
                selectedSubmissionIds.add(submission.id);
            } else {
                selectedSubmissionIds.delete(submission.id);
            }
        });
        renderSubmissions();
        return;
    }

    const checkbox = event.target.closest('[data-select-submission]');
    if (!checkbox) return;
    if (checkbox.checked) {
        selectedSubmissionIds.add(checkbox.dataset.selectSubmission);
    } else {
        selectedSubmissionIds.delete(checkbox.dataset.selectSubmission);
    }
    updateSelectionState();
}

function filteredSubmissions() {
    const search = els.searchInput.value.trim().toLowerCase();
    const status = els.statusFilter.value;
    return submissions.filter(submission => {
        const classroom = associatedClassroom(submission);
        const complete = Number(submission.answeredCount || 0) >= Number(submission.questionCount || 0);
        if (status === 'complete' && !complete) return false;
        if (status === 'partial' && complete) return false;
        if (!matchesDateFilter(submission)) return false;
        if (!search) return true;
        return [
            submission.id,
            submission.classroomId,
            submission.sectionId,
            submission.sectionName,
            submission.studentName,
            submission.admissionNo,
            submission.studentKey,
            submission.className,
            submission.subject,
            classroom?.id,
            classroom?.classCode,
            classroom?.className,
            classroom?.sectionName,
            classroom?.creatorId
        ].some(value => String(value || '').toLowerCase().includes(search));
    });
}

function sortedSubmissions() {
    const visible = filteredSubmissions();
    return visible.sort((a, b) => compareValues(sortValue(a, sortState.key), sortValue(b, sortState.key), sortState.direction));
}

function sortValue(submission, key) {
    const classroom = associatedClassroom(submission);
    if (key === 'classroomName') return classroomLabel(classroom) || submission.className || '';
    if (key === 'sectionName') return submission.sectionName || classroom?.sectionName || submission.sectionId || '';
    if (key === 'score') return Number(submission.correctCount || 0);
    if (key === 'answeredCount') return Number(submission.answeredCount || 0);
    if (key === 'submittedAtMillis') return submittedMillis(submission);
    return submission[key] || '';
}

function compareValues(a, b, direction) {
    const modifier = direction === 'asc' ? 1 : -1;
    if (typeof a === 'number' || typeof b === 'number') {
        return ((Number(a) || 0) - (Number(b) || 0)) * modifier;
    }
    return String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' }) * modifier;
}

function associatedClassroom(submission) {
    const classroomId = String(submission.classroomId || '');
    return classrooms.find(classroom => classroom.id === classroomId)
        || classrooms.find(classroom => classroom.classCode && classroom.classCode === classroomId)
        || classrooms.find(classroom => classroom.sectionId && classroom.sectionId === submission.sectionId);
}

function openDeleteDialog() {
    const selectedCount = selectedSubmissionIds.size;
    if (!selectedCount) return;
    els.confirmText.textContent = `This will delete ${selectedCount} submission${selectedCount === 1 ? '' : 's'} from qb_quiz_submissions_v1.`;
    els.confirmDialog.showModal();
}

async function deleteSelectedSubmissions(event) {
    event.preventDefault();
    const selectedIds = [...selectedSubmissionIds];
    if (!selectedIds.length) return;
    els.confirmDeleteBtn.disabled = true;
    setStatus('Deleting submissions...');
    try {
        for (const submissionId of selectedIds) {
            await deleteDoc(doc(db, COLLECTIONS.submissions, submissionId));
        }
        submissions = submissions.filter(submission => !selectedSubmissionIds.has(submission.id));
        selectedSubmissionIds = new Set();
        els.confirmDialog.close();
        renderSubmissions();
        setStatus(`${selectedIds.length} submission${selectedIds.length === 1 ? '' : 's'} deleted`);
        toast('Selected submissions deleted');
    } catch (error) {
        setStatus(error.message || 'Unable to delete submissions');
        toast('Unable to delete selected submissions');
    } finally {
        els.confirmDeleteBtn.disabled = false;
    }
}

function updateSelectionState() {
    const selectedCount = selectedSubmissionIds.size;
    els.selectedCount.textContent = `${selectedCount} selected`;
    els.deleteSelectedBtn.disabled = selectedCount === 0;
}

function classroomLabel(classroom) {
    if (!classroom) return '';
    return classroom.className || classroom.sectionName || classroom.classCode || classroom.id;
}

function scoreLabel(submission) {
    const correct = Number(submission.correctCount || 0);
    const gradable = Number(submission.gradableCount || 0);
    return gradable ? `${correct}/${gradable}` : String(correct);
}

function answeredLabel(submission) {
    const answered = Number(submission.answeredCount || 0);
    const total = Number(submission.questionCount || 0);
    return total ? `${answered}/${total}` : String(answered);
}

function formatDate(value) {
    const millis = Number(value || 0);
    if (!millis) return '';
    return new Date(millis).toLocaleString();
}

function matchesDateFilter(submission) {
    const selectedDate = els.dateFilter.value;
    if (!selectedDate) return true;
    const millis = submittedMillis(submission);
    if (!millis) return false;
    const [year, month, day] = selectedDate.split('-').map(Number);
    const start = new Date(year, month - 1, day).getTime();
    const end = new Date(year, month - 1, day + 1).getTime();
    return millis >= start && millis < end;
}

function submittedMillis(submission) {
    if (Number.isFinite(Number(submission.submittedAtMillis))) return Number(submission.submittedAtMillis);
    const submittedAt = submission.submittedAt;
    if (submittedAt?.toMillis) return submittedAt.toMillis();
    if (submittedAt?.toDate) return submittedAt.toDate().getTime();
    if (Number.isFinite(Number(submittedAt?.seconds))) {
        return (Number(submittedAt.seconds) * 1000) + Math.floor(Number(submittedAt.nanoseconds || 0) / 1000000);
    }
    return 0;
}

function todayInputValue() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function setStatus(message) {
    els.statusText.textContent = message;
}

function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2400);
}

function esc(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}
