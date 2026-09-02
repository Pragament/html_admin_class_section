import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
    getAuth,
    GoogleAuthProvider,
    onAuthStateChanged,
    signInWithPopup,
    signOut
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDocs,
    getFirestore,
    serverTimestamp,
    setDoc,
    updateDoc
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
    classSections: 'classSections',
    students: 'students'
};

const ADMIN_EMAILS = [];
const CSV_COLUMNS = ['id', 'sectionName', 'className', 'title', 'sortOrder', 'enabled'];
const STUDENT_CSV_COLUMNS = ['id', 'studentName', 'phone', 'enabled'];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let sections = [];
let students = [];
let activeSectionId = null;
let pendingDeleteId = null;
let pendingDeleteType = null;
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
    newSectionBtn: $('newSectionBtn'),
    exportCsvBtn: $('exportCsvBtn'),
    sectionTemplateBtn: $('sectionTemplateBtn'),
    csvInput: $('csvInput'),
    searchInput: $('searchInput'),
    sectionCount: $('sectionCount'),
    sectionTableWrap: $('sectionTableWrap'),
    studentPanel: $('studentPanel'),
    studentPanelTitle: $('studentPanelTitle'),
    studentPanelSubtitle: $('studentPanelSubtitle'),
    newStudentBtn: $('newStudentBtn'),
    exportStudentsCsvBtn: $('exportStudentsCsvBtn'),
    studentTemplateBtn: $('studentTemplateBtn'),
    studentCsvInput: $('studentCsvInput'),
    closeStudentPanelBtn: $('closeStudentPanelBtn'),
    studentSearchInput: $('studentSearchInput'),
    studentCount: $('studentCount'),
    studentTableWrap: $('studentTableWrap'),
    sectionDialog: $('sectionDialog'),
    sectionForm: $('sectionForm'),
    sectionDialogTitle: $('sectionDialogTitle'),
    sectionId: $('sectionId'),
    sectionName: $('sectionName'),
    className: $('className'),
    title: $('title'),
    sortOrder: $('sortOrder'),
    sectionEnabled: $('sectionEnabled'),
    saveSectionBtn: $('saveSectionBtn'),
    cancelSectionBtn: $('cancelSectionBtn'),
    studentDialog: $('studentDialog'),
    studentForm: $('studentForm'),
    studentDialogTitle: $('studentDialogTitle'),
    studentDialogSubtitle: $('studentDialogSubtitle'),
    studentId: $('studentId'),
    studentName: $('studentName'),
    studentPhone: $('studentPhone'),
    studentEnabled: $('studentEnabled'),
    saveStudentBtn: $('saveStudentBtn'),
    cancelStudentBtn: $('cancelStudentBtn'),
    confirmDialog: $('confirmDialog'),
    confirmForm: $('confirmForm'),
    confirmTitle: $('confirmTitle'),
    confirmText: $('confirmText'),
    cancelDeleteBtn: $('cancelDeleteBtn'),
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
        sections = [];
        students = [];
        closeStudentPanel();
        setStatus('Sign in with Google');
        renderSections();
        return;
    }

    if (!allowed) {
        sections = [];
        students = [];
        closeStudentPanel();
        await signOut(auth);
        toast('This Google account is not allowed for admin access');
        renderSections();
        return;
    }

    els.adminLabel.textContent = user.email || user.displayName || user.uid;
    await loadSections();
});

function bindEvents() {
    els.loginBtn.addEventListener('click', login);
    els.logoutBtn.addEventListener('click', () => signOut(auth));
    els.refreshBtn.addEventListener('click', loadSections);
    els.newSectionBtn.addEventListener('click', openCreateDialog);
    els.cancelSectionBtn.addEventListener('click', () => els.sectionDialog.close());
    els.sectionForm.addEventListener('submit', saveSection);
    els.searchInput.addEventListener('input', renderSections);
    els.exportCsvBtn.addEventListener('click', exportSectionsCsv);
    els.sectionTemplateBtn.addEventListener('click', downloadSectionTemplate);
    els.csvInput.addEventListener('change', importSectionsCsv);
    els.newStudentBtn.addEventListener('click', openCreateStudentDialog);
    els.cancelStudentBtn.addEventListener('click', () => els.studentDialog.close());
    els.studentForm.addEventListener('submit', saveStudent);
    els.studentSearchInput.addEventListener('input', renderStudents);
    els.exportStudentsCsvBtn.addEventListener('click', exportStudentsCsv);
    els.studentTemplateBtn.addEventListener('click', downloadStudentTemplate);
    els.studentCsvInput.addEventListener('change', importStudentsCsv);
    els.closeStudentPanelBtn.addEventListener('click', closeStudentPanel);
    els.cancelDeleteBtn.addEventListener('click', () => els.confirmDialog.close());
    els.confirmForm.addEventListener('submit', deleteConfirmed);
}

