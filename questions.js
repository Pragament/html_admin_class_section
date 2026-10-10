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
    serverTimestamp,
    updateDoc,
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
    questions: 'qb_questions_v1',
    reactions: 'qb_reactions_v1'
};

const ADMIN_EMAILS = [];

const EXPORT_COLUMNS = [
    { key: 'id', label: 'ID', value: question => question.id },
    { key: 'question', label: 'Question', value: question => fullQuestionText(question) },
    { key: 'correctAnswer', label: 'Correct Answer', value: question => correctAnswerText(question) },
    { key: 'explanation', label: 'Explanations', value: question => question.explanation || '' },
    { key: 'type', label: 'Type', value: question => typeLabel(question.type) },
    { key: 'difficulty', label: 'Difficulty', value: question => question.difficulty || '' },
    { key: 'status', label: 'Status', value: question => question.status || '' },
    { key: 'verified', label: 'Verified', value: question => question.verified ? 'true' : 'false' },
    { key: 'likes', label: 'Likes', value: question => reactionCounts(question.id).likes },
    { key: 'dislikes', label: 'Dislikes', value: question => reactionCounts(question.id).dislikes },
    { key: 'taxonomy', label: 'Taxonomy', value: question => taxonomyPath(question) },
    { key: 'author', label: 'Author', value: question => question.authorName || question.authorUid || '' }
];

// CSV headers (normalized) that import is allowed to write back to the question document.
const IMPORT_FIELDS = {
    explanations: { field: 'explanation', parse: value => String(value ?? '').trim() },
    explanation: { field: 'explanation', parse: value => String(value ?? '').trim() },
    difficulty: { field: 'difficulty', parse: value => String(value ?? '').trim() },
    status: { field: 'status', parse: value => String(value ?? '').trim().toLowerCase() },
    verified: { field: 'verified', parse: value => parseBoolean(value) }
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let questions = [];
let reactionsByQuestion = new Map();
let selectedQuestionIds = new Set();
let pendingAction = null;
let pendingImport = [];
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
    markVerifiedBtn: $('markVerifiedBtn'),
    removeVerifiedBtn: $('removeVerifiedBtn'),
    deleteSelectedBtn: $('deleteSelectedBtn'),
    exportBtn: $('exportBtn'),
    importInput: $('importInput'),
    exportDialog: $('exportDialog'),
    exportForm: $('exportForm'),
    exportColumnList: $('exportColumnList'),
    exportFilteredLabel: $('exportFilteredLabel'),
    exportSelectedLabel: $('exportSelectedLabel'),
    exportSelectAllBtn: $('exportSelectAllBtn'),
    exportSelectNoneBtn: $('exportSelectNoneBtn'),
    cancelExportBtn: $('cancelExportBtn'),
    searchInput: $('searchInput'),
    statusFilter: $('statusFilter'),
    typeFilter: $('typeFilter'),
    verifiedFilter: $('verifiedFilter'),
    likesFilter: $('likesFilter'),
    dislikesFilter: $('dislikesFilter'),
    questionCount: $('questionCount'),
    selectedCount: $('selectedCount'),
    questionTableWrap: $('questionTableWrap'),
    confirmDialog: $('confirmDialog'),
    confirmForm: $('confirmForm'),
    confirmTitle: $('confirmTitle'),
    confirmText: $('confirmText'),
    previewList: $('previewList'),
    cancelActionBtn: $('cancelActionBtn'),
    confirmActionBtn: $('confirmActionBtn'),
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
        reactionsByQuestion = new Map();
        selectedQuestionIds = new Set();
        setStatus('Sign in with Google');
        renderQuestions();
        return;
    }

    if (!allowed) {
        questions = [];
        reactionsByQuestion = new Map();
        selectedQuestionIds = new Set();
        await signOut(auth);
        toast('This Google account is not allowed for admin access');
        renderQuestions();
        return;
    }

    els.adminLabel.textContent = user.email || user.displayName || user.uid;
    await loadData();
});

