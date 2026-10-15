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
const MEMBER_ROLES = ['viewer', 'admin'];
const CSV_COLUMNS = ['id', 'sectionName', 'className', 'title', 'sortOrder', 'enabled', 'members'];
const STUDENT_CSV_COLUMNS = ['id', 'studentName', 'phone', 'enabled', 'email', 'admissionNo'];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
// Same-origin local API: the credential file is only loaded by the Node server.
async function callStudentApi(operation, data) {
    if (!auth.currentUser) throw new Error('Sign in first.');
    const token = await auth.currentUser.getIdToken();
    const response = await fetch(`/api/${operation}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(data)
    });
    let result;
    try { result = await response.json(); }
    catch { throw new Error('Start the local admin server with npm start to use student account controls.'); }
    if (!response.ok) {
        const error = new Error(result.error?.message || 'Student account request failed.');
        error.code = result.error?.code;
        throw error;
    }
    return { data: result.data };
}
const manageAccount = data => callStudentApi('manageStudentAccount', data);
const migrateProfiles = data => callStudentApi('migrateStudentProfiles', data);

let currentUser = null;
let sections = [];
let students = [];
let activeSectionId = null;
let editingStudentId = null;
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
    memberList: $('memberList'),
    addMemberBtn: $('addMemberBtn'),
    saveSectionBtn: $('saveSectionBtn'),
    cancelSectionBtn: $('cancelSectionBtn'),
    studentDialog: $('studentDialog'),
    studentForm: $('studentForm'),
    studentDialogTitle: $('studentDialogTitle'),
    studentDialogSubtitle: $('studentDialogSubtitle'),
    studentId: $('studentId'),
    studentName: $('studentName'),
    studentPhone: $('studentPhone'),
    studentEmail: $('studentEmail'),
    studentAdmissionNo: $('studentAdmissionNo'),
    studentPassword: $('studentPassword'),
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
    els.addMemberBtn.addEventListener('click', () => addMemberRow());
    els.memberList.addEventListener('click', handleMemberListClick);
    els.searchInput.addEventListener('input', renderSections);
    els.exportCsvBtn.addEventListener('click', exportSectionsCsv);
    els.sectionTemplateBtn.addEventListener('click', downloadSectionTemplate);
    els.csvInput.addEventListener('change', importSectionsCsv);
    bindBulkAccountEvents();
    $('migrateProfilesBtn').addEventListener('click', migrateLoginProfiles);
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
                    <th scope="col">Access</th>
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
                        <td>${renderMemberChips(section.members)}</td>
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
        return [section.id, section.sectionName, section.name, section.className, section.title, serializeMembers(section.members)]
            .some(value => String(value || '').toLowerCase().includes(search));
    });
}

function openCreateDialog() {
    els.sectionDialogTitle.textContent = 'New Section';
    els.saveSectionBtn.textContent = 'Create Section';
    els.sectionForm.reset();
    els.sectionId.value = '';
    els.sectionEnabled.checked = true;
    renderMemberRows([]);
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
    renderMemberRows(normalizeMembers(section.members));
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
        enabled: els.sectionEnabled.checked,
        members: memberFormData()
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
            section.enabled === false ? 'false' : 'true',
            serializeMembers(section.members)
        ]);
    });
    downloadBlob(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }), 'class-sections.csv');
}

function downloadSectionTemplate() {
    downloadBlob(new Blob([toCsv([
        CSV_COLUMNS,
        ['', 'DSS grade 8', 'Grade 8', 'Display title', '0', 'true', 'teacher@example.com:admin;viewer@example.com:viewer']
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
            if (record.password) throw new Error('Passwords must be set in the student form, not imported from CSV.');
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
    const data = {
        sectionName,
        name: sectionName,
        className: String(record.classname || '').trim(),
        title: String(record.title || '').trim(),
        sortOrder: sortOrderText === '' ? null : Number(sortOrderText),
        enabled: parseBoolean(record.enabled, true)
    };
    if ('members' in record || 'access' in record || 'roles' in record) {
        data.members = parseMembers(record.members || record.access || record.roles || '');
    }
    return data;
}

function renderMemberRows(members) {
    els.memberList.innerHTML = '';
    const rows = members.length ? members : [{ email: '', role: 'viewer' }];
    rows.forEach(member => addMemberRow(member));
}

function addMemberRow(member = { email: '', role: 'viewer' }) {
    const row = document.createElement('div');
    row.className = 'role-row';
    row.innerHTML = `
        <label class="field role-email-field">
            <span>Email</span>
            <input data-member-email type="email" autocomplete="off" placeholder="teacher@example.com" value="${esc(member.email || '')}" />
        </label>
        <label class="field role-select-field">
            <span>Role</span>
            <select data-member-role>
                ${MEMBER_ROLES.map(role => `
                    <option value="${role}" ${member.role === role ? 'selected' : ''}>${role}</option>
                `).join('')}
            </select>
        </label>
        <button class="btn small danger role-remove-btn" data-remove-member type="button">Remove</button>
    `;
    els.memberList.append(row);
}

function handleMemberListClick(event) {
    const button = event.target.closest('[data-remove-member]');
    if (!button) return;
    button.closest('.role-row')?.remove();
    if (!els.memberList.querySelector('.role-row')) addMemberRow();
}

function memberFormData() {
    const seen = new Set();
    return Array.from(els.memberList.querySelectorAll('.role-row'))
        .map(row => {
            const email = row.querySelector('[data-member-email]')?.value.trim().toLowerCase() || '';
            const role = normalizeRole(row.querySelector('[data-member-role]')?.value);
            return { email, role };
        })
        .filter(member => {
            if (!member.email || seen.has(member.email)) return false;
            seen.add(member.email);
            return true;
        });
}

function normalizeMembers(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return value.map(member => ({
        email: String(member?.email || '').trim().toLowerCase(),
        role: normalizeRole(member?.role)
    })).filter(member => {
        if (!member.email || seen.has(member.email)) return false;
        seen.add(member.email);
        return true;
    });
}

function parseMembers(value) {
    if (Array.isArray(value)) return normalizeMembers(value);
    return normalizeMembers(String(value || '').split(/[;\n]/)
        .map(item => {
            const [email, role] = item.split(':');
            return {
                email: String(email || '').trim().toLowerCase(),
                role: normalizeRole(role)
            };
        })
        .filter(member => member.email));
}

function serializeMembers(value) {
    return normalizeMembers(value)
        .map(member => `${member.email}:${member.role}`)
        .join(';');
}

function renderMemberChips(value) {
    const members = normalizeMembers(value);
    if (!members.length) return '<span class="muted-text">None</span>';
    return `<div class="member-chip-list">${members.map(member => `
        <span class="role-chip ${member.role === 'admin' ? 'admin' : 'viewer'}">${esc(member.email)}: ${esc(member.role)}</span>
    `).join('')}</div>`;
}

function normalizeRole(value) {
    const role = String(value || '').trim().toLowerCase();
    return MEMBER_ROLES.includes(role) ? role : 'viewer';
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
                    <th scope="col">Email / Username</th>
                    <th scope="col">Login</th>
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
                        <td>${esc(student.email || '')}</td>
                        <td>${student.authUid ? 'Linked' : 'No account'}</td>
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
        return [student.id, student.studentName, student.name, student.phone, student.email, student.admissionNo]
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
    editingStudentId = null;
    els.studentId.value = '';
    els.studentId.readOnly = false;
    els.studentEnabled.checked = true;
    renderStudentPanelHeader();
    els.studentDialog.showModal();
}

function openEditStudentDialog(id) {
    const student = students.find(item => item.id === id);
    if (!student) return;
    els.studentDialogTitle.textContent = `Edit ${studentLabel(student)}`;
    els.saveStudentBtn.textContent = 'Save Student';
    editingStudentId = student.id;
    els.studentId.value = student.id;
    els.studentId.readOnly = true;
    els.studentName.value = student.studentName || student.name || '';
    els.studentPhone.value = student.phone || '';
    els.studentEmail.value = student.email || '';
    els.studentAdmissionNo.value = student.admissionNo || student.id;
    els.studentPassword.value = '';
    els.studentEnabled.checked = student.enabled !== false;
    renderStudentPanelHeader();
    els.studentDialog.showModal();
}

async function saveStudent(event) {
    event.preventDefault();
    const section = activeSection();
    if (!section) return;
    const id = els.studentId.value.trim();
    const data = studentFormData();
    const password = els.studentPassword.value;
    let savedId = editingStudentId || id;
    els.saveStudentBtn.disabled = true;
    try {
        if (id.includes('/')) throw new Error('Student ID cannot contain /');
        if (password && !data.email) throw new Error('Email is required to create an account');
        if (editingStudentId) {
            const existingStudent = students.find(item => item.id === editingStudentId);
            if (existingStudent?.authUid) {
                await manageAccount({ sectionId: section.id, studentId: editingStudentId, student: data, ...(password ? { password } : {}) });
            } else {
                await updateDoc(studentDocRef(editingStudentId), {
                    ...data, updatedAt: serverTimestamp(), updatedBy: currentUser.email || currentUser.uid
                });
            }
            if (existingStudent) Object.assign(existingStudent, data);
            toast('Student updated');
        } else {
            if (id && students.some(item => item.id === id)) {
                throw new Error('A student with this ID already exists');
            }
            const createdDate = Date.now();
            const payload = {
                ...data,
                createdDate,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                createdBy: currentUser.email || currentUser.uid,
                updatedBy: currentUser.email || currentUser.uid
            };
            if (id) {
                await setDoc(studentDocRef(id), payload);
                students.push({ id, ...data, createdDate });
            } else {
                const newRef = await addDoc(studentCollectionRef(), payload);
                savedId = newRef.id;
                students.push({ id: newRef.id, ...data, createdDate });
            }
            toast('Student created');
        }
        const savedStudent = students.find(item => item.id === savedId);
        if ((password || savedStudent?.authUid) && !savedStudent?.authUid) {
            await manageAccount({ sectionId: section.id, studentId: savedId, ...(password ? { password } : {}) });
            await loadStudents();
        }
        if (savedStudent?.authUid) await loadStudents();
        els.studentPassword.value = '';
        students.sort(compareStudents);
        els.studentDialog.close();
        editingStudentId = null;
        renderStudents();
        setStatus(`${students.length} student${students.length === 1 ? '' : 's'} loaded for ${sectionLabel(section)}`);
    } catch (error) {
        if (savedId && students.some(item => item.id === savedId)) {
            editingStudentId = savedId;
            els.studentId.value = savedId;
            els.studentId.readOnly = true;
        }
        toast(error.message || 'Unable to save student');
    } finally {
        els.studentPassword.value = '';
        els.saveStudentBtn.disabled = false;
    }
}

function studentFormData() {
    const studentName = els.studentName.value.trim();
    return {
        studentName,
        name: studentName,
        phone: els.studentPhone.value.trim(),
        email: els.studentEmail.value.trim().toLowerCase(),
        admissionNo: els.studentAdmissionNo.value.trim() || els.studentId.value.trim(),
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
        const student = students.find(item => item.id === pendingDeleteId);
        if (student?.authUid) throw new Error('Disable and save this linked student instead to revoke login access.');
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
            student.enabled === false ? 'false' : 'true',
            student.email || '', student.admissionNo || student.id
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
        ['', 'Student full name', '+91...', 'true', 'student@school.edu', '102']
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
            if (record.password) throw new Error('Passwords must be set in the student form, not imported from CSV.');
            const id = String(record.id || '').trim();
            if (id) {
                if (students.find(item => item.id === id)?.authUid) {
                    await manageAccount({ sectionId: section.id, studentId: id, student: data });
                } else {
                    await setDoc(studentDocRef(id), {
                        ...data, updatedAt: serverTimestamp(), updatedBy: currentUser.email || currentUser.uid
                    }, { merge: true });
                }
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
        enabled: parseBoolean(record.enabled, true),
        ...(record.email !== undefined ? { email: String(record.email).trim().toLowerCase() } : {}),
        ...(record.admissionno !== undefined ? { admissionNo: String(record.admissionno).trim() } : {})
    };
}

let accountRows = [];
let accountSectionId = null;
let bulkAccountBusy = false;
let stopBulkAccounts = false;

function bindBulkAccountEvents() {
    $('bulkAccountsBtn').addEventListener('click', () => {
        if (!activeSectionId) return;
        accountSectionId = activeSectionId;
        accountRows = [];
        $('bulkAccountsSection').textContent = `Section: ${sectionLabel(activeSection())}`;
        $('bulkAccountsStatus').textContent = 'Choose a CSV to preview.';
        $('bulkAccountsPreview').innerHTML = '';
        $('runBulkAccountsBtn').disabled = true;
        $('bulkAccountsDialog').showModal();
    });
    $('closeBulkAccountsBtn').addEventListener('click', () => $('bulkAccountsDialog').close());
    $('bulkAccountsDialog').addEventListener('cancel', event => { if (bulkAccountBusy) event.preventDefault(); });
    $('bulkAccountsDialog').addEventListener('close', () => { accountRows = []; accountSectionId = null; });
    $('stopBulkAccountsBtn').addEventListener('click', () => { stopBulkAccounts = true; $('stopBulkAccountsBtn').disabled = true; });
    $('accountTemplateBtn').addEventListener('click', () => {
        const rows = [['id', 'email', 'password', 'admissionNo']];
        students.filter(student => !student.authUid).forEach(student => rows.push([student.id, student.email || '', '', student.admissionNo || student.id]));
        downloadBlob(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }), 'student-accounts-template.csv');
    });
    $('accountCsvInput').addEventListener('change', previewAccountCsv);
    $('runBulkAccountsBtn').addEventListener('click', createBulkAccounts);
}

async function previewAccountCsv(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    accountRows = [];
    $('runBulkAccountsBtn').disabled = true;
    if (!file) return;
    try {
        if (file.size > 2 * 1024 * 1024) throw new Error('Account CSV must be smaller than 2 MB.');
        const parsed = parseCsv(await file.text());
        const headers = (parsed.shift() || []).map(normalizeHeader);
        if (!['id', 'email', 'password'].every(header => headers.includes(header))) throw new Error('Required CSV columns: id,email,password. Optional: admissionNo.');
        if (new Set(headers).size !== headers.length) throw new Error('CSV column names must be unique.');
        const ids = new Set();
        const emails = new Set();
        for (const row of parsed) {
            if (!row.some(value => String(value).trim())) continue;
            const record = Object.fromEntries(headers.map((header, index) => [header, row[index] || '']));
            const id = record.id.trim();
            const email = record.email.trim().toLowerCase();
            const student = students.find(item => item.id === id);
            let message = '';
            if (!student) message = 'ID does not exist in this section';
            else if (ids.has(id)) message = 'Duplicate student ID';
            else if (student.authUid) message = 'Already linked — will skip';
            else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) message = 'Valid school email required';
            else if (emails.has(email)) message = 'Duplicate email';
            else if (record.password.length < 6 || record.password.length > 128) message = 'Password must be 6–128 characters';
            ids.add(id);
            if (!student?.authUid) emails.add(email);
            accountRows.push({ id, email, password: record.password, admissionNo: record.admissionno?.trim() || student?.admissionNo || id,
                name: student ? studentLabel(student) : '', status: student?.authUid ? 'skip' : message ? 'invalid' : 'ready', message });
        }
        if (!accountRows.length) throw new Error('CSV has no student rows.');
        renderAccountPreview();
        const invalid = accountRows.filter(row => row.status === 'invalid').length;
        const ready = accountRows.filter(row => row.status === 'ready').length;
        $('bulkAccountsStatus').textContent = `${ready} ready; ${invalid} invalid; ${accountRows.filter(row => row.status === 'skip').length} already linked. ${invalid ? 'Correct invalid rows and reload the CSV.' : ''}`;
        $('runBulkAccountsBtn').disabled = invalid > 0 || ready === 0;
    } catch (error) {
        accountRows = [];
        $('bulkAccountsPreview').innerHTML = '';
        $('bulkAccountsStatus').textContent = error.message || 'Unable to preview CSV';
    }
}

function renderAccountPreview() {
    $('bulkAccountsPreview').innerHTML = `<table class="section-table"><thead><tr><th>ID</th><th>Student</th><th>Email / Username</th><th>Result</th></tr></thead><tbody>${accountRows.map(row => `<tr><td>${esc(row.id)}</td><td>${esc(row.name)}</td><td>${esc(row.email)}</td><td>${esc(row.message || row.status)}</td></tr>`).join('')}</tbody></table>`;
}

async function createBulkAccounts() {
    if (bulkAccountBusy || !accountSectionId || accountRows.some(row => row.status === 'invalid')) return;
    bulkAccountBusy = true;
    stopBulkAccounts = false;
    $('runBulkAccountsBtn').disabled = true;
    $('closeBulkAccountsBtn').disabled = true;
    $('accountCsvInput').disabled = true;
    $('accountTemplateBtn').disabled = true;
    $('stopBulkAccountsBtn').hidden = false;
    $('stopBulkAccountsBtn').disabled = false;
    const sectionId = accountSectionId;
    try {
        for (const row of accountRows) {
            if (stopBulkAccounts) break;
            if (row.status !== 'ready') { row.password = ''; continue; }
            $('bulkAccountsStatus').textContent = `Creating account for student ${row.id}…`;
            try {
                const result = await manageAccount({ sectionId, studentId: row.id, createOnly: true, password: row.password,
                    student: { email: row.email, admissionNo: row.admissionNo } });
                row.status = result.data.status === 'skipped' ? 'skip' : 'created';
                row.message = row.status === 'skip' ? 'Already linked — skipped' : 'Account and login profile created';
            } catch (error) {
                row.status = 'failed';
                row.message = error.message || 'Account creation failed';
                // Stop on quota, authorization, connection or server failures to avoid repeated failed requests.
                if (!['already-exists', 'invalid-argument', 'failed-precondition', 'not-found'].includes(error.code)) stopBulkAccounts = true;
            } finally { row.password = ''; }
            renderAccountPreview();
        }
    } finally {
        accountRows.forEach(row => { row.password = ''; });
        $('bulkAccountsStatus').textContent = `${accountRows.filter(row => row.status === 'created').length} created; ${accountRows.filter(row => row.status === 'skip').length} skipped; ${accountRows.filter(row => row.status === 'failed').length} failed; ${accountRows.filter(row => row.status === 'ready').length} not processed. Reload the CSV to retry remaining students.`;
        bulkAccountBusy = false;
        $('closeBulkAccountsBtn').disabled = false;
        $('accountCsvInput').disabled = false;
        $('accountTemplateBtn').disabled = false;
        $('stopBulkAccountsBtn').hidden = true;
        if (activeSectionId === sectionId) await loadStudents();
    }
}

async function migrateLoginProfiles() {
    if (!activeSectionId) return;
    const button = $('migrateProfilesBtn');
    button.disabled = true;
    try {
        const sectionId = activeSectionId;
        const data = { results: [] };
        let afterId = null;
        do {
            const response = await migrateProfiles({ sectionId, afterId });
            data.results.push(...response.data.results);
            afterId = response.data.nextId;
        } while (afterId);
        const counts = data.results.reduce((acc, row) => { acc[row.status] = (acc[row.status] || 0) + 1; return acc; }, {});
        setStatus(`Profiles migrated: ${counts.migrated || 0}; need accounts: ${counts['needs-account'] || 0}; failed: ${counts.failed || 0}${data.limited ? '; limited to first 200 students' : ''}`);
        await loadStudents();
        alert(data.results.map(row => `${row.id}: ${row.status}${row.message ? ' — ' + row.message : ''}`).join('\n') || 'No students to migrate.');
    } catch (error) { toast(error.message || 'Migration failed'); }
    finally { button.disabled = false; }
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
