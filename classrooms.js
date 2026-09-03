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
    classrooms: 'classrooms'
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
    'creatorId',
    'createdDate'
];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let classrooms = [];
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
    searchInput: $('searchInput'),
    classroomCount: $('classroomCount'),
    classroomTableWrap: $('classroomTableWrap'),
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
        setStatus('Sign in with Google');
        renderClassrooms();
        return;
    }

    if (!allowed) {
        classrooms = [];
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
    els.searchInput.addEventListener('input', renderClassrooms);
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
    els.classroomTableWrap.innerHTML = visible.length ? `
        <table class="section-table">
            <thead>
                <tr>
                    <th scope="col">Code</th>
                    <th scope="col">Classroom</th>
                    <th scope="col">Section</th>
                    <th scope="col">Question List</th>
                    <th scope="col">Status</th>
                    <th scope="col">Creator</th>
                    <th scope="col">ID</th>
                </tr>
            </thead>
            <tbody>
                ${visible.map(classroom => `
                    <tr>
                        <td><strong>${esc(classroom.classCode || '')}</strong></td>
                        <td><strong>${esc(classroomLabel(classroom))}</strong></td>
                        <td>${esc(classroom.sectionName || '')}</td>
                        <td><code>${esc(classroom.questionBankListId || '')}</code></td>
                        <td><span class="status-chip ${classroom.classEnabled === false ? 'disabled' : 'enabled'}">${classroom.classEnabled === false ? 'Disabled' : 'Enabled'}</span></td>
                        <td><code>${esc(classroom.creatorId || '')}</code></td>
                        <td><code>${esc(classroom.id)}</code></td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    ` : '<div class="empty-card">No classrooms found.</div>';
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
            classroom.questionBankListId
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
            classroom.creatorId || '',
            classroom.createdDate ?? ''
        ]);
    });
    downloadBlob(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }), 'classrooms.csv');
}

function compareClassrooms(a, b) {
    const dateA = Number.isFinite(Number(a.createdDate)) ? Number(a.createdDate) : 0;
    const dateB = Number.isFinite(Number(b.createdDate)) ? Number(b.createdDate) : 0;
    if (dateA !== dateB) return dateB - dateA;
    return classroomLabel(a).localeCompare(classroomLabel(b), undefined, { numeric: true, sensitivity: 'base' });
}

function classroomLabel(classroom) {
    return classroom.className || classroom.sectionName || classroom.classCode || classroom.id;
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
