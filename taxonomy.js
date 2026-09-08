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
const ADMIN_EMAILS = [];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let questions = [];
let taxonomy = [];
let selectedTaxonomyIds = new Set();
let pendingAction = null;
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
    els.mergeFields.hidden = action !== 'merge';
    els.confirmActionBtn.classList.toggle('danger', action === 'delete');
    if (action === 'merge') {
        const type = selected[0].type;
        const sameType = selected.every(item => item.type === type);
        const candidates = taxonomy.filter(item => item.type === type && !selectedTaxonomyIds.has(item.id));
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
        merge: ['Merge Taxonomy?', `This will update questions that reference the selected taxonomy item${selected.length === 1 ? '' : 's'} to use the chosen target, then delete the old taxonomy item${selected.length === 1 ? '' : 's'}.`, 'Merge']
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
    if (!pendingAction || !selected.length) return;
    els.confirmActionBtn.disabled = true;
    try {
        if (pendingAction === 'delete') {
            for (const item of selected) await deleteTaxonomy(item);
            toast('Selected taxonomy deleted');
        } else if (pendingAction === 'merge') {
            await mergeTaxonomy(selected, els.mergeTargetSelect.value);
            toast('Taxonomy merged');
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
        els.confirmDialog.close();
        renderTaxonomy();
    } catch (error) {
        toast(error.message || 'Unable to update taxonomy');
    } finally {
        els.confirmActionBtn.disabled = false;
    }
}

async function deleteTaxonomy(item) {
    await deleteDoc(doc(db, COLLECTIONS.taxonomy, item.id));
    taxonomy = taxonomy.filter(current => current.id !== item.id);
}

async function mergeTaxonomy(selected, targetId) {
    const target = taxonomy.find(item => item.id === targetId);
    if (!target) throw new Error('Choose a merge target');
    for (const oldItem of selected) {
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