async function login() {
    await signInWithPopup(auth, new GoogleAuthProvider());
}

function isAllowedAdmin(user) {
    if (!user) return false;
    if (!ADMIN_EMAILS.length) return true;
    return ADMIN_EMAILS.includes(String(user.email || '').toLowerCase());
}

async function loadSections() {
    if (!currentUser) return;
    setStatus('Loading sections...');
    try {
        const snap = await getDocs(collection(db, COLLECTIONS.classSections));
        sections = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort(compareSections);
        if (activeSectionId && !sections.some(section => section.id === activeSectionId)) {
            closeStudentPanel();
        }
        renderSections();
        setStatus(`${sections.length} section${sections.length === 1 ? '' : 's'} loaded`);
    } catch (error) {
        sections = [];
        renderSections();
        setStatus(error.message || 'Unable to load sections');
        toast('Unable to load sections');
    }
}

function renderSections() {
    const visible = filteredSections();
    els.sectionCount.textContent = String(visible.length);
    els.sectionTableWrap.innerHTML = visible.length ? `
        <table class="section-table">
            <thead>
                <tr>
                    <th scope="col">Section</th>
                    <th scope="col">Class</th>
                    <th scope="col">Title</th>
                    <th scope="col">Sort</th>
                    <th scope="col">Status</th>
                    <th scope="col">ID</th>
                    <th scope="col">Actions</th>
                </tr>
            </thead>
            <tbody>
                ${visible.map(section => `
                    <tr>
                        <td><strong>${esc(sectionLabel(section))}</strong></td>
                        <td>${esc(section.className || '')}</td>
                        <td>${esc(section.title || '')}</td>
                        <td>${esc(section.sortOrder ?? '')}</td>
                        <td><span class="status-chip ${section.enabled === false ? 'disabled' : 'enabled'}">${section.enabled === false ? 'Disabled' : 'Enabled'}</span></td>
                        <td><code>${esc(section.id)}</code></td>
                        <td>
                            <div class="row-actions">
                                <button class="btn small" type="button" data-students="${section.id}">Students</button>
                                <button class="btn small" type="button" data-edit="${section.id}">Edit</button>
                                <button class="btn small danger" type="button" data-delete="${section.id}">Delete</button>
                            </div>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    ` : '<div class="empty-card">No class sections found.</div>';

    document.querySelectorAll('[data-students]').forEach(btn => {
        btn.addEventListener('click', () => openStudentPanel(btn.dataset.students));
    });
    document.querySelectorAll('[data-edit]').forEach(btn => {
        btn.addEventListener('click', () => openEditDialog(btn.dataset.edit));
    });
    document.querySelectorAll('[data-delete]').forEach(btn => {
        btn.addEventListener('click', () => openDeleteDialog(btn.dataset.delete));
    });
}

function filteredSections() {
    const search = els.searchInput.value.trim().toLowerCase();
    if (!search) return sections;
    return sections.filter(section => {
        return [section.id, section.sectionName, section.name, section.className, section.title]
            .some(value => String(value || '').toLowerCase().includes(search));
    });
}

function openCreateDialog() {
    els.sectionDialogTitle.textContent = 'New Section';
    els.saveSectionBtn.textContent = 'Create Section';
    els.sectionForm.reset();
    els.sectionId.value = '';
    els.sectionEnabled.checked = true;
    els.sectionDialog.showModal();
}

function openEditDialog(id) {
    const section = sections.find(item => item.id === id);
    if (!section) return;
    els.sectionDialogTitle.textContent = `Edit ${sectionLabel(section)}`;
    els.saveSectionBtn.textContent = 'Save Section';
    els.sectionId.value = section.id;
    els.sectionName.value = section.sectionName || section.name || '';
    els.className.value = section.className || '';
    els.title.value = section.title || '';
    els.sortOrder.value = section.sortOrder ?? '';
    els.sectionEnabled.checked = section.enabled !== false;
    els.sectionDialog.showModal();
}

async function saveSection(event) {
    event.preventDefault();
    const id = els.sectionId.value;
    const data = sectionFormData();
    try {
        if (id) {
            await updateDoc(doc(db, COLLECTIONS.classSections, id), {
                ...data,
                updatedAt: serverTimestamp(),
                updatedBy: currentUser.email || currentUser.uid
            });
            const section = sections.find(item => item.id === id);
            if (section) Object.assign(section, data);
            toast('Section updated');
        } else {
            const createdDate = Date.now();
            const newRef = await addDoc(collection(db, COLLECTIONS.classSections), {
                ...data,
                createdDate,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                createdBy: currentUser.email || currentUser.uid,
                updatedBy: currentUser.email || currentUser.uid
            });
            sections.push({ id: newRef.id, ...data, createdDate });
            toast('Section created');
        }
        sections.sort(compareSections);
        els.sectionDialog.close();
        renderSections();
        setStatus(`${sections.length} section${sections.length === 1 ? '' : 's'} loaded`);
    } catch (error) {
        toast(error.message || 'Unable to save section');
    }
}

function sectionFormData() {
    const sortOrderText = els.sortOrder.value.trim();
    const sectionName = els.sectionName.value.trim();
    return {
        sectionName,
        name: sectionName,
        className: els.className.value.trim(),
        title: els.title.value.trim(),
        sortOrder: sortOrderText === '' ? null : Number(sortOrderText),
        enabled: els.sectionEnabled.checked
    };
}

function openDeleteDialog(id) {
    const section = sections.find(item => item.id === id);
    if (!section) return;
    pendingDeleteId = id;
    pendingDeleteType = 'section';
    els.confirmTitle.textContent = 'Delete Section?';
    els.confirmText.textContent = `This will delete ${sectionLabel(section)}. Student documents under this section are not deleted by this app.`;
    els.confirmDialog.showModal();
}

async function deleteConfirmed(event) {
    event.preventDefault();
    if (pendingDeleteType === 'student') {
        await deleteStudent();
        return;
    }
    await deleteSection();
}

async function deleteSection() {
    if (!pendingDeleteId) return;
    try {
        await deleteDoc(doc(db, COLLECTIONS.classSections, pendingDeleteId));
        sections = sections.filter(section => section.id !== pendingDeleteId);
        if (activeSectionId === pendingDeleteId) closeStudentPanel();
        pendingDeleteId = null;
        pendingDeleteType = null;
        els.confirmDialog.close();
        renderSections();
        toast('Section deleted');
    } catch (error) {
        toast(error.message || 'Unable to delete section');
    }
}

function exportSectionsCsv() {
    const rows = [CSV_COLUMNS];
    filteredSections().forEach(section => {
        rows.push([
            section.id,
            section.sectionName || section.name || '',
            section.className || '',
            section.title || '',
            section.sortOrder ?? '',
            section.enabled === false ? 'false' : 'true'
        ]);
    });
    downloadBlob(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }), 'class-sections.csv');
}

function downloadSectionTemplate() {
    downloadBlob(new Blob([toCsv([
        CSV_COLUMNS,
        ['', 'DSS grade 8', 'Grade 8', 'Display title', '0', 'true']
    ])], { type: 'text/csv;charset=utf-8' }), 'class-sections-template.csv');
}

async function importSectionsCsv(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
        const rows = parseCsv(await file.text());
        if (rows.length < 2) {
            toast('CSV has no rows to import');
            return;
        }
        const headers = rows[0].map(normalizeHeader);
        let imported = 0;
        for (const row of rows.slice(1)) {
            if (!row.some(cell => String(cell || '').trim())) continue;
            const record = Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']));
            const data = sectionCsvData(record);
            if (!data.sectionName) continue;
            const id = String(record.id || '').trim();
            if (id) {
                await setDoc(doc(db, COLLECTIONS.classSections, id), {
                    ...data,
                    updatedAt: serverTimestamp(),
                    updatedBy: currentUser.email || currentUser.uid
                }, { merge: true });
            } else {
                await addDoc(collection(db, COLLECTIONS.classSections), {
                    ...data,
                    createdDate: Date.now(),
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                    createdBy: currentUser.email || currentUser.uid,
                    updatedBy: currentUser.email || currentUser.uid
                });
            }
            imported += 1;
        }
        toast(`${imported} section${imported === 1 ? '' : 's'} imported`);
        await loadSections();
    } catch (error) {
        toast(error.message || 'Unable to import CSV');
    }
}

function sectionCsvData(record) {
    const sectionName = String(record.sectionname || record.name || '').trim();
    const sortOrderText = String(record.sortorder || '').trim();
    return {
        sectionName,
        name: sectionName,
        className: String(record.classname || '').trim(),
        title: String(record.title || '').trim(),
        sortOrder: sortOrderText === '' ? null : Number(sortOrderText),
        enabled: parseBoolean(record.enabled, true)
    };
}

async function openStudentPanel(sectionId) {
    const section = sections.find(item => item.id === sectionId);
    if (!section) return;
    activeSectionId = sectionId;
    students = [];
    els.studentPanel.hidden = false;
    els.studentSearchInput.value = '';
    renderStudentPanelHeader();
    renderStudents();
    await loadStudents();
    els.studentPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeStudentPanel() {
    activeSectionId = null;
    students = [];
    if (els.studentPanel) els.studentPanel.hidden = true;
    if (els.studentSearchInput) els.studentSearchInput.value = '';
    renderStudents();
}

async function loadStudents() {
    const section = activeSection();
    if (!section) return;
    setStatus(`Loading students for ${sectionLabel(section)}...`);
    try {
        const snap = await getDocs(collection(db, COLLECTIONS.classSections, section.id, COLLECTIONS.students));
        students = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort(compareStudents);
        renderStudents();
        setStatus(`${students.length} student${students.length === 1 ? '' : 's'} loaded for ${sectionLabel(section)}`);
    } catch (error) {
        students = [];
        renderStudents();
        setStatus(error.message || 'Unable to load students');
        toast('Unable to load students');
    }
}

function renderStudentPanelHeader() {
    const section = activeSection();
    if (!section) return;
    els.studentPanelTitle.textContent = `Students - ${sectionLabel(section)}`;
    els.studentPanelSubtitle.textContent = [section.className, section.title].filter(Boolean).join(' • ');
    els.studentDialogSubtitle.textContent = `Section: ${sectionLabel(section)}`;
}

function renderStudents() {
    if (!els.studentTableWrap) return;
    const visible = filteredStudents();
    els.studentCount.textContent = String(visible.length);
    els.studentTableWrap.innerHTML = visible.length ? `
        <table class="section-table student-table">
            <thead>
                <tr>
                    <th scope="col">Student</th>
                    <th scope="col">Phone</th>
                    <th scope="col">Status</th>
                    <th scope="col">ID</th>
                    <th scope="col">Actions</th>
                </tr>
            </thead>
            <tbody>
                ${visible.map(student => `
                    <tr>
                        <td><strong>${esc(studentLabel(student))}</strong></td>
                        <td>${esc(student.phone || '')}</td>
                        <td><span class="status-chip ${student.enabled === false ? 'disabled' : 'enabled'}">${student.enabled === false ? 'Disabled' : 'Enabled'}</span></td>
                        <td><code>${esc(student.id)}</code></td>
                        <td>
                            <div class="row-actions">
                                <button class="btn small" type="button" data-edit-student="${student.id}">Edit</button>
                                <button class="btn small danger" type="button" data-delete-student="${student.id}">Delete</button>
                            </div>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    ` : '<div class="empty-card">No students found for this section.</div>';

    document.querySelectorAll('[data-edit-student]').forEach(btn => {
        btn.addEventListener('click', () => openEditStudentDialog(btn.dataset.editStudent));
    });
    document.querySelectorAll('[data-delete-student]').forEach(btn => {
        btn.addEventListener('click', () => openDeleteStudentDialog(btn.dataset.deleteStudent));
    });
}

function filteredStudents() {
    const search = els.studentSearchInput.value.trim().toLowerCase();
    if (!search) return students;
    return students.filter(student => {
        return [student.id, student.studentName, student.name, student.phone]
            .some(value => String(value || '').toLowerCase().includes(search));
    });
}

function openCreateStudentDialog() {
    const section = activeSection();
    if (!section) {
        toast('Choose a section first');
        return;
    }
    els.studentDialogTitle.textContent = 'New Student';
    els.saveStudentBtn.textContent = 'Create Student';
    els.studentForm.reset();
    els.studentId.value = '';
    els.studentEnabled.checked = true;
    renderStudentPanelHeader();
    els.studentDialog.showModal();
}

function openEditStudentDialog(id) {
    const student = students.find(item => item.id === id);
    if (!student) return;
    els.studentDialogTitle.textContent = `Edit ${studentLabel(student)}`;
    els.saveStudentBtn.textContent = 'Save Student';
    els.studentId.value = student.id;
    els.studentName.value = student.studentName || student.name || '';
    els.studentPhone.value = student.phone || '';
    els.studentEnabled.checked = student.enabled !== false;
    renderStudentPanelHeader();
    els.studentDialog.showModal();
}

async function saveStudent(event) {
    event.preventDefault();
    const section = activeSection();
    if (!section) return;
    const id = els.studentId.value;
    const data = studentFormData();
    try {
        if (id) {
            await updateDoc(studentDocRef(id), {
                ...data,
                updatedAt: serverTimestamp(),
                updatedBy: currentUser.email || currentUser.uid
            });
            const student = students.find(item => item.id === id);
            if (student) Object.assign(student, data);
            toast('Student updated');
        } else {
            const createdDate = Date.now();
            const newRef = await addDoc(studentCollectionRef(), {
                ...data,
                createdDate,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                createdBy: currentUser.email || currentUser.uid,
                updatedBy: currentUser.email || currentUser.uid
            });
            students.push({ id: newRef.id, ...data, createdDate });
            toast('Student created');
        }
        students.sort(compareStudents);
        els.studentDialog.close();
        renderStudents();
        setStatus(`${students.length} student${students.length === 1 ? '' : 's'} loaded for ${sectionLabel(section)}`);
    } catch (error) {
        toast(error.message || 'Unable to save student');
    }
}

function studentFormData() {
    const studentName = els.studentName.value.trim();
    return {
        studentName,
        name: studentName,
        phone: els.studentPhone.value.trim(),
        enabled: els.studentEnabled.checked
    };
}

function openDeleteStudentDialog(id) {
    const student = students.find(item => item.id === id);
    if (!student) return;
    pendingDeleteId = id;
    pendingDeleteType = 'student';
    els.confirmTitle.textContent = 'Delete Student?';
    els.confirmText.textContent = `This will delete ${studentLabel(student)} from ${sectionLabel(activeSection())}.`;
    els.confirmDialog.showModal();
}

async function deleteStudent() {
    if (!pendingDeleteId) return;
    try {
        await deleteDoc(studentDocRef(pendingDeleteId));
        students = students.filter(student => student.id !== pendingDeleteId);
        pendingDeleteId = null;
        pendingDeleteType = null;
        els.confirmDialog.close();
        renderStudents();
        toast('Student deleted');
    } catch (error) {
        toast(error.message || 'Unable to delete student');
    }
}

function exportStudentsCsv() {
    const section = activeSection();
    if (!section) {
        toast('Choose a section first');
        return;
    }
    const rows = [STUDENT_CSV_COLUMNS];
    filteredStudents().forEach(student => {
        rows.push([
            student.id,
            student.studentName || student.name || '',
            student.phone || '',
            student.enabled === false ? 'false' : 'true'
        ]);
    });
    const fileName = `${slugify(sectionLabel(section)) || 'section'}-students.csv`;
    downloadBlob(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }), fileName);
}

