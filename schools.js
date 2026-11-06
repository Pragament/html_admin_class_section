import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
const app = initializeApp(firebaseConfig), auth = getAuth(app), db = getFirestore(app);
const $ = id => document.getElementById(id), kind = document.body.dataset.kind;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
let records = [], organisations = [], editing = false, busy = false;
const status = message => { $('status').textContent = message; };
async function api(data) {
    const response = await fetch('/api/manageSchoolStructure', { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await auth.currentUser.getIdToken()}` },
        body: JSON.stringify({ kind, ...data }) });
    let result;
    try { result = await response.json(); } catch { throw new Error('Start the local admin server with npm start.'); }
    if (!response.ok) throw new Error(result.error?.message || 'Unable to save school record.');
    return result.data;
}
function reset() {
    $('schoolForm').reset(); editing = false; $('code').readOnly = false;
    if ($('orgId')) $('orgId').disabled = false;
    $('formTitle').textContent = `New ${kind}`;
}
function render() {
    const search = $('search').value.trim().toLowerCase();
    const visible = records.filter(row => [row.code, row.name, row.orgId].some(value => String(value || '').toLowerCase().includes(search)));
    $('records').innerHTML = visible.length ? `<table class="section-table"><thead><tr><th>Code</th><th>Name</th>${kind === 'branch' ? '<th>Organisation</th>' : ''}<th>Address</th><th>Status</th><th>Actions</th></tr></thead><tbody>${visible.map(row => `<tr><td>${esc(row.code)}</td><td>${esc(row.name)}</td>${kind === 'branch' ? `<td>${esc(organisations.find(org => org.code === row.orgId)?.name || row.orgId)}</td>` : ''}<td>${esc(row.address)}</td><td>${row.enabled === false ? 'Disabled' : 'Enabled'}</td><td><button class="btn small" data-edit="${esc(row.code)}">Edit</button> <button class="btn small danger" data-delete="${esc(row.code)}">Delete</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty-card">No matching records.</div>';
}
async function load() {
    if (!auth.currentUser || busy) return;
    status('Loading…');
    try {
        const user = auth.currentUser;
        const [rows, orgs] = await Promise.all([getDocs(collection(db, kind === 'branch' ? 'schoolBranches' : 'schoolOrganisations')),
            kind === 'branch' ? getDocs(collection(db, 'schoolOrganisations')) : Promise.resolve(null)]);
        if (auth.currentUser !== user) return;
        records = rows.docs.map(doc => ({ ...doc.data(), code: doc.id })).sort((a,b) => a.code.localeCompare(b.code));
        organisations = orgs ? orgs.docs.map(doc => ({ ...doc.data(), code: doc.id })) : [];
        if ($('orgId')) { const selected = $('orgId').value; $('orgId').innerHTML = '<option value="">Choose organisation</option>' + organisations.map(org => `<option value="${esc(org.code)}">${esc(org.name)} (${esc(org.code)})</option>`).join(''); $('orgId').value = selected; }
        render(); status(`${records.length} records loaded`);
    } catch(error) { records = []; $('records').textContent = error.message; status(error.message); }
}
$('login').onclick = () => signInWithPopup(auth, new GoogleAuthProvider()).catch(error => status(error.message));
$('logout').onclick = () => signOut(auth);
$('refresh').onclick = load;
$('search').oninput = render;
$('cancel').onclick = () => { if (!busy) reset(); };
$('schoolForm').onsubmit = async event => {
    event.preventDefault(); if (busy) return;
    busy = true; $('save').disabled = true;
    try { await api({ action: 'save', create: !editing, code: $('code').value, name: $('name').value,
        address: $('address').value, enabled: $('enabled').checked, ...($('orgId') ? { orgId: $('orgId').value } : {}) }); reset(); status('Saved.'); }
    catch(error) { status(error.message); }
    finally { busy = false; $('save').disabled = false; }
    // Keep an error message visible until the next explicit refresh.
    if (!editing && !$('code').value) await load();
};
$('records').onclick = async event => {
    if (busy) return;
    const edit = event.target.closest('[data-edit]'), remove = event.target.closest('[data-delete]');
    if (edit) { const row = records.find(row => row.code === edit.dataset.edit); if (!row) return;
        editing = true; $('formTitle').textContent = `Edit ${kind}`;
        for (const key of ['code','name','address']) $(key).value = row[key] || '';
        $('enabled').checked = row.enabled !== false; $('code').readOnly = true;
        if ($('orgId')) { $('orgId').value = row.orgId; $('orgId').disabled = true; }
        $('name').focus();
    }
    if (remove && confirm(`Delete ${kind} ${remove.dataset.delete}? Records with children cannot be deleted.`)) {
        busy = true;
        try { await api({ action: 'delete', code: remove.dataset.delete }); reset(); busy = false; await load(); }
        catch(error) { status(error.message); }
        finally { busy = false; }
    }
};
onAuthStateChanged(auth, user => { $('dashboard').hidden = !user; $('logout').hidden = !user; $('login').hidden = Boolean(user); reset(); records = []; if (user) load(); else { $('records').textContent = ''; status('Sign in to manage school records'); } });
