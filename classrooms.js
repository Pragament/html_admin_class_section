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
    getFirestore,
    query,
    where
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
const CSV_COLUMNS = [
    'id',
    'classCode',
    'className',
    'sectionId',
    'sectionName',
    'questionBankListId',
    'classEnabled',
    'createdBy',
    'creatorId',
    'createdAt',
    'createdDate'
];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let classrooms = [];
let selectedClassroomIds = new Set();
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
    exportClassroomsBtn: $('exportClassroomsBtn'),
    deleteSelectedBtn: $('deleteSelectedBtn'),
    searchInput: $('searchInput'),
    classroomCount: $('classroomCount'),
    selectedCount: $('selectedCount'),
    classroomTableWrap: $('classroomTableWrap'),
    confirmDialog: $('confirmDialog'),
    confirmForm: $('confirmForm'),
    confirmText: $('confirmText'),
    cancelDeleteBtn: $('cancelDeleteBtn'),
    confirmDeleteBtn: $('confirmDeleteBtn'),
    toast: $('toast')
};

bindEvents();

onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    const allowed = isAllowedAdmin(user);
    els.topbar.hidden = !allowed;
    els.loginView.hidden = allowed;
    els.dashboardView.hidden = !allowed;

    if (!user) {
        classrooms = [];
        selectedClassroomIds = new Set();
        setStatus('Sign in with Google');
        renderClassrooms();
        return;
    }

    if (!allowed) {
        classrooms = [];
        selectedClassroomIds = new Set();
        await signOut(auth);
        toast('This Google account is not allowed for admin access');
        renderClassrooms();
        return;
    }

    els.adminLabel.textContent = user.email || user.displayName || user.uid;
    await loadClassrooms();
});

function bindEvents() {
    els.loginBtn.addEventListener('click', login);
    els.logoutBtn.addEventListener('click', () => signOut(auth));
    els.refreshBtn.addEventListener('click', loadClassrooms);
    els.exportClassroomsBtn.addEventListener('click', exportClassroomsCsv);
    els.deleteSelectedBtn.addEventListener('click', openDeleteDialog);
    els.searchInput.addEventListener('input', renderClassrooms);
    els.classroomTableWrap.addEventListener('change', handleTableSelection);
    els.cancelDeleteBtn.addEventListener('click', () => els.confirmDialog.close());
    els.confirmForm.addEventListener('submit', deleteSelectedClassrooms);
}

async function login() {
    await signInWithPopup(auth, new GoogleAuthProvider());
}

function isAllowedAdmin(user) {
    if (!user) return false;
    if (!ADMIN_EMAILS.length) return true;
    return ADMIN_EMAILS.includes(String(user.email || '').toLowerCase());
}

async function loadClassrooms() {
    if (!currentUser) return;
    setStatus('Loading classrooms...');
    try {
        const snap = await getDocs(collection(db, COLLECTIONS.classrooms));
        classrooms = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort(compareClassrooms);
        selectedClassroomIds = new Set([...selectedClassroomIds].filter(id => classrooms.some(classroom => classroom.id === id)));
        renderClassrooms();
        setStatus(`${classrooms.length} classroom${classrooms.length === 1 ? '' : 's'} loaded`);
    } catch (error) {
        classrooms = [];
        renderClassrooms();
        setStatus(error.message || 'Unable to load classrooms');
        toast('Unable to load classrooms');
    }
}

