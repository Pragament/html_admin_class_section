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
const CSV_COLUMNS = ['id', 'type', 'label', 'parentId', 'verified'];
const AI_IMPORT_PROMPT = `Create a CSV for Firestore qb_taxonomy_v1 import.

Return only valid CSV inside one csv code block, with this exact header:
id,type,label,parentId,verified

Rules:
- type must be one of class, subject, chapter, topic.
- id should be deterministic lowercase snake-style taxonomy id using the parent path.
- parentId should be empty for class rows.
- parentId should be the immediate parent taxonomy id for subject, chapter, and topic rows.
- Do not include separate classId, subjectId, chapterId, or topicId columns; the id is enough and type determines the reference field.
- verified must be true or false.
- Escape commas and quotation marks correctly according to CSV rules.
- Do not include explanations outside the csv code block.`;
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
let mergeMappings = new Map();
let activeMergeSourceId = '';
let mergeType = '';
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
    mergeSourceIncludeInput: $('mergeSourceIncludeInput'),
    mergeSourceExcludeInput: $('mergeSourceExcludeInput'),
    mergeSourceVerifiedFilter: $('mergeSourceVerifiedFilter'),
    mergeSourceCount: $('mergeSourceCount'),
    mergeSourceList: $('mergeSourceList'),
    mergeTargetIncludeInput: $('mergeTargetIncludeInput'),
    mergeTargetExcludeInput: $('mergeTargetExcludeInput'),
    mergeTargetVerifiedFilter: $('mergeTargetVerifiedFilter'),
    mergeTargetCount: $('mergeTargetCount'),
    mergeTargetList: $('mergeTargetList'),
    importOptions: $('importOptions'),
    importOnlyNewInput: $('importOnlyNewInput'),
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
    els.importOnlyNewInput.addEventListener('change', renderImportPreview);
    els.markVerifiedBtn.addEventListener('click', () => openActionDialog('verify'));
    els.removeVerifiedBtn.addEventListener('click', () => openActionDialog('unverify'));
    els.mergeSelectedBtn.addEventListener('click', () => openActionDialog('merge'));
    els.deleteSelectedBtn.addEventListener('click', () => openActionDialog('delete'));
    [els.searchInput, els.typeFilter, els.verifiedFilter].forEach(el => {
        el.addEventListener('input', renderTaxonomy);
        el.addEventListener('change', renderTaxonomy);
    });
    els.taxonomyTableWrap.addEventListener('change', handleTableSelection);
    [
        els.mergeSourceIncludeInput,
        els.mergeSourceExcludeInput,
        els.mergeSourceVerifiedFilter,
        els.mergeTargetIncludeInput,
        els.mergeTargetExcludeInput,
        els.mergeTargetVerifiedFilter
    ].forEach(el => {
        el.addEventListener('input', renderMergeMapping);
        el.addEventListener('change', renderMergeMapping);
    });
    els.mergeSourceList.addEventListener('click', handleMergeSourceClick);
    els.mergeTargetList.addEventListener('click', handleMergeTargetClick);
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
    mergeMappings = new Map();
    activeMergeSourceId = '';
    mergeType = '';
    els.mergeFields.hidden = action !== 'merge';
    els.importOptions.hidden = true;
    els.confirmActionBtn.disabled = false;
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
        mergeType = type;
        activeMergeSourceId = selected[0].id;
        resetMergeFilters();
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
    els.previewList.innerHTML = action === 'merge' ? '' : selected.map(item => taxonomyPreview(item)).join('');
    if (action === 'merge') renderMergeMapping();
    els.confirmDialog.showModal();
}

function resetMergeFilters() {
    els.mergeSourceIncludeInput.value = '';
    els.mergeSourceExcludeInput.value = '';
    els.mergeSourceVerifiedFilter.value = 'all';
    els.mergeTargetIncludeInput.value = '';
    els.mergeTargetExcludeInput.value = '';
    els.mergeTargetVerifiedFilter.value = 'all';
}

