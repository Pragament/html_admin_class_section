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
    questions: 'qb_questions_v1',
    taxonomy: 'qb_taxonomy_v1'
};
const FIELD_BY_TYPE = {
    class: 'classId',
    subject: 'subjectId',
    chapter: 'chapterId',
    topic: 'topicId'
};
const TAXONOMY_TYPES = ['class', 'subject', 'chapter', 'topic'];
const CSV_COLUMNS = ['id', 'type', 'label', 'parentId', 'classId', 'subjectId', 'chapterId', 'topicId', 'verified'];
const AI_IMPORT_PROMPT = `Create a CSV for Firestore qb_taxonomy_v1 import.

Return only CSV, with this exact header:
id,type,label,parentId,classId,subjectId,chapterId,topicId,verified

Rules:
- type must be one of class, subject, chapter, topic.
- id should be deterministic lowercase snake-style taxonomy id using the parent path.
- class rows have empty parentId and classId equal to id.
- subject rows have parentId as class id, classId as class id, subjectId equal to id.
- chapter rows have parentId as subject id, classId and subjectId populated, chapterId equal to id.
- topic rows have parentId as chapter id, classId, subjectId, chapterId populated, topicId equal to id.
- verified must be true or false.
- Escape commas with CSV quotes when needed.
- Do not include markdown fences or explanations.`;
const ADMIN_EMAILS = [];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let questions = [];
let taxonomy = [];
let selectedTaxonomyIds = new Set();
let pendingAction = null;
let pendingImportRows = [];
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
    exportCsvBtn: $('exportCsvBtn'),
    openImportBtn: $('openImportBtn'),
    markVerifiedBtn: $('markVerifiedBtn'),
    removeVerifiedBtn: $('removeVerifiedBtn'),
    mergeSelectedBtn: $('mergeSelectedBtn'),
    deleteSelectedBtn: $('deleteSelectedBtn'),
    searchInput: $('searchInput'),
    typeFilter: $('typeFilter'),
    verifiedFilter: $('verifiedFilter'),
    taxonomyCount: $('taxonomyCount'),
    selectedCount: $('selectedCount'),
    taxonomyTableWrap: $('taxonomyTableWrap'),
    confirmDialog: $('confirmDialog'),
    confirmForm: $('confirmForm'),
    confirmTitle: $('confirmTitle'),
    confirmText: $('confirmText'),
    previewList: $('previewList'),
    mergeFields: $('mergeFields'),
    mergeTargetSelect: $('mergeTargetSelect'),
    cancelActionBtn: $('cancelActionBtn'),
    confirmActionBtn: $('confirmActionBtn'),
    importDialog: $('importDialog'),
    importForm: $('importForm'),
    closeImportBtn: $('closeImportBtn'),
    copyPromptBtn: $('copyPromptBtn'),
    csvFileInput: $('csvFileInput'),
    csvPasteInput: $('csvPasteInput'),
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
        questions = [];
        taxonomy = [];
        selectedTaxonomyIds = new Set();
        setStatus('Sign in with Google');
        renderTaxonomy();
        return;
    }

    if (!allowed) {
        questions = [];
        taxonomy = [];
        selectedTaxonomyIds = new Set();
        await signOut(auth);
        toast('This Google account is not allowed for admin access');
        renderTaxonomy();
        return;
    }

    els.adminLabel.textContent = user.email || user.displayName || user.uid;
    await loadData();
});

