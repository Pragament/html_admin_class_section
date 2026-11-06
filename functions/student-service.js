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
function profileMemberships(data) {
    const memberships = { ...(data.memberships || {}) };
    if (data.sectionId && !memberships[data.sectionId]) memberships[data.sectionId] = {
        studentDocId: data.studentDocId, admissionNo: data.admissionNo,
        studentKey: data.studentKey, active: data.active === true
    };
    return memberships;
}
async function syncStudent(ref, student, actor, password) {
    const email = String(student.email || '').trim().toLowerCase();
    const admissionNo = String(student.admissionNo || ref.id).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AccountError('invalid-argument', 'Enter a valid student email.');
    if (password !== undefined && (typeof password !== 'string' || password.length < 6 || password.length > 128)) {
        throw new AccountError('invalid-argument', 'Use a password of 6–128 characters.');
    }
    // Stable UID makes retries recover an account created before a failed Firestore commit.
    const uid = student.authUid || `student_${createHash('sha256').update(ref.path).digest('hex').slice(0, 48)}`;
    const profileRef = db.doc(`studentProfiles/${segment(uid)}`);
    const profile = await profileRef.get();
    const previous = profile.exists ? profile.data() : {};
    const memberships = profileMemberships(previous);
    const membership = memberships[ref.parent.parent.id];
    if (profile.exists && (!membership || membership.studentDocId !== ref.id)) {
        throw new AccountError('failed-precondition', 'Account is already linked to another student.');
    }
    let user;
    try { user = await auth.getUser(uid); }
    catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
    if (!user && password === undefined) throw new AccountError('failed-precondition', 'Create an account with a password first.');
    const studentKey = `${ref.parent.parent.id}_${admissionNo}`;
    memberships[ref.parent.parent.id] = { studentDocId: ref.id, admissionNo, studentKey, active: student.enabled !== false };
    const active = Object.values(memberships).some(item => item.active);
    const attributes = { email, displayName: student.studentName || student.name, disabled: !active };
    if (password !== undefined) attributes.password = password;
    if (user) await auth.updateUser(uid, attributes);
    else await auth.createUser({ uid, ...attributes });
    if (student.enabled === false || password !== undefined) await auth.revokeRefreshTokens(uid);
    const now = timestamp();
    const batch = db.batch();
    batch.set(ref, { studentName: student.studentName || student.name || '', name: student.studentName || student.name || '', phone: student.phone || '', enabled: student.enabled !== false, email, username: email, admissionNo, authUid: uid, studentKey, updatedAt: now, updatedBy: actor }, { merge: true });
    batch.set(profileRef, {
        authUid: uid, email, username: email, sectionId: previous.sectionId || ref.parent.parent.id,
        studentDocId: previous.studentDocId || ref.id,
        admissionNo: previous.admissionNo || admissionNo, studentKey: previous.studentKey || studentKey, memberships, studentName: student.studentName || student.name || '',
        active, updatedAt: now,
        ...(!profile.exists ? { createdAt: now } : {})
    }, { merge: true });
    await batch.commit();
    return uid;
}
async function linkExistingStudent(ref, student, actor) {
    const email = String(student.email || '').trim().toLowerCase();
    const account = await auth.getUserByEmail(email);
    const profileRef = db.doc(`studentProfiles/${segment(account.uid)}`);
    // Serialize membership changes so simultaneous links do not overwrite each other.
    return db.runTransaction(async transaction => {
        const profile = await transaction.get(profileRef);
        if (!profile.exists) throw new AccountError('failed-precondition', 'Existing account has no student profile; it cannot be linked automatically.');
        const data = profile.data();
        const origin = await transaction.get(db.doc(`classSections/${segment(data.sectionId)}/students/${segment(data.studentDocId)}`));
        const current = await transaction.get(ref);
        if (!current.exists || (current.data().authUid && current.data().authUid !== account.uid)) {
            throw new AccountError('failed-precondition', 'Student record is missing or already linked to a different account.');
        }
        const admissionNo = String(student.admissionNo || ref.id).trim();
        const phone = String(current.data().phone || '').replace(/\D/g, '');
        if (!origin.exists || origin.data().authUid !== account.uid
            || String(origin.data().admissionNo || origin.id).trim() !== admissionNo
            || phone.length < 6 || phone !== String(origin.data().phone || '').replace(/\D/g, '')) {
            throw new AccountError('failed-precondition', 'Existing account does not match this admission number and phone. Review the student records before linking.');
        }
        const sectionId = ref.parent.parent.id;
        const memberships = profileMemberships(data);
        if (memberships[sectionId] && memberships[sectionId].studentDocId !== ref.id) {
            throw new AccountError('failed-precondition', 'Account is linked to a different student record in this section.');
        }
        const studentKey = `${sectionId}_${admissionNo}`;
        memberships[sectionId] = { studentDocId: ref.id, admissionNo, studentKey, active: current.data().enabled !== false };
        const now = timestamp();
        transaction.set(ref, { email, username: email, authUid: account.uid, admissionNo, studentKey,
            updatedAt: now, updatedBy: actor }, { merge: true });
        transaction.set(profileRef, { memberships, updatedAt: now }, { merge: true });
        return { authUid: account.uid, status: 'linked' };
    });
}
async function emailConflictMessage(email) {
    const fallback = 'Email belongs to another account.';
    try {
        const account = await auth.getUserByEmail(email);
        const profile = await db.doc(`studentProfiles/${segment(account.uid)}`).get();
        const data = profile.exists ? profile.data() : {};
        let name = data.studentName || account.displayName || '';
        let sectionLabel = 'No linked section found';
        if (data.sectionId) {
            const section = await db.doc(`classSections/${segment(data.sectionId)}`).get();
            const sectionData = section.exists ? section.data() : {};
            sectionLabel = `${sectionData.sectionName || sectionData.name || sectionData.className || sectionData.title || data.sectionId} (ID: ${data.sectionId})`;
            if (data.studentDocId) {
                const student = await db.doc(`classSections/${segment(data.sectionId)}/students/${segment(data.studentDocId)}`).get();
                if (student.exists) name = student.data().studentName || student.data().name || name;
            }
        }
        return `${fallback} Existing student: ${name || 'Name unavailable'}. Section: ${sectionLabel}.`;
    } catch {
        return `${fallback} Existing account details could not be loaded.`;
    }
}
async function manageStudentAccount(request) {
    await requireAdmin(request);
    const data = request.data || {};
    const before = await studentRef(data).get();
    if (data.createOnly === true && before.exists && before.data().authUid) return { authUid: before.data().authUid, status: 'skipped' };
    const section = await db.doc(`classSections/${segment(data.sectionId)}`).get();
    if (section.exists && section.data().branchId && data.student && data.resetPasswordFromPhone !== true) {
        const roster = await studentRef(data).get();
        await schools.saveSchoolStudent({ ...request, data: { sectionId: data.sectionId, studentId: data.studentId,
            student: { ...(roster.exists ? roster.data() : {}), ...data.student } } }, true);
    }
    const ref = studentRef(data);
    const snap = await ref.get();
    if (!snap.exists) throw new AccountError('not-found', 'Save the student first.');
    if (data.resetPasswordFromPhone === true) {
        const student = snap.data();
        if (!student.authUid) throw new AccountError('failed-precondition', 'Student has no linked login account.');
        const password = String(student.phone || '').replace(/\D/g, '').slice(0, 6);
        if (password.length < 6) throw new AccountError('invalid-argument', 'Phone must contain at least 6 digits.');
        const profile = await db.doc(`studentProfiles/${segment(student.authUid)}`).get();
        const membership = profile.exists && profileMemberships(profile.data())[data.sectionId];
        if (!membership || membership.studentDocId !== ref.id) {
            throw new AccountError('failed-precondition', 'Login profile is not linked to this student in this section.');
        }
        try {
            // Update credentials only: preserve email, account state and all section memberships.
            await auth.updateUser(student.authUid, { password });
            await auth.revokeRefreshTokens(student.authUid);
        } catch (cause) {
            const error = new AccountError(cause.code === 'auth/user-not-found' ? 'not-found' : 'internal',
                cause.code === 'auth/user-not-found' ? 'Linked login account was not found.' : 'Password reset could not complete. Retry this student.');
            error.cause = cause;
            throw error;
        }
        return { authUid: student.authUid, status: 'reset' };
    }
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
        if (error.code === 'auth/email-already-exists') {
            const email = String(data.student?.email ?? snap.data().email ?? '').trim().toLowerCase();
            if (data.linkExisting === true) {
                return linkExistingStudent(ref, { ...snap.data(), ...data.student, email }, request.auth.uid);
            }
            const message = await emailConflictMessage(email);
            throw new AccountError('already-exists', `${message} Use a different email; existing accounts are never automatically claimed.`);
        }
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

const schools = require('./school-service').createSchoolService({ db, timestamp, requireAdmin });
return { manageStudentAccount, migrateStudentProfiles, ...schools };
}
module.exports = { createStudentService, AccountError };