function renderMergeMapping() {
    if (pendingAction !== 'merge') return;
    const selected = selectedTaxonomy();
    const sourceItems = filterMergeItems(
        selected,
        els.mergeSourceIncludeInput.value,
        els.mergeSourceExcludeInput.value,
        els.mergeSourceVerifiedFilter.value
    );
    const targetItems = filterMergeItems(
        taxonomy.filter(item => item.type === mergeType),
        els.mergeTargetIncludeInput.value,
        els.mergeTargetExcludeInput.value,
        els.mergeTargetVerifiedFilter.value
    );
    const targetIds = new Set([...mergeMappings.values()]);

    els.mergeSourceCount.textContent = `${sourceItems.length}/${selected.length}`;
    els.mergeTargetCount.textContent = String(targetItems.length);
    els.mergeSourceList.innerHTML = sourceItems.length
        ? sourceItems.map(item => mergeSourceRow(item, targetIds)).join('')
        : '<div class="empty-card">No selected sources match these filters.</div>';
    els.mergeTargetList.innerHTML = targetItems.length
        ? targetItems.map(item => mergeTargetRow(item)).join('')
        : '<div class="empty-card">No targets match these filters.</div>';

    els.confirmActionBtn.disabled = !mergeMappingIsReady(selected);
}

function filterMergeItems(items, includeValue, excludeValue, verified) {
    const include = String(includeValue || '').trim().toLowerCase();
    const exclude = String(excludeValue || '').trim().toLowerCase();
    return items.filter(item => {
        if (verified === 'verified' && !item.verified) return false;
        if (verified === 'unverified' && item.verified) return false;
        if (include && !taxonomyMatchesSearch(item, include)) return false;
        if (exclude && taxonomyMatchesSearch(item, exclude)) return false;
        return true;
    });
}

function taxonomyMatchesSearch(item, search) {
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
}

function mergeSourceRow(item, targetIds) {
    const targetId = mergeMappings.get(item.id) || '';
    const target = targetId ? taxonomy.find(current => current.id === targetId) : null;
    const keptAsTarget = targetIds.has(item.id) && !targetId;
    const active = item.id === activeMergeSourceId;
    const mappedText = target
        ? `to ${target.label || target.id}`
        : (keptAsTarget ? 'Kept as target' : 'Choose target');
    return `
        <button class="merge-row ${active ? 'active' : ''} ${target || keptAsTarget ? 'mapped' : ''}" type="button" data-merge-source="${esc(item.id)}">
            <span>
                <strong>${esc(item.label || item.id)}</strong>
                <code>${esc(item.id)}</code>
            </span>
            <small>${esc(mappedText)}</small>
        </button>
    `;
}

function mergeTargetRow(item) {
    const activeSource = taxonomy.find(current => current.id === activeMergeSourceId);
    const disabled = activeSource && activeSource.type !== item.type;
    const mappedFrom = [...mergeMappings.entries()]
        .filter(([sourceId, targetId]) => targetId === item.id && sourceId !== item.id)
        .map(([sourceId]) => taxonomy.find(current => current.id === sourceId)?.label || sourceId);
    return `
        <button class="merge-row ${disabled ? 'disabled' : ''}" type="button" data-merge-target="${esc(item.id)}" ${disabled ? 'disabled' : ''}>
            <span>
                <strong>${esc(item.label || item.id)}</strong>
                <code>${esc(item.id)}</code>
            </span>
            <small>${item.verified ? 'Verified' : 'Unverified'}${mappedFrom.length ? ` | ${esc(mappedFrom.length)} mapped` : ''}</small>
        </button>
    `;
}

function handleMergeSourceClick(event) {
    const row = event.target.closest('[data-merge-source]');
    if (!row) return;
    activeMergeSourceId = row.dataset.mergeSource;
    renderMergeMapping();
}

