import { localFirebaseConfig, teamFirebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
    getAuth,
    GoogleAuthProvider,
    signInWithPopup
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
    collection,
    doc,
    DocumentReference,
    getDocs,
    getFirestore,
    writeBatch
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// Collections the admin pages use; `subcollections` are copied under every parent document.
const COLLECTIONS = [
    { name: 'classSections', subcollections: ['students'] },
    { name: 'classrooms' },
    { name: 'qb_questions_v1' },
    { name: 'qb_taxonomy_v1' },
    { name: 'qb_lists_v1' },
    { name: 'qb_reactions_v1' },
    { name: 'qb_quiz_submissions_v1' }
];
const BATCH_SIZE = 400;

const sourceApp = initializeApp(teamFirebaseConfig, 'source');
const sourceAuth = getAuth(sourceApp);
const sourceDb = getFirestore(sourceApp);

const targetApp = localFirebaseConfig ? initializeApp(localFirebaseConfig, 'target') : null;
const targetAuth = targetApp ? getAuth(targetApp) : null;
const targetDb = targetApp ? getFirestore(targetApp) : null;

const els = {
    sourceProject: document.getElementById('sourceProject'),
    targetProject: document.getElementById('targetProject'),
    configWarning: document.getElementById('configWarning'),
    sourceLoginBtn: document.getElementById('sourceLoginBtn'),
    targetLoginBtn: document.getElementById('targetLoginBtn'),
    collectionList: document.getElementById('collectionList'),
    copyBtn: document.getElementById('copyBtn'),
    log: document.getElementById('log')
};

const sameProject = localFirebaseConfig && localFirebaseConfig.projectId === teamFirebaseConfig.projectId;

els.sourceProject.textContent = teamFirebaseConfig.projectId;
els.targetProject.textContent = localFirebaseConfig ? localFirebaseConfig.projectId : '(not configured)';
els.configWarning.hidden = Boolean(localFirebaseConfig);
els.targetLoginBtn.disabled = !targetAuth || sameProject;
els.collectionList.innerHTML = COLLECTIONS.map(({ name, subcollections }) => `
    <label>
        <input type="checkbox" value="${name}" checked />
        ${name}${subcollections ? ` (+ ${subcollections.join(', ')})` : ''}
    </label>
`).join('');

if (sameProject) {
    log('Target project is the same as the source. Use a different project in firebase-config.local.js.');
}

els.sourceLoginBtn.addEventListener('click', () => login(sourceAuth, 'source'));
els.targetLoginBtn.addEventListener('click', () => login(targetAuth, 'target'));
els.copyBtn.addEventListener('click', copySelected);

async function login(auth, label) {
    try {
        const { user } = await signInWithPopup(auth, new GoogleAuthProvider());
        log(`Signed in to ${label} as ${user.email}`);
    } catch (error) {
        log(`Sign-in to ${label} failed: ${error.message}`);
    }
    els.copyBtn.disabled = !(sourceAuth.currentUser && targetAuth?.currentUser) || sameProject;
}

async function copySelected() {
    const selected = [...els.collectionList.querySelectorAll('input:checked')].map(input => input.value);
    if (!selected.length) return;
    if (!confirm(`Copy ${selected.join(', ')} from ${teamFirebaseConfig.projectId} into ${localFirebaseConfig.projectId}?`)) return;

    els.copyBtn.disabled = true;
    try {
        for (const config of COLLECTIONS.filter(({ name }) => selected.includes(name))) {
            const parentIds = await copyCollection(config.name);
            for (const sub of config.subcollections || []) {
                let total = 0;
                for (const parentId of parentIds) {
                    total += (await copyCollection(`${config.name}/${parentId}/${sub}`, false)).length;
                }
                log(`  ${config.name}/*/${sub}: ${total} documents`);
            }
        }
        log('Done.');
    } catch (error) {
        log(`Copy failed: ${error.message}`);
    } finally {
        els.copyBtn.disabled = false;
    }
}

async function copyCollection(path, verbose = true) {
    const snapshot = await getDocs(collection(sourceDb, path));
    let batch = writeBatch(targetDb);
    let pending = 0;

    for (const docSnap of snapshot.docs) {
        batch.set(doc(targetDb, path, docSnap.id), remapRefs(docSnap.data()));
        pending += 1;
        if (pending === BATCH_SIZE) {
            await batch.commit();
            batch = writeBatch(targetDb);
            pending = 0;
        }
    }
    if (pending) await batch.commit();

    if (verbose) log(`${path}: ${snapshot.size} documents`);
    return snapshot.docs.map(docSnap => docSnap.id);
}

// Document references belong to one Firestore instance, so point them at the target project.
function remapRefs(value) {
    if (value instanceof DocumentReference) return doc(targetDb, value.path);
    if (Array.isArray(value)) return value.map(remapRefs);
    if (value && Object.getPrototypeOf(value) === Object.prototype) {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remapRefs(item)]));
    }
    return value;
}

function log(message) {
    els.log.textContent += `${message}\n`;
    els.log.scrollTop = els.log.scrollHeight;
}
