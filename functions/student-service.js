const { createHash } = require('node:crypto');
const { logFailure } = require('./diagnostics');

class AccountError extends Error {
    constructor(code, message) { super(message); this.code = code; }
}

// Dependencies are supplied by either the local server or Cloud Functions.
function createStudentService({ db, auth, timestamp, logger = console }) {
async function atStage(stage, run) {
    try { return await run(); }
    catch (cause) {
        const exhausted = Number(cause?.code) === 8 || /RESOURCE_EXHAUSTED|quota exceeded/i.test(cause?.message || '');
        const error = new AccountError(exhausted ? 'resource-exhausted' : 'internal', exhausted
            ? 'Firestore quota exceeded. Check project usage and quotas before retrying. This read could not complete.'
            : 'Backend request failed. See the server terminal for diagnostics.');
        error.cause = cause;
        error.stage = stage;
        throw error;
    }
}
async function requireAdmin(request) {
    if (!request.auth) throw new AccountError('unauthenticated', 'Sign in first.');
    if (request.auth.token.role === 'admin') return;
    const marker = await atStage('read-school-admin-marker', () => db.doc(`schoolAdmins/${request.auth.uid}`).get());
    if (request.auth.token.role !== 'admin' && (!marker.exists || marker.data().active !== true)) {
        throw new AccountError('permission-denied', 'An active school admin account is required.');
    }
}
function segment(value) {
    if (typeof value !== 'string' || !value || value.includes('/') || value === '.' || value === '..' || value.length > 500) {
        throw new AccountError('invalid-argument', 'Invalid section or student ID.');
    }
    return value;
}
function studentRef(data) {
    return db.doc(`classSections/${segment(data.sectionId)}/students/${segment(data.studentId)}`);
}
async function syncStudent(ref, student, actor, password) {
    const email = String(student.email || '').trim().toLowerCase();
    const admissionNo = String(student.admissionNo || ref.id).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AccountError('invalid-argument', 'Enter a valid student email.');
    if (password !== undefined && (typeof password !== 'string' || password.length < 8 || password.length > 128)) {
        throw new AccountError('invalid-argument', 'Use a password of 8–128 characters.');
    }
    // Stable UID makes retries recover an account created before a failed Firestore commit.
    const uid = student.authUid || `student_${createHash('sha256').update(ref.path).digest('hex').slice(0, 48)}`;
    const profileRef = db.doc(`studentProfiles/${segment(uid)}`);
    const profile = await profileRef.get();
    if (profile.exists && (profile.data().sectionId !== ref.parent.parent.id || profile.data().studentDocId !== ref.id)) {
        throw new AccountError('failed-precondition', 'Account is already linked to another student.');
    }
    let user;
    try { user = await auth.getUser(uid); }
    catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
    if (!user && password === undefined) throw new AccountError('failed-precondition', 'Create an account with a password first.');
    const attributes = { email, displayName: student.studentName || student.name, disabled: student.enabled === false };
    if (password !== undefined) attributes.password = password;
    if (user) await auth.updateUser(uid, attributes);
    else await auth.createUser({ uid, ...attributes });
    if (student.enabled === false || password !== undefined) await auth.revokeRefreshTokens(uid);
    const now = timestamp();
    const studentKey = `${ref.parent.parent.id}_${admissionNo}`;
    const batch = db.batch();
    batch.set(ref, { studentName: student.studentName || student.name || '', name: student.studentName || student.name || '', phone: student.phone || '', enabled: student.enabled !== false, email, username: email, admissionNo, authUid: uid, studentKey, updatedAt: now, updatedBy: actor }, { merge: true });
    batch.set(profileRef, {
        authUid: uid, email, username: email, sectionId: ref.parent.parent.id, studentDocId: ref.id,
        admissionNo, studentKey, studentName: student.studentName || student.name || '',
        active: student.enabled !== false, updatedAt: now,
        ...(!profile.exists ? { createdAt: now } : {})
    }, { merge: true });
    await batch.commit();
    return uid;
}
async function manageStudentAccount(request) {
    await requireAdmin(request);
    const data = request.data || {};
    const ref = studentRef(data);
    const snap = await ref.get();
    if (!snap.exists) throw new AccountError('not-found', 'Save the student first.');
    // Bulk creation must never reset an already linked account.
    if (data.createOnly === true && snap.data().authUid) return { authUid: snap.data().authUid, status: 'skipped' };
    try {
        const changes = {};
        for (const field of ['studentName', 'phone', 'email', 'admissionNo']) {
            if (data.student && Object.hasOwn(data.student, field)) {
                if (typeof data.student[field] !== 'string' || data.student[field].length > 500) throw new AccountError('invalid-argument', 'Invalid student field.');
                changes[field] = data.student[field];
            }
        }
        if (data.student && Object.hasOwn(data.student, 'enabled')) {
            if (typeof data.student.enabled !== 'boolean') throw new AccountError('invalid-argument', 'Invalid enabled state.');
            changes.enabled = data.student.enabled;
        }
        const uid = await syncStudent(ref, { ...snap.data(), ...changes }, request.auth.uid, data.password);
        return { authUid: uid };
    } catch (error) {
        if (error instanceof AccountError) throw error;
        if (error.code === 'auth/email-already-exists') throw new AccountError('already-exists', 'Email belongs to another account. Use a different email; existing accounts are never automatically claimed.');
        const failure = new AccountError('internal', 'Account update failed. Retry to complete synchronization.');
        failure.cause = error;
        throw failure;
    }
}
async function migrateStudentProfiles(request) {
    await requireAdmin(request);
    const sectionId = segment(request.data?.sectionId);
    let query = db.collection(`classSections/${sectionId}/students`).orderBy('__name__').limit(100);
    if (request.data?.afterId) query = query.startAfter(segment(request.data.afterId));
    const snap = await atStage('read-student-roster-page', () => query.get());
    const results = [];
    for (const student of snap.docs) {
        if (!student.data().authUid) { results.push({ id: student.id, status: 'needs-account' }); continue; }
        try {
            await syncStudent(student.ref, student.data(), request.auth.uid);
            results.push({ id: student.id, status: 'migrated' });
        } catch (error) {
            logFailure(logger, { operation: 'migrateStudentProfiles', stage: 'synchronize-student' }, error);
            results.push({ id: student.id, status: 'failed', message: error instanceof AccountError ? error.message : 'Unable to synchronize account.' }); }
    }
    return { results, nextId: snap.size === 100 ? snap.docs[snap.size - 1].id : null };
}

return { manageStudentAccount, migrateStudentProfiles };
}
module.exports = { createStudentService, AccountError };