function handleMergeTargetClick(event) {
    const row = event.target.closest('[data-merge-target]');
    if (!row || !activeMergeSourceId) return;
    const source = taxonomy.find(item => item.id === activeMergeSourceId);
    const target = taxonomy.find(item => item.id === row.dataset.mergeTarget);
    if (!source || !target) return;
    if (source.type !== target.type) {
        toast('Source and target must use the same taxonomy type');
        return;
    }
    mergeMappings.set(source.id, target.id);
    activeMergeSourceId = nextUnresolvedMergeSourceId(source.id);
    renderMergeMapping();
}

function nextUnresolvedMergeSourceId(fallbackId = '') {
    const selected = selectedTaxonomy();
    const targetIds = new Set([...mergeMappings.entries()]
        .filter(([sourceId, targetId]) => sourceId !== targetId)
        .map(([, targetId]) => targetId));
    const next = selected.find(item => !mergeMappings.has(item.id) && !targetIds.has(item.id));
    return next?.id || fallbackId;
}

function mergeMappingIsReady(selected) {
    try {
        mergeMappingsForSubmit(selected);
        return true;
    } catch {
        return false;
    }
}

function mergeMappingsForSubmit(selected) {
    const selectedIds = new Set(selected.map(item => item.id));
    const targetIds = new Set([...mergeMappings.entries()]
        .filter(([sourceId, targetId]) => sourceId !== targetId)
        .map(([, targetId]) => targetId));
    const unresolved = selected.filter(item => !mergeMappings.has(item.id) && !targetIds.has(item.id));
    if (unresolved.length) {
        throw new Error(`Choose targets for ${unresolved.length} selected source${unresolved.length === 1 ? '' : 's'}`);
    }

    const mappings = [...mergeMappings.entries()]
        .filter(([sourceId, targetId]) => sourceId !== targetId)
        .map(([sourceId, targetId]) => {
            const source = taxonomy.find(item => item.id === sourceId);
            const target = taxonomy.find(item => item.id === targetId);
            if (!source || !target) throw new Error('Merge mapping includes a missing taxonomy item');
            if (!selectedIds.has(source.id)) throw new Error('Merge source must be selected');
            if (source.type !== target.type) throw new Error('Source and target must use the same taxonomy type');
            return { source, target };
        });
    if (!mappings.length) throw new Error('Map at least one source to a different target');
    return mappings;
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
            const mappings = mergeMappingsForSubmit(selected);
            await mergeTaxonomyMappings(mappings);
            toast('Taxonomy merged');
        } else if (pendingAction === 'import') {
            const rowsToImport = importRowsForCurrentMode();
            if (!rowsToImport.length) {
                toast('No new taxonomy items to import');
                return;
            }
            await importTaxonomyRows(rowsToImport);
            toast(`${rowsToImport.length} taxonomy item${rowsToImport.length === 1 ? '' : 's'} imported`);
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
    const csv = csvPayloadFromText(els.csvPasteInput.value);
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
        els.importOptions.hidden = false;
        els.importOnlyNewInput.checked = false;
        els.confirmActionBtn.classList.remove('danger');
        els.confirmTitle.textContent = 'Import Taxonomy?';
        els.confirmActionBtn.textContent = 'Import';
        renderImportPreview();
        els.importDialog.close();
        els.confirmDialog.showModal();
    } catch (error) {
        toast(error.message || 'Unable to parse CSV');
    }
}

function renderImportPreview() {
    if (pendingAction !== 'import') return;
    const summary = importSummary(pendingImportRows);
    const rowsToShow = importRowsForCurrentMode();
    els.confirmText.textContent = els.importOnlyNewInput.checked
        ? `This CSV has ${summary.newCount} new and ${summary.existingCount} existing taxonomy item${pendingImportRows.length === 1 ? '' : 's'}. Only the ${rowsToShow.length} new item${rowsToShow.length === 1 ? '' : 's'} will be imported.`
        : `This CSV has ${summary.newCount} new and ${summary.existingCount} existing taxonomy item${pendingImportRows.length === 1 ? '' : 's'}. Importing all will create new items and update existing ones.`;
    els.previewList.innerHTML = rowsToShow.length
        ? rowsToShow.map(item => taxonomyImportPreview(item)).join('')
        : '<div class="empty-card">No new taxonomy items found in this CSV.</div>';
    els.confirmActionBtn.disabled = rowsToShow.length === 0;
}