function bindEvents() {
    els.loginBtn.addEventListener('click', login);
    els.logoutBtn.addEventListener('click', () => signOut(auth));
    els.refreshBtn.addEventListener('click', loadData);
    els.exportCsvBtn.addEventListener('click', exportTaxonomyCsv);
    els.openImportBtn.addEventListener('click', openImportDialog);
    els.closeImportBtn.addEventListener('click', () => els.importDialog.close());
    els.copyPromptBtn.addEventListener('click', copyImportPrompt);
    els.csvFileInput.addEventListener('change', readCsvFile);
    els.importForm.addEventListener('submit', previewImportCsv);
    els.markVerifiedBtn.addEventListener('click', () => openActionDialog('verify'));
    els.removeVerifiedBtn.addEventListener('click', () => openActionDialog('unverify'));
    els.mergeSelectedBtn.addEventListener('click', () => openActionDialog('merge'));
    els.deleteSelectedBtn.addEventListener('click', () => openActionDialog('delete'));
    [els.searchInput, els.typeFilter, els.verifiedFilter].forEach(el => {
        el.addEventListener('input', renderTaxonomy);
        el.addEventListener('change', renderTaxonomy);
    });
    els.taxonomyTableWrap.addEventListener('change', handleTableSelection);
    els.cancelActionBtn.addEventListener('click', () => els.confirmDialog.close());
    els.confirmForm.addEventListener('submit', runPendingAction);
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
    setStatus('Loading taxonomy and questions...');
    try {
        const [taxonomySnap, questionSnap] = await Promise.all([
            getDocs(collection(db, COLLECTIONS.taxonomy)),
            getDocs(collection(db, COLLECTIONS.questions))
        ]);
        taxonomy = taxonomySnap.docs.map(d => ({ id: d.id, ...d.data() })).sort(compareTaxonomy);
        questions = questionSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        selectedTaxonomyIds = new Set([...selectedTaxonomyIds].filter(id => taxonomy.some(item => item.id === id)));
        renderTaxonomy();
        setStatus(`${taxonomy.length} taxonomy item${taxonomy.length === 1 ? '' : 's'} loaded`);
    } catch (error) {
        taxonomy = [];
        questions = [];
        selectedTaxonomyIds = new Set();
        renderTaxonomy();
        setStatus(error.message || 'Unable to load taxonomy');
        toast('Unable to load taxonomy');
    }
}