function renderClassrooms() {
    const visible = filteredClassrooms();
    els.classroomCount.textContent = String(visible.length);
    updateSelectionState();
    els.classroomTableWrap.innerHTML = visible.length ? `
        <table class="section-table">
            <thead>
                <tr>
                    <th scope="col"><input type="checkbox" data-select-all ${visible.every(classroom => selectedClassroomIds.has(classroom.id)) ? 'checked' : ''} /></th>
                    <th scope="col">Code</th>
                    <th scope="col">Classroom</th>
                    <th scope="col">Section</th>
                    <th scope="col">Question List</th>
                    <th scope="col">Status</th>
                    <th scope="col">Creator Email</th>
                    <th scope="col">Created</th>
                    <th scope="col">ID</th>
                </tr>
            </thead>
            <tbody>
                ${visible.map(classroom => `
                    <tr>
                        <td><input type="checkbox" data-select-classroom="${esc(classroom.id)}" ${selectedClassroomIds.has(classroom.id) ? 'checked' : ''} /></td>
                        <td><strong>${esc(classroom.classCode || '')}</strong></td>
                        <td><strong>${esc(classroomLabel(classroom))}</strong></td>
                        <td>${esc(classroom.sectionName || '')}</td>
                        <td><code>${esc(classroom.questionBankListId || '')}</code></td>
                        <td><span class="status-chip ${classroom.classEnabled === false ? 'disabled' : 'enabled'}">${classroom.classEnabled === false ? 'Disabled' : 'Enabled'}</span></td>
                        <td><code>${esc(creatorEmail(classroom))}</code></td>
                        <td>${esc(formatDate(createdMillis(classroom)))}</td>
                        <td><code>${esc(classroom.id)}</code></td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    ` : '<div class="empty-card">No classrooms found.</div>';
    updateSelectionState();
}

function handleTableSelection(event) {
    const selectAll = event.target.closest('[data-select-all]');
    if (selectAll) {
        filteredClassrooms().forEach(classroom => {
            if (selectAll.checked) {
                selectedClassroomIds.add(classroom.id);
            } else {
                selectedClassroomIds.delete(classroom.id);
            }
        });
        renderClassrooms();
        return;
    }

    const checkbox = event.target.closest('[data-select-classroom]');
    if (!checkbox) return;
    if (checkbox.checked) {
        selectedClassroomIds.add(checkbox.dataset.selectClassroom);
    } else {
        selectedClassroomIds.delete(checkbox.dataset.selectClassroom);
    }
    updateSelectionState();
}

function updateSelectionState() {
    const selectedCount = selectedClassroomIds.size;
    els.selectedCount.textContent = `${selectedCount} selected`;
    els.deleteSelectedBtn.disabled = selectedCount === 0;
}

function openDeleteDialog() {
    const selected = selectedClassrooms();
    if (!selected.length) return;
    els.confirmText.textContent = `This will delete ${selected.length} classroom${selected.length === 1 ? '' : 's'} and all matching submissions found by classroom document ID, class code, or section ID.`;
    els.confirmDialog.showModal();
}

async function deleteSelectedClassrooms(event) {
    event.preventDefault();
    const selected = selectedClassrooms();
    if (!selected.length) return;
    els.confirmDeleteBtn.disabled = true;
    setStatus('Deleting classrooms and submissions...');
    try {
        const submissionIds = await findSubmissionIdsForClassrooms(selected);
        for (const submissionId of submissionIds) {
            await deleteDoc(doc(db, COLLECTIONS.submissions, submissionId));
        }
        for (const classroom of selected) {
            await deleteDoc(doc(db, COLLECTIONS.classrooms, classroom.id));
        }
        classrooms = classrooms.filter(classroom => !selectedClassroomIds.has(classroom.id));
        const classroomCount = selected.length;
        selectedClassroomIds = new Set();
        els.confirmDialog.close();
        renderClassrooms();
        setStatus(`${classroomCount} classroom${classroomCount === 1 ? '' : 's'} deleted`);
        toast(`${classroomCount} classroom${classroomCount === 1 ? '' : 's'} and ${submissionIds.size} submission${submissionIds.size === 1 ? '' : 's'} deleted`);
    } catch (error) {
        setStatus(error.message || 'Unable to delete classrooms');
        toast('Unable to delete selected classrooms');
    } finally {
        els.confirmDeleteBtn.disabled = false;
    }
}

async function findSubmissionIdsForClassrooms(selected) {
    const ids = new Set();
    for (const classroom of selected) {
        const lookups = [
            ['classroomId', classroom.id],
            ['classroomId', classroom.classCode],
            ['sectionId', classroom.sectionId]
        ].filter(([, value]) => String(value || '').trim());

        for (const [field, value] of lookups) {
            const snap = await getDocs(query(
                collection(db, COLLECTIONS.submissions),
                where(field, '==', value)
            ));
            snap.docs.forEach(item => ids.add(item.id));
        }
    }
    return ids;
}

function selectedClassrooms() {
    return classrooms.filter(classroom => selectedClassroomIds.has(classroom.id));
}

function filteredClassrooms() {
    const search = els.searchInput.value.trim().toLowerCase();
    if (!search) return classrooms;
    return classrooms.filter(classroom => {
        return [
            classroom.id,
            classroom.classCode,
            classroom.className,
            classroom.sectionId,
            classroom.sectionName,
            classroom.questionBankListId,
            classroom.createdBy,
            classroom.creatorEmail,
            classroom.email,
            classroom.creatorId,
            formatDate(createdMillis(classroom))
        ]
            .some(value => String(value || '').toLowerCase().includes(search));
    });
}

function exportClassroomsCsv() {
    const rows = [CSV_COLUMNS];
    filteredClassrooms().forEach(classroom => {
        rows.push([
            classroom.id,
            classroom.classCode || '',
            classroom.className || '',
            classroom.sectionId || '',
            classroom.sectionName || '',
            classroom.questionBankListId || '',
            classroom.classEnabled === false ? 'false' : 'true',
            creatorEmail(classroom),
            classroom.creatorId || '',
            formatDate(createdMillis(classroom)),
            classroom.createdDate ?? ''
        ]);
    });
    downloadBlob(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }), 'classrooms.csv');
}

function compareClassrooms(a, b) {
    const dateA = createdMillis(a);
    const dateB = createdMillis(b);
    if (dateA !== dateB) return dateB - dateA;
    return classroomLabel(a).localeCompare(classroomLabel(b), undefined, { numeric: true, sensitivity: 'base' });
}

function classroomLabel(classroom) {
    return classroom.className || classroom.sectionName || classroom.classCode || classroom.id;
}

function creatorEmail(classroom) {
    return classroom.createdBy || classroom.creatorEmail || classroom.email || '';
}

function createdMillis(classroom) {
    const createdAt = classroom.createdAt;
    if (createdAt?.toMillis) return createdAt.toMillis();
    if (createdAt?.toDate) return createdAt.toDate().getTime();
    if (Number.isFinite(Number(createdAt?.seconds))) {
        return (Number(createdAt.seconds) * 1000) + Math.floor(Number(createdAt.nanoseconds || 0) / 1000000);
    }
    if (Number.isFinite(Number(classroom.createdDate))) return Number(classroom.createdDate);
    return 0;
}

function formatDate(value) {
    const millis = Number(value || 0);
    if (!millis) return '';
    return new Date(millis).toLocaleString();
}

function toCsv(rows) {
    return rows.map(row => row.map(value => {
        const text = String(value ?? '');
        return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    }).join(',')).join('\n');
}

function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
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