function importRowsForCurrentMode() {
    if (!els.importOnlyNewInput.checked) return pendingImportRows;
    return pendingImportRows.filter(item => !existingTaxonomyItem(item.id));
}

function importSummary(rows) {
    return rows.reduce((summary, item) => {
        if (existingTaxonomyItem(item.id)) {
            summary.existingCount += 1;
        } else {
            summary.newCount += 1;
        }
        return summary;
    }, { newCount: 0, existingCount: 0 });
}

async function importTaxonomyRows(rows) {
    for (const item of rows) {
        await setDoc(doc(db, COLLECTIONS.taxonomy, item.id), {
            ...taxonomyWriteData(item),
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
        verified: parseBoolean(record.verified, false)
    };
    return item;
}

function taxonomyWriteData(item) {
    const data = {
        type: item.type,
        label: item.label,
        parentId: item.parentId
    };
    const field = FIELD_BY_TYPE[item.type];
    if (field) data[field] = item.id;
    return data;
}

async function deleteTaxonomy(item) {
    await deleteDoc(doc(db, COLLECTIONS.taxonomy, item.id));
    taxonomy = taxonomy.filter(current => current.id !== item.id);
}

async function mergeTaxonomyMappings(mappings) {
    for (const { source: oldItem, target } of mappings) {
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

function taxonomyImportPreview(item) {
    const existing = existingTaxonomyItem(item.id);
    const refs = existing ? questionRefs(existing) : [];
    return `
        <article class="preview-card">
            <div class="preview-card-head">
                <strong>${esc(item.label || item.id)}</strong>
                <span class="status-chip ${existing ? 'neutral' : 'enabled'}">${existing ? 'Existing' : 'New'}</span>
            </div>
            <dl>
                <div><dt>ID</dt><dd><code>${esc(item.id)}</code></dd></div>
                <div><dt>Type</dt><dd>${importFieldPreview('type', item, existing)}</dd></div>
                <div><dt>Label</dt><dd>${importFieldPreview('label', item, existing)}</dd></div>
                <div><dt>Parent</dt><dd>${importFieldPreview('parentId', item, existing, true)}</dd></div>
                <div><dt>Verified</dt><dd>${importFieldPreview('verified', item, existing)}</dd></div>
                <div><dt>Question refs</dt><dd>${refs.length}</dd></div>
            </dl>
            ${existing && refs.length ? `<div class="preview-snippet">${esc(refSummary(refs))}</div>` : ''}
        </article>
    `;
}

function importFieldPreview(field, incoming, existing, code = false) {
    const incomingValue = field === 'verified' ? String(Boolean(incoming[field])) : String(incoming[field] || '');
    if (!existing) return code ? `<code>${esc(incomingValue)}</code>` : esc(incomingValue);
    const existingValue = field === 'verified' ? String(Boolean(existing[field])) : String(existing[field] || '');
    const incomingHtml = code ? `<code>${esc(incomingValue)}</code>` : esc(incomingValue);
    if (incomingValue === existingValue) return incomingHtml;
    const existingHtml = existingValue
        ? (code ? `<code>${esc(existingValue)}</code>` : esc(existingValue))
        : '(empty)';
    return `<span class="field-change"><span>${incomingHtml}</span><small>Existing: ${existingHtml}</small></span>`;
}

function existingTaxonomyItem(id) {
    return taxonomy.find(item => item.id === id);
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

function csvPayloadFromText(text) {
    const raw = String(text || '').trim();
    const csvBlock = raw.match(/```csv\s*([\s\S]*?)```/i) || raw.match(/```\s*([\s\S]*?)```/);
    return (csvBlock ? csvBlock[1] : raw).trim();
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