function downloadStudentTemplate() {
    const section = activeSection();
    const filePrefix = section ? slugify(sectionLabel(section)) : 'section';
    downloadBlob(new Blob([toCsv([
        STUDENT_CSV_COLUMNS,
        ['', 'Student full name', '+91...', 'true']
    ])], { type: 'text/csv;charset=utf-8' }), `${filePrefix || 'section'}-students-template.csv`);
}

async function importStudentsCsv(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    const section = activeSection();
    if (!file || !section) return;
    try {
        const rows = parseCsv(await file.text());
        if (rows.length < 2) {
            toast('CSV has no rows to import');
            return;
        }
        const headers = rows[0].map(normalizeHeader);
        let imported = 0;
        for (const row of rows.slice(1)) {
            if (!row.some(cell => String(cell || '').trim())) continue;
            const record = Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']));
            const data = studentCsvData(record);
            if (!data.studentName) continue;
            const id = String(record.id || '').trim();
            if (id) {
                await setDoc(studentDocRef(id), {
                    ...data,
                    updatedAt: serverTimestamp(),
                    updatedBy: currentUser.email || currentUser.uid
                }, { merge: true });
            } else {
                await addDoc(studentCollectionRef(), {
                    ...data,
                    createdDate: Date.now(),
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                    createdBy: currentUser.email || currentUser.uid,
                    updatedBy: currentUser.email || currentUser.uid
                });
            }
            imported += 1;
        }
        toast(`${imported} student${imported === 1 ? '' : 's'} imported`);
        await loadStudents();
    } catch (error) {
        toast(error.message || 'Unable to import students');
    }
}

