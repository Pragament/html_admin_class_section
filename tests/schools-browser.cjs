// Offline Firebase Auth + local Firestore emulator. No production data is accessed.
// Set FIRESTORE_RULES_TEST_HOST, PLAYWRIGHT_MODULE and optionally PLAYWRIGHT_EXECUTABLE.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createLocalServer } = require('../local-server');
const { createStudentService } = require('../functions/student-service');
(async () => {
    const host = process.env.FIRESTORE_RULES_TEST_HOST;
    assert.match(host, /^(127\.0\.0\.1|localhost):\d+$/);
    process.env.FIRESTORE_EMULATOR_HOST = host;
    const { initializeApp, deleteApp } = require('firebase-admin/app');
    const { getFirestore, FieldValue } = require('firebase-admin/firestore');
    const projectId = 'demo-school-browser';
    await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
    const app = initializeApp({ projectId }, 'school-browser-test'), db = getFirestore(app);
    const service = createStudentService({ db, auth: {}, timestamp: () => FieldValue.serverTimestamp() });
    const server = createLocalServer({ service, root: path.join(__dirname, '..'), auth: { verifyIdToken: async () => ({ uid: 'school-admin', email: 'admin@example.com', role: 'admin' }) } });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE } : {}) });
    try {
        const page = await browser.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.route('**/www.gstatic.com/firebasejs/**', async route => {
            const url = route.request().url();
            let source = '';
            if (url.includes('firebase-app.js')) source = 'export const initializeApp = () => ({});';
            else if (url.includes('firebase-auth.js')) source = `const user={uid:'school-admin',email:'admin@example.com',getIdToken:async()=>'valid'};const auth={currentUser:user}; export const getAuth=()=>auth;export class GoogleAuthProvider{};export const signInWithPopup=async()=>{};export const signOut=async()=>{};export const onAuthStateChanged=(auth,fn)=>{setTimeout(()=>fn(user),0);};`;
            else source = `export const getFirestore=()=>({});export const collection=(db,...parts)=>({path:parts.join('/')});export const doc=(db,...parts)=>({path:parts.join('/')});export const where=(field,op,value)=>({field,op,value});export const query=(ref,...filters)=>({...ref,filters});export const serverTimestamp=()=>null;export const getDocs=async ref=>{const data=await(await fetch('/test-data',{method:'POST',body:JSON.stringify(ref)})).json();const docs=data.map(row=>({id:row.id,data:()=>row.data}));return {docs,size:docs.length};};export const addDoc=async()=>{throw Error('Unexpected direct write')};export const setDoc=addDoc;export const updateDoc=addDoc;export const deleteDoc=addDoc;`;
            await route.fulfill({ contentType: 'text/javascript', body: source });
        });
        await page.route('**/test-data', async route => {
            const ref = route.request().postDataJSON();
            let q = db.collection(ref.path);
            for (const f of ref.filters || []) q = q.where(f.field, f.op, f.value);
            const snapshot = await q.get();
            await route.fulfill({ contentType: 'application/json', body: JSON.stringify(snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() }))) });
        });
        const base = `http://127.0.0.1:${server.address().port}`;
        const screenshotDir = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'school-ui-'));
        await page.goto(`${base}/organisations.html`);
        await page.locator('#dashboard').waitFor({ state: 'visible' });
        await page.fill('#code', 'DSS'); await page.fill('#name', 'DSS School'); await page.click('#save');
        await page.locator('[data-edit="DSS"]').waitFor();
        await page.goto(`${base}/branches.html`);
        await page.locator('#orgId option[value="DSS"]').waitFor({ state: 'attached' });
        await page.fill('#code', 'SGD'); await page.fill('#name', 'Sangareddy'); await page.selectOption('#orgId','DSS'); await page.click('#save');
        await page.locator('[data-edit="SGD"]').waitFor();
        await page.click('[data-edit="SGD"]'); assert.equal(await page.locator('#code').getAttribute('readonly'), '');
        await page.fill('#name','Sangareddy Branch'); await page.click('#save');
        await page.waitForFunction(()=>document.querySelector('#records').textContent.includes('Sangareddy Branch'));
        await page.screenshot({ path: path.join(screenshotDir, 'branches-desktop.png'), fullPage: true });
        await page.goto(`${base}/index.html`);
        await page.locator('#sectionBranch option[value="SGD"]').waitFor({ state: 'attached' });
        await page.click('#newSectionBtn'); await page.selectOption('#sectionBranch','SGD'); await page.fill('#sectionName','Grade 6');
        await page.fill('[data-member-email]','admin@example.com'); await page.selectOption('[data-member-role]','admin'); await page.click('#saveSectionBtn');
        await page.locator('[data-students]').waitFor(); await page.click('[data-students]');
        await page.click('#newStudentBtn'); await page.fill('#studentName','Ananya'); await page.fill('#studentAdmissionNo','00755'); await page.fill('#studentPhone','9666033404');
        assert.equal(await page.inputValue('#studentId'),'SGD-00755');
        await page.uncheck('#studentLinkLogin'); await page.click('#saveStudentBtn');
        await page.waitForFunction(()=>!document.querySelector('#studentDialog').open);
        assert.ok((await page.locator('#studentTableWrap').textContent()).includes('SGD-00755'));
        const csv = (id, admission) => `id,studentName,phone,enabled,email,admissionNo\n${id},Another Student,9876543210,true,,${admission}`;
        await page.setInputFiles('#studentCsvInput',{ name:'invalid.csv',mimeType:'text/csv',buffer:Buffer.from(csv('BAD-756','756')) });
        await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('ID must be SGD-756'));
        const sectionId = (await db.collection('classSections').get()).docs[0].id;
        assert.equal((await db.collection(`classSections/${sectionId}/students`).get()).size,1);
        await page.setInputFiles('#studentCsvInput',{ name:'valid.csv',mimeType:'text/csv',buffer:Buffer.from(csv('SGD-756','756')) });
        await page.waitForFunction(()=>document.querySelector('#studentTableWrap').textContent.includes('SGD-756'));
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`${base}/branches.html`); await page.locator('[data-edit="SGD"]').waitFor();
        await page.screenshot({ path: path.join(screenshotDir, 'branches-mobile.png'), fullPage: true });
        console.log('Screenshots:', screenshotDir);
        assert.deepEqual(errors, []);
        console.log('PASS: organisation create, branch create/edit, section assignment, student ID autofill, invalid-prefix rejection, valid CSV import and mobile page.');
    } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); await db.terminate(); await deleteApp(app); }
})().catch(error => { console.error(error); process.exitCode = 1; });