function bindEvents() {
    els.loginBtn.addEventListener('click', login);
    els.logoutBtn.addEventListener('click', () => signOut(auth));
    els.refreshBtn.addEventListener('click', loadData);
    els.markVerifiedBtn.addEventListener('click', () => openActionDialog('verify'));
    els.removeVerifiedBtn.addEventListener('click', () => openActionDialog('unverify'));
    els.deleteSelectedBtn.addEventListener('click', () => openActionDialog('delete'));
    els.exportBtn.addEventListener('click', openExportDialog);
    els.exportSelectAllBtn.addEventListener('click', () => setExportColumns(true));
    els.exportSelectNoneBtn.addEventListener('click', () => setExportColumns(false));
    els.cancelExportBtn.addEventListener('click', () => els.exportDialog.close());
    els.exportForm.addEventListener('submit', exportCsv);
    els.importInput.addEventListener('change', importCsv);
    [els.searchInput, els.statusFilter, els.typeFilter, els.verifiedFilter, els.likesFilter, els.dislikesFilter].forEach(el => {
        el.addEventListener('input', renderQuestions);
        el.addEventListener('change', renderQuestions);
    });
    els.questionTableWrap.addEventListener('change', handleTableSelection);
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
    setStatus('Loading questions and reactions...');
    try {
        const [questionSnap, reactionSnap] = await Promise.all([
            getDocs(collection(db, COLLECTIONS.questions)),
            getDocs(collection(db, COLLECTIONS.reactions))
        ]);
        questions = questionSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort(compareQuestions);
        reactionsByQuestion = buildReactionCounts(reactionSnap.docs.map(d => d.data()));
        selectedQuestionIds = new Set([...selectedQuestionIds].filter(id => questions.some(question => question.id === id)));
        renderQuestions();
        setStatus(`${questions.length} question${questions.length === 1 ? '' : 's'} loaded`);
    } catch (error) {
        questions = [];
        reactionsByQuestion = new Map();
        selectedQuestionIds = new Set();
        renderQuestions();
        setStatus(error.message || 'Unable to load questions');
        toast('Unable to load questions');
    }
}