function renderTaxonomy() {
    const visible = filteredTaxonomy();
    els.taxonomyCount.textContent = String(visible.length);
    els.taxonomyTableWrap.innerHTML = visible.length ? `
        <table class="section-table moderation-table">
            <thead>
                <tr>
                    <th scope="col"><input type="checkbox" data-select-all ${visible.every(item => selectedTaxonomyIds.has(item.id)) ? 'checked' : ''} /></th>
                    <th scope="col">Label</th>
                    <th scope="col">Type</th>
                    <th scope="col">Verified</th>
                    <th scope="col">Question Refs</th>
                    <th scope="col">Parent</th>
                    <th scope="col">ID</th>
                </tr>
            </thead>
            <tbody>
                ${visible.map(item => `
                    <tr>
                        <td><input type="checkbox" data-select-taxonomy="${esc(item.id)}" ${selectedTaxonomyIds.has(item.id) ? 'checked' : ''} /></td>
                        <td><strong>${esc(item.label || '')}</strong></td>
                        <td>${esc(item.type || '')}</td>
                        <td><span class="status-chip ${item.verified ? 'enabled' : 'disabled'}">${item.verified ? 'Verified' : 'Unverified'}</span></td>
                        <td>${questionRefs(item).length}</td>
                        <td><code>${esc(item.parentId || '')}</code></td>
                        <td><code>${esc(item.id)}</code></td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    ` : '<div class="empty-card">No taxonomy items found.</div>';
    updateSelectionState();
}

function handleTableSelection(event) {
    const selectAll = event.target.closest('[data-select-all]');
    if (selectAll) {
        filteredTaxonomy().forEach(item => {
            if (selectAll.checked) {
                selectedTaxonomyIds.add(item.id);
            } else {
                selectedTaxonomyIds.delete(item.id);
            }
        });
        renderTaxonomy();
        return;
    }

    const checkbox = event.target.closest('[data-select-taxonomy]');
    if (!checkbox) return;
    if (checkbox.checked) {
        selectedTaxonomyIds.add(checkbox.dataset.selectTaxonomy);
    } else {
        selectedTaxonomyIds.delete(checkbox.dataset.selectTaxonomy);
    }
    updateSelectionState();
}

function filteredTaxonomy() {
    const search = els.searchInput.value.trim().toLowerCase();
    const type = els.typeFilter.value;
    const verified = els.verifiedFilter.value;
    return taxonomy.filter(item => {
        if (type !== 'all' && item.type !== type) return false;
        if (verified === 'verified' && !item.verified) return false;
        if (verified === 'unverified' && item.verified) return false;
        if (!search) return true;
        return [
            item.id,
            item.label,
            item.type,
            item.parentId,
            item.classId,
            item.subjectId,
            item.chapterId,
            item.topicId
        ].some(value => String(value || '').toLowerCase().includes(search));
    });
}

function openActionDialog(action) {
    const selected = selectedTaxonomy();
    if (!selected.length) return;
    pendingAction = action;
    pendingImportRows = [];
    els.mergeFields.hidden = action !== 'merge';
    els.confirmActionBtn.classList.toggle('danger', action === 'delete');
    if (action === 'merge') {
        const type = selected[0].type;
        const sameType = selected.every(item => item.type === type);
        const candidates = taxonomy.filter(item => item.type === type);
        if (!sameType || !candidates.length) {
            toast(sameType ? 'No compatible merge targets found' : 'Select one taxonomy type before merging');
            pendingAction = null;
            return;
        }
        els.mergeTargetSelect.innerHTML = candidates.map(item => `
            <option value="${esc(item.id)}">${esc(item.label || item.id)} (${esc(item.id)})</option>
        `).join('');
    }

    const actionLabels = {
        verify: ['Mark Taxonomy Verified?', `This will set verified = true on ${selected.length} taxonomy item${selected.length === 1 ? '' : 's'}.`, 'Mark Verified'],
        unverify: ['Remove Verified Flag?', `This will set verified = false on ${selected.length} taxonomy item${selected.length === 1 ? '' : 's'}.`, 'Remove Verified'],
        delete: ['Delete Taxonomy?', `This will hard delete ${selected.length} taxonomy item${selected.length === 1 ? '' : 's'}.`, 'Delete'],
        merge: ['Merge Taxonomy?', `This will update questions that reference the selected taxonomy item${selected.length === 1 ? '' : 's'} to use the chosen target, then delete the old selected taxonomy item${selected.length === 1 ? '' : 's'}. If the target is selected, it will be kept.`, 'Merge']
    };
    const [title, text, button] = actionLabels[action];
    els.confirmTitle.textContent = title;
    els.confirmText.textContent = text;
    els.confirmActionBtn.textContent = button;
    els.previewList.innerHTML = selected.map(item => taxonomyPreview(item)).join('');
    els.confirmDialog.showModal();
}

async function runPendingAction(event) {
    event.preventDefault();
    const selected = selectedTaxonomy();
    if (!pendingAction) return;
    if (pendingAction !== 'import' && !selected.length) return;
    els.confirmActionBtn.disabled = true;
    try {
        if (pendingAction === 'delete') {
            for (const item of selected) await deleteTaxonomy(item);
            toast('Selected taxonomy deleted');
        } else if (pendingAction === 'merge') {
            await mergeTaxonomy(selected, els.mergeTargetSelect.value);
            toast('Taxonomy merged');
        } else if (pendingAction === 'import') {
            await importTaxonomyRows(pendingImportRows);
            toast(`${pendingImportRows.length} taxonomy item${pendingImportRows.length === 1 ? '' : 's'} imported`);
            await loadData();
        } else {
            const verified = pendingAction === 'verify';
            for (const item of selected) {
                await updateDoc(doc(db, COLLECTIONS.taxonomy, item.id), {
                    verified,
                    updatedAt: serverTimestamp(),
                    updatedBy: currentUser.email || currentUser.uid
                });
                item.verified = verified;
            }
            toast(verified ? 'Taxonomy marked verified' : 'Verified flag removed');
        }
        selectedTaxonomyIds = new Set();
        pendingAction = null;
        pendingImportRows = [];
        els.confirmDialog.close();
        renderTaxonomy();
    } catch (error) {
        toast(error.message || 'Unable to update taxonomy');
    } finally {
        els.confirmActionBtn.disabled = false;
    }
}

function exportTaxonomyCsv() {
    const rows = [CSV_COLUMNS];
    filteredTaxonomy().forEach(item => {
        rows.push([
            item.id,
            item.type || '',
            item.label || '',
            item.parentId || '',
            item.classId || '',
            item.subjectId || '',
            item.chapterId || '',
            item.topicId || '',
            item.verified ? 'true' : 'false'
        ]);
    });
    downloadBlob(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }), 'taxonomy.csv');
}

function openImportDialog() {
    els.csvPasteInput.value = '';
    els.csvFileInput.value = '';
    els.importDialog.showModal();
}

async function copyImportPrompt() {
    try {
        await navigator.clipboard.writeText(AI_IMPORT_PROMPT);
        toast('AI prompt copied');
    } catch (error) {
        els.csvPasteInput.value = AI_IMPORT_PROMPT;
        toast('Prompt placed in CSV box');
    }
}

async function readCsvFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    els.csvPasteInput.value = await file.text();
}

function previewImportCsv(event) {
    event.preventDefault();
    const csv = els.csvPasteInput.value.trim();
    if (!csv) {
        toast('Paste CSV or choose a CSV file');
        return;
    }
    try {
        const rows = parseCsv(csv);
        pendingImportRows = taxonomyRowsFromCsv(rows);
        if (!pendingImportRows.length) {
            toast('No valid taxonomy rows found');
            return;
        }
        pendingAction = 'import';
        els.mergeFields.hidden = true;
        els.confirmActionBtn.classList.remove('danger');
        els.confirmTitle.textContent = 'Import Taxonomy?';
        els.confirmText.textContent = `This will create or update ${pendingImportRows.length} taxonomy item${pendingImportRows.length === 1 ? '' : 's'} in qb_taxonomy_v1.`;
        els.confirmActionBtn.textContent = 'Import';
        els.previewList.innerHTML = pendingImportRows.map(item => taxonomyPreview(item)).join('');
        els.importDialog.close();
        els.confirmDialog.showModal();
    } catch (error) {
        toast(error.message || 'Unable to parse CSV');
    }
}

async function importTaxonomyRows(rows) {
    for (const item of rows) {
        await setDoc(doc(db, COLLECTIONS.taxonomy, item.id), {
            type: item.type,
            label: item.label,
            parentId: item.parentId,
            classId: item.classId,
            subjectId: item.subjectId,
            chapterId: item.chapterId,
            topicId: item.topicId,
            verified: item.verified,
            updatedAt: serverTimestamp(),
            updatedBy: currentUser.email || currentUser.uid
        }, { merge: true });
    }
}

function taxonomyRowsFromCsv(rows) {
    if (rows.length < 2) return [];
    const headers = rows[0].map(normalizeHeader);
    const seen = new Set();
    return rows.slice(1).map(row => {
        const record = Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']));
        return taxonomyCsvData(record);
    }).filter(item => {
        if (!item.id || !item.label || !TAXONOMY_TYPES.includes(item.type) || seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
    });
}

function taxonomyCsvData(record) {
    const type = String(record.type || '').trim().toLowerCase();
    const id = String(record.id || record.taxonomyid || '').trim();
    const item = {
        id,
        type,
        label: String(record.label || record.name || '').trim(),
        parentId: String(record.parentid || '').trim(),
        classId: String(record.classid || '').trim(),
        subjectId: String(record.subjectid || '').trim(),
        chapterId: String(record.chapterid || '').trim(),
        topicId: String(record.topicid || '').trim(),
        verified: parseBoolean(record.verified, false)
    };
    if (type === 'class' && !item.classId) item.classId = id;
    if (type === 'subject' && !item.subjectId) item.subjectId = id;
    if (type === 'chapter' && !item.chapterId) item.chapterId = id;
    if (type === 'topic' && !item.topicId) item.topicId = id;
    return item;
}

async function deleteTaxonomy(item) {
    await deleteDoc(doc(db, COLLECTIONS.taxonomy, item.id));
    taxonomy = taxonomy.filter(current => current.id !== item.id);
}

async function mergeTaxonomy(selected, targetId) {
    const target = taxonomy.find(item => item.id === targetId);
    if (!target) throw new Error('Choose a merge target');
    const sources = selected.filter(item => item.id !== target.id);
    if (!sources.length) throw new Error('Select at least one old taxonomy item in addition to the target');
    for (const oldItem of sources) {
        if (oldItem.type !== target.type) throw new Error('Merge target must use the same taxonomy type');
        const field = FIELD_BY_TYPE[oldItem.type];
        if (!field) throw new Error('Unsupported taxonomy type');
        const refs = questionRefs(oldItem);
        for (const question of refs) {
            await updateDoc(doc(db, COLLECTIONS.questions, question.id), {
                [field]: target.id,
                updatedAt: serverTimestamp(),
                updatedBy: currentUser.email || currentUser.uid
            });
            question[field] = target.id;
        }
        await deleteTaxonomy(oldItem);
    }
}

function taxonomyPreview(item) {
    const refs = questionRefs(item);
    return `
        <article class="preview-card">
            <strong>${esc(item.label || item.id)}</strong>
            <dl>
                <div><dt>ID</dt><dd><code>${esc(item.id)}</code></dd></div>
                <div><dt>Type</dt><dd>${esc(item.type || '')}</dd></div>
                <div><dt>Verified</dt><dd>${item.verified ? 'true' : 'false'}</dd></div>
                <div><dt>Parent</dt><dd><code>${esc(item.parentId || '')}</code></dd></div>
                <div><dt>Question refs</dt><dd>${refs.length}</dd></div>
            </dl>
            ${refs.length ? `<div class="preview-snippet">${esc(refSummary(refs))}</div>` : ''}
        </article>
    `;
}

function refSummary(refs) {
    return refs.slice(0, 5).map(question => stripHtml(question.promptHtml || '').slice(0, 80) || question.id).join(' | ');
}

function questionRefs(item) {
    const field = FIELD_BY_TYPE[item.type];
    if (!field) return [];
    return questions.filter(question => question[field] === item.id);
}

function selectedTaxonomy() {
    return taxonomy.filter(item => selectedTaxonomyIds.has(item.id));
}

function updateSelectionState() {
    const selectedCount = selectedTaxonomyIds.size;
    els.selectedCount.textContent = `${selectedCount} selected`;
    [els.markVerifiedBtn, els.removeVerifiedBtn, els.mergeSelectedBtn, els.deleteSelectedBtn].forEach(btn => {
        btn.disabled = selectedCount === 0;
    });
}

function compareTaxonomy(a, b) {
    const typeCompare = String(a.type || '').localeCompare(String(b.type || ''), undefined, { sensitivity: 'base' });
    if (typeCompare !== 0) return typeCompare;
    return String(a.label || a.id).localeCompare(String(b.label || b.id), undefined, { numeric: true, sensitivity: 'base' });
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
    return ['true', '1', 'yes', 'y', 'verified'].includes(text);
}

function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
}

function stripHtml(value) {
    const template = document.createElement('template');
    template.innerHTML = String(value || '');
    return (template.content.textContent || '').replace(/\s+/g, ' ').trim();
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