function studentCsvData(record) {
    const studentName = String(record.studentname || record.name || '').trim();
    return {
        studentName,
        name: studentName,
        phone: String(record.phone || record.mobilenumber || record.mobile || '').trim(),
        enabled: parseBoolean(record.enabled, true)
    };
}

function activeSection() {
    return sections.find(section => section.id === activeSectionId);
}

function studentCollectionRef() {
    return collection(db, COLLECTIONS.classSections, activeSectionId, COLLECTIONS.students);
}

function studentDocRef(studentId) {
    return doc(db, COLLECTIONS.classSections, activeSectionId, COLLECTIONS.students, studentId);
}

function parseCsv(text) {
    const rows = [];
    let row = [];
    let value = '';
    let inQuotes = false;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const next = text[index + 1];
        if (char === '"' && inQuotes && next === '"') {
            value += '"';
            index += 1;
        } else if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            row.push(value);
            value = '';
        } else if ((char === '\n' || char === '\r') && !inQuotes) {
            if (char === '\r' && next === '\n') index += 1;
            row.push(value);
            rows.push(row);
            row = [];
            value = '';
        } else {
            value += char;
        }
    }
    row.push(value);
    if (row.length > 1 || row[0]) rows.push(row);
    return rows;
}

function toCsv(rows) {
    return rows.map(row => row.map(value => {
        const text = String(value ?? '');
        return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    }).join(',')).join('\n');
}

function normalizeHeader(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseBoolean(value, fallback) {
    const text = String(value ?? '').trim().toLowerCase();
    if (!text) return fallback;
    return ['true', '1', 'yes', 'y', 'enabled', 'active'].includes(text);
}

function compareSections(a, b) {
    const sortA = Number.isFinite(Number(a.sortOrder)) ? Number(a.sortOrder) : Number.MAX_SAFE_INTEGER;
    const sortB = Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : Number.MAX_SAFE_INTEGER;
    if (sortA !== sortB) return sortA - sortB;
    return sectionLabel(a).localeCompare(sectionLabel(b), undefined, { numeric: true, sensitivity: 'base' });
}

function compareStudents(a, b) {
    return studentLabel(a).localeCompare(studentLabel(b), undefined, { numeric: true, sensitivity: 'base' });
}

function sectionLabel(section) {
    return section.sectionName || section.name || section.className || section.title || section.id;
}

function studentLabel(student) {
    return student.studentName || student.name || student.phone || student.id;
}

function slugify(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
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