function renderQuestions() {
    const visible = filteredQuestions();
    els.questionCount.textContent = String(visible.length);
    els.questionTableWrap.innerHTML = visible.length ? `
        <table class="section-table moderation-table">
            <thead>
                <tr>
                    <th scope="col"><input type="checkbox" data-select-all ${visible.every(question => selectedQuestionIds.has(question.id)) ? 'checked' : ''} /></th>
                    <th scope="col">Question</th>
                    <th scope="col">Correct Answer</th>
                    <th scope="col">Explanations</th>
                    <th scope="col">Type</th>
                    <th scope="col">Difficulty</th>
                    <th scope="col">Status</th>
                    <th scope="col">Verified</th>
                    <th scope="col">Likes</th>
                    <th scope="col">Dislikes</th>
                    <th scope="col">Taxonomy</th>
                    <th scope="col">Author</th>
                    <th scope="col">ID</th>
                </tr>
            </thead>
            <tbody>
                ${visible.map(question => {
                    const counts = reactionCounts(question.id);
                    return `
                        <tr>
                            <td><input type="checkbox" data-select-question="${esc(question.id)}" ${selectedQuestionIds.has(question.id) ? 'checked' : ''} /></td>
                            <td><div class="preview-snippet">${esc(questionText(question))}</div></td>
                            <td><div class="preview-snippet">${esc(correctAnswerText(question)) || '<em>No answer stored</em>'}</div></td>
                            <td><div class="preview-snippet">${esc(question.explanation || '')}</div></td>
                            <td>${esc(typeLabel(question.type))}</td>
                            <td>${esc(question.difficulty || '')}</td>
                            <td>${esc(question.status || '')}</td>
                            <td><span class="status-chip ${question.verified ? 'enabled' : 'disabled'}">${question.verified ? 'Verified' : 'Unverified'}</span></td>
                            <td>${counts.likes}</td>
                            <td>${counts.dislikes}</td>
                            <td>${esc(taxonomyPath(question))}</td>
                            <td>${esc(question.authorName || question.authorUid || '')}</td>
                            <td><code>${esc(question.id)}</code></td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    ` : '<div class="empty-card">No questions found.</div>';
    updateSelectionState();
}

function handleTableSelection(event) {
    const selectAll = event.target.closest('[data-select-all]');
    if (selectAll) {
        filteredQuestions().forEach(question => {
            if (selectAll.checked) {
                selectedQuestionIds.add(question.id);
            } else {
                selectedQuestionIds.delete(question.id);
            }
        });
        renderQuestions();
        return;
    }

    const checkbox = event.target.closest('[data-select-question]');
    if (!checkbox) return;
    if (checkbox.checked) {
        selectedQuestionIds.add(checkbox.dataset.selectQuestion);
    } else {
        selectedQuestionIds.delete(checkbox.dataset.selectQuestion);
    }
    updateSelectionState();
}

function filteredQuestions() {
    const search = els.searchInput.value.trim().toLowerCase();
    const status = els.statusFilter.value;
    const type = els.typeFilter.value;
    const verified = els.verifiedFilter.value;
    const minLikes = numberFilter(els.likesFilter.value);
    const minDislikes = numberFilter(els.dislikesFilter.value);

    return questions.filter(question => {
        const counts = reactionCounts(question.id);
        if (status !== 'all' && question.status !== status) return false;
        if (type !== 'all' && question.type !== type) return false;
        if (verified === 'verified' && !question.verified) return false;
        if (verified === 'unverified' && question.verified) return false;
        if (counts.likes < minLikes) return false;
        if (counts.dislikes < minDislikes) return false;
        if (!search) return true;
        return [
            question.id,
            questionText(question),
            question.type,
            question.difficulty,
            question.status,
            question.authorName,
            question.authorUid,
            taxonomyPath(question),
            question.classId,
            question.subjectId,
            question.chapterId,
            question.topicId
        ].some(value => String(value || '').toLowerCase().includes(search));
    });
}

function openActionDialog(action) {
    const selected = selectedQuestions();
    if (!selected.length) return;
    pendingAction = action;
    const actionLabels = {
        verify: ['Mark Questions Verified?', `This will set verified = true on ${selected.length} question${selected.length === 1 ? '' : 's'}.`, 'Mark Verified'],
        unverify: ['Remove Verified Flag?', `This will set verified = false on ${selected.length} question${selected.length === 1 ? '' : 's'}.`, 'Remove Verified'],
        delete: ['Delete Questions?', `This will hard delete ${selected.length} question${selected.length === 1 ? '' : 's'} from qb_questions_v1.`, 'Delete']
    };
    const [title, text, button] = actionLabels[action];
    els.confirmTitle.textContent = title;
    els.confirmText.textContent = text;
    els.confirmActionBtn.textContent = button;
    els.confirmActionBtn.classList.toggle('danger', action === 'delete');
    els.previewList.innerHTML = selected.map(question => questionPreview(question)).join('');
    els.confirmDialog.showModal();
}

async function runPendingAction(event) {
    event.preventDefault();
    const selected = selectedQuestions();
    if (!pendingAction || (pendingAction !== 'import' && !selected.length)) return;
    els.confirmActionBtn.disabled = true;
    try {
        if (pendingAction === 'import') {
            for (const change of pendingImport) {
                await updateDoc(doc(db, COLLECTIONS.questions, change.question.id), {
                    ...change.updates,
                    updatedAt: serverTimestamp(),
                    updatedBy: currentUser.email || currentUser.uid
                });
                Object.assign(change.question, change.updates);
            }
            toast(`${pendingImport.length} question${pendingImport.length === 1 ? '' : 's'} updated from CSV`);
            pendingImport = [];
        } else if (pendingAction === 'delete') {
            for (const question of selected) {
                await deleteReactionsForQuestion(question.id);
                await deleteDoc(doc(db, COLLECTIONS.questions, question.id));
            }
            questions = questions.filter(question => !selectedQuestionIds.has(question.id));
            toast('Selected questions deleted');
        } else {
            const verified = pendingAction === 'verify';
            for (const question of selected) {
                await updateDoc(doc(db, COLLECTIONS.questions, question.id), {
                    verified,
                    updatedAt: serverTimestamp(),
                    updatedBy: currentUser.email || currentUser.uid
                });
                question.verified = verified;
            }
            toast(verified ? 'Questions marked verified' : 'Verified flag removed');
        }
        if (pendingAction !== 'import') selectedQuestionIds = new Set();
        pendingAction = null;
        els.confirmDialog.close();
        renderQuestions();
    } catch (error) {
        toast(error.message || 'Unable to update selected questions');
    } finally {
        els.confirmActionBtn.disabled = false;
    }
}

function openExportDialog() {
    const filteredCount = filteredQuestions().length;
    const selectedCount = selectedQuestionIds.size;
    els.exportFilteredLabel.textContent = `Filtered questions (${filteredCount})`;
    els.exportSelectedLabel.textContent = `Selected questions (${selectedCount})`;
    els.exportForm.querySelector('[name="exportScope"][value="selected"]').disabled = selectedCount === 0;
    els.exportForm.querySelector(`[name="exportScope"][value="${selectedCount ? 'selected' : 'filtered'}"]`).checked = true;
    els.exportColumnList.innerHTML = EXPORT_COLUMNS.map(column => `
        <label><input type="checkbox" data-export-column="${esc(column.key)}" checked /> ${esc(column.label)}</label>
    `).join('');
    els.exportDialog.showModal();
}

function setExportColumns(checked) {
    els.exportColumnList.querySelectorAll('[data-export-column]').forEach(input => {
        input.checked = checked;
    });
}

function exportCsv(event) {
    event.preventDefault();
    const keys = new Set([...els.exportColumnList.querySelectorAll('[data-export-column]:checked')].map(input => input.dataset.exportColumn));
    const columns = EXPORT_COLUMNS.filter(column => keys.has(column.key));
    if (!columns.length) {
        toast('Choose at least one column');
        return;
    }
    const scope = els.exportForm.querySelector('[name="exportScope"]:checked')?.value;
    const rows = scope === 'selected' ? selectedQuestions() : filteredQuestions();
    if (!rows.length) {
        toast('No questions to export');
        return;
    }
    const csv = toCsv([columns.map(column => column.label)].concat(rows.map(question => columns.map(column => column.value(question)))));
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'questions.csv';
    a.click();
    URL.revokeObjectURL(url);
    els.exportDialog.close();
}

async function importCsv(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
        const rows = parseCsv((await file.text()).replace(/^﻿/, ''));
        if (rows.length < 2) {
            toast('CSV has no rows to import');
            return;
        }
        const headers = rows[0].map(normalizeHeader);
        const idIndex = headers.indexOf('id');
        if (idIndex === -1) {
            toast('CSV needs an ID column');
            return;
        }
        const fieldColumns = headers
            .map((header, index) => ({ index, config: IMPORT_FIELDS[header] }))
            .filter(column => column.config);
        if (!fieldColumns.length) {
            toast('CSV has no importable columns (Explanations, Difficulty, Status, Verified)');
            return;
        }
        const questionsById = new Map(questions.map(question => [question.id, question]));
        const changes = [];
        let skipped = 0;
        for (const row of rows.slice(1)) {
            if (!row.some(cell => String(cell || '').trim())) continue;
            const question = questionsById.get(String(row[idIndex] || '').trim());
            if (!question) {
                skipped += 1;
                continue;
            }
            const updates = {};
            fieldColumns.forEach(({ index, config }) => {
                const value = config.parse(row[index]);
                const current = config.field === 'verified' ? Boolean(question.verified) : (question[config.field] ?? '');
                if (value !== current) updates[config.field] = value;
            });
            if (Object.keys(updates).length) changes.push({ question, updates });
        }
        const skippedText = skipped ? ` ${skipped} row${skipped === 1 ? '' : 's'} with unknown ID skipped.` : '';
        if (!changes.length) {
            toast(`No changes found.${skippedText}`);
            return;
        }
        pendingAction = 'import';
        pendingImport = changes;
        els.confirmTitle.textContent = 'Import Changes?';
        els.confirmText.textContent = `This will update ${changes.length} question${changes.length === 1 ? '' : 's'} in qb_questions_v1.${skippedText}`;
        els.confirmActionBtn.textContent = 'Import';
        els.confirmActionBtn.classList.remove('danger');
        els.previewList.innerHTML = changes.map(importPreview).join('');
        els.confirmDialog.showModal();
    } catch (error) {
        toast(error.message || 'Unable to read CSV');
    }
}

function importPreview({ question, updates }) {
    return `
        <article class="preview-card">
            <strong>${esc(questionText(question))}</strong>
            <dl>
                <div><dt>ID</dt><dd><code>${esc(question.id)}</code></dd></div>
                ${Object.entries(updates).map(([field, value]) => `
                    <div><dt>${esc(field)}</dt><dd>${esc(question[field] ?? '') || '<em>empty</em>'} &rarr; ${esc(value) || '<em>empty</em>'}</dd></div>
                `).join('')}
            </dl>
        </article>
    `;
}

async function deleteReactionsForQuestion(questionId) {
    const snap = await getDocs(query(
        collection(db, COLLECTIONS.reactions),
        where('questionId', '==', questionId)
    ));
    for (const reaction of snap.docs) {
        await deleteDoc(doc(db, COLLECTIONS.reactions, reaction.id));
    }
}

function questionPreview(question) {
    const counts = reactionCounts(question.id);
    return `
        <article class="preview-card">
            <strong>${esc(questionText(question))}</strong>
            <dl>
                <div><dt>ID</dt><dd><code>${esc(question.id)}</code></dd></div>
                <div><dt>Status</dt><dd>${esc(question.status || '')}</dd></div>
                <div><dt>Type</dt><dd>${esc(question.type || '')}</dd></div>
                <div><dt>Difficulty</dt><dd>${esc(question.difficulty || '')}</dd></div>
                <div><dt>Reactions</dt><dd>${counts.likes} likes, ${counts.dislikes} dislikes</dd></div>
                <div><dt>Taxonomy</dt><dd>${esc(taxonomyPath(question))}</dd></div>
                <div><dt>Author</dt><dd>${esc(question.authorName || question.authorUid || '')}</dd></div>
            </dl>
        </article>
    `;
}

function selectedQuestions() {
    return questions.filter(question => selectedQuestionIds.has(question.id));
}

function updateSelectionState() {
    const selectedCount = selectedQuestionIds.size;
    els.selectedCount.textContent = `${selectedCount} selected`;
    [els.markVerifiedBtn, els.removeVerifiedBtn, els.deleteSelectedBtn].forEach(btn => {
        btn.disabled = selectedCount === 0;
    });
}

function buildReactionCounts(reactions) {
    const counts = new Map();
    reactions.forEach(reaction => {
        const questionId = reaction.questionId;
        if (!questionId) return;
        if (!counts.has(questionId)) counts.set(questionId, { likes: 0, dislikes: 0 });
        const current = counts.get(questionId);
        if (reaction.value === 'like') current.likes += 1;
        if (reaction.value === 'dislike') current.dislikes += 1;
    });
    return counts;
}

function reactionCounts(questionId) {
    return reactionsByQuestion.get(questionId) || { likes: 0, dislikes: 0 };
}

function compareQuestions(a, b) {
    return updatedMillis(b) - updatedMillis(a);
}

function updatedMillis(question) {
    return timestampMillis(question.updatedAt) || timestampMillis(question.createdAt);
}

function timestampMillis(value) {
    if (value?.toMillis) return value.toMillis();
    if (value?.toDate) return value.toDate().getTime();
    if (Number.isFinite(Number(value?.seconds))) {
        return (Number(value.seconds) * 1000) + Math.floor(Number(value.nanoseconds || 0) / 1000000);
    }
    return 0;
}

function typeLabel(type) {
    const labels = { mcq: 'MCQ', short_answer: 'Short Answer', fib: 'Fill in the Blank', true_false: 'True / False' };
    return labels[type] || type || '';
}

function correctAnswerText(question) {
    if (question.type === 'mcq') {
        return (question.options || [])
            .map((option, index) => option?.correct ? `${String.fromCharCode(65 + index)}) ${stripHtml(option.html)}` : '')
            .filter(Boolean)
            .join(' | ');
    }
    if (question.type === 'short_answer') return stripHtml(question.shortAnswerHtml);
    if (question.type === 'true_false') {
        return typeof question.trueAnswer === 'boolean' ? (question.trueAnswer ? 'True' : 'False') : '';
    }
    if (question.type === 'fib') {
        return (question.fibBanks || [])
            .map(bank => (bank?.answers || []).join(' / '))
            .filter(Boolean)
            .join('; ');
    }
    return '';
}

function questionText(question) {
    return fullQuestionText(question).slice(0, 220);
}

function fullQuestionText(question) {
    return stripHtml(question.promptHtml || question.prompt || '');
}

function taxonomyPath(question) {
    return [question.classId, question.subjectId, question.chapterId, question.topicId].filter(Boolean).join(' / ');
}

function stripHtml(value) {
    const template = document.createElement('template');
    template.innerHTML = String(value || '');
    return (template.content.textContent || '').replace(/\s+/g, ' ').trim();
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

function parseBoolean(value) {
    return ['true', '1', 'yes', 'y', 'verified'].includes(String(value ?? '').trim().toLowerCase());
}

function numberFilter(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
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
