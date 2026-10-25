const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStudentService } = require('../functions/student-service');
function fixture() {
    const records = new Map([
        ['schoolAdmins/admin', { active: true }],
        ['classSections/section/students/student', { studentName: 'Student', email: 'STUDENT@school.edu', admissionNo: '102' }]
    ]);
    const users = new Map();
    let failCommit = false;
    const ref = path => ({ path, id: path.split('/').at(-1), parent: { parent: { id: path.split('/')[1] } },
        get: async () => ({ exists: records.has(path), data: () => records.get(path) }) });
    const db = { doc: ref, runTransaction: async run => {
        const writes = [];
        const result = await run({ get: r => r.get(), set: (r, data) => writes.push([r.path, data]) });
        for (const [path, data] of writes) records.set(path, { ...records.get(path), ...data });
        return result;
    }, batch: () => {
        const writes = [];
        return { set: (r, data) => writes.push([r.path, data]), commit: async () => {
            if (failCommit) { failCommit = false; throw new Error('commit failed'); }
            for (const [path, data] of writes) records.set(path, { ...records.get(path), ...data });
        } };
    } };
    const auth = {
        getUser: async uid => { if (!users.has(uid)) throw Object.assign(new Error(), { code: 'auth/user-not-found' }); return users.get(uid); },
        getUserByEmail: async email => {
            const user = [...users.values()].find(user => user.email === email);
            if (!user) throw Object.assign(new Error(), { code: 'auth/user-not-found' });
            return user;
        },
        createUser: async data => {
            if ([...users.values()].some(user => user.email === data.email)) throw Object.assign(new Error(), { code: 'auth/email-already-exists' });
            users.set(data.uid, data);
        },
        updateUser: async (uid, data) => { users.set(uid, { ...users.get(uid), ...data }); },
        revokeRefreshTokens: async uid => { users.get(uid).revoked = true; }
    };
    const service = createStudentService({ db, auth, timestamp: () => 'timestamp' });
    const request = extra => ({ auth: { uid: 'admin', token: {} }, data: { sectionId: 'section', studentId: 'student', ...extra } });
    return { service, records, users, request, fail: () => { failCommit = true; } };
}
test('account creation and disabling synchronize records without persisting passwords', async () => {
    const f = fixture();
    const { authUid } = await f.service.manageStudentAccount(f.request({ password: 'password123' }));
    assert.equal(f.users.size, 1);
    const student = f.records.get('classSections/section/students/student');
    const profile = f.records.get(`studentProfiles/${authUid}`);
    assert.equal(student.authUid, authUid);
    assert.equal(profile.email, 'student@school.edu');
    assert.equal(profile.studentKey, 'section_102');
    assert.equal(profile.active, true);
    for (const record of f.records.values()) assert.equal(Object.hasOwn(record, 'password'), false);
    await f.service.manageStudentAccount(f.request({ student: { enabled: false } }));
    assert.equal(f.users.get(authUid).disabled, true);
    assert.equal(f.users.get(authUid).revoked, true);
    assert.equal(f.records.get(`studentProfiles/${authUid}`).active, false);
});
test('retry recovers an Auth account after a Firestore commit failure', async () => {
    const f = fixture();
    f.fail();
    await assert.rejects(f.service.manageStudentAccount(f.request({ password: 'password123' })), { code: 'internal' });
    assert.equal(f.users.size, 1);
    await f.service.manageStudentAccount(f.request({ password: 'password123' }));
    assert.equal(f.users.size, 1);
    assert.ok(f.records.get('classSections/section/students/student').authUid);
});
test('unauthorized users, invalid IDs and missing creation passwords are rejected', async () => {
    const f = fixture();
    await assert.rejects(f.service.manageStudentAccount({ data: {} }), { code: 'unauthenticated' });
    await assert.rejects(f.service.manageStudentAccount({ auth: { uid: 'other', token: {} }, data: {} }), { code: 'permission-denied' });
    await assert.rejects(f.service.manageStudentAccount(f.request({ studentId: '../other' })), { code: 'invalid-argument' });
    await assert.rejects(f.service.manageStudentAccount(f.request()), { code: 'failed-precondition' });
    assert.equal(f.users.size, 0);
});
test('duplicate emails and profiles linked elsewhere are never adopted', async () => {
    const f = fixture();
    const { authUid } = await f.service.manageStudentAccount(f.request({ password: 'password123' }));
    f.records.set(`studentProfiles/${authUid}`, { sectionId: 'other', studentDocId: 'other' });
    await assert.rejects(f.service.manageStudentAccount(f.request({ password: 'newpassword' })), { code: 'failed-precondition' });
    const g = fixture();
    g.users.set('unrelated', { uid: 'unrelated', email: 'student@school.edu' });
    // Simulate Firebase's unique email enforcement.
    const conflict = createStudentService({
        db: { doc: p => ({ id: p.split('/').at(-1), path: p, parent: { parent: { id: 'section' } }, get: async () => ({ exists: g.records.has(p), data: () => g.records.get(p) }) }) },
        auth: {
            getUser: async () => { throw Object.assign(new Error(), { code: 'auth/user-not-found' }); },
            createUser: async () => { throw Object.assign(new Error(), { code: 'auth/email-already-exists' }); }
        }, timestamp: () => 'timestamp'
    });
    await assert.rejects(conflict.manageStudentAccount(g.request({ password: 'password123' })), { code: 'already-exists' });
    assert.equal(g.records.has('studentProfiles/unrelated'), false);
});

test('Firestore quota exhaustion during authorization returns a clear quota error', async () => {
    const service = createStudentService({
        db: { doc: () => ({ get: async () => { throw Object.assign(new Error('8 RESOURCE_EXHAUSTED: Quota exceeded.'), { code: 8 }); } }) },
        auth: {}, timestamp: () => 'timestamp'
    });
    await assert.rejects(service.migrateStudentProfiles({ auth: { uid: 'admin', token: {} }, data: { sectionId: 'section' } }), error => {
        assert.equal(error.code, 'resource-exhausted');
        assert.equal(error.stage, 'read-school-admin-marker');
        assert.match(error.message, /quota exceeded/);
        return true;
    });
});

test('bulk creation saves email and profile, then skips linked accounts without resetting credentials', async () => {
    const f = fixture();
    const result = await f.service.manageStudentAccount(f.request({ createOnly: true, password: 'initialpassword', student: { email: 'bulk@school.edu', admissionNo: '202' } }));
    assert.equal(f.users.get(result.authUid).email, 'bulk@school.edu');
    assert.equal(f.records.get(`studentProfiles/${result.authUid}`).admissionNo, '202');
    const retry = await f.service.manageStudentAccount(f.request({ createOnly: true, password: 'differentpassword', student: { email: 'different@school.edu' } }));
    assert.equal(retry.status, 'skipped');
    assert.equal(f.users.get(result.authUid).password, 'initialpassword');
    assert.equal(f.users.get(result.authUid).email, 'bulk@school.edu');
});

test('six-character passwords are accepted and shorter passwords are rejected', async () => {
    const f = fixture();
    await assert.rejects(f.service.manageStudentAccount(f.request({ password: '12345' })), { code: 'invalid-argument' });
    assert.equal(f.users.size, 0);
    const { authUid } = await f.service.manageStudentAccount(f.request({ password: '123456' }));
    assert.equal(f.users.get(authUid).password, '123456');
});

test('email conflict identifies the existing student and section without claiming the account', async () => {
    const f = fixture();
    f.records.set('studentProfiles/existing', { sectionId: 'other', studentDocId: '755', studentName: 'Profile Name' });
    f.records.set('classSections/other', { sectionName: 'Grade 8 A' });
    f.records.set('classSections/other/students/755', { studentName: 'Existing Student' });
    const service = createStudentService({
        db: { doc: path => ({ path, id: path.split('/').at(-1), parent: { parent: { id: 'section' } },
            get: async () => ({ exists: f.records.has(path), data: () => f.records.get(path) }) }) },
        auth: {
            getUser: async () => { throw Object.assign(new Error(), { code: 'auth/user-not-found' }); },
            createUser: async () => { throw Object.assign(new Error(), { code: 'auth/email-already-exists' }); },
            getUserByEmail: async email => {
                assert.equal(email, 'student@school.edu');
                return { uid: 'existing', displayName: 'Auth Name' };
            }
        }, timestamp: () => 'timestamp'
    });
    await assert.rejects(service.manageStudentAccount(f.request({ password: '123456' })), error => {
        assert.equal(error.code, 'already-exists');
        assert.match(error.message, /Existing student: Existing Student/);
        assert.match(error.message, /Section: Grade 8 A \(ID: other\)/);
        return true;
    });
    assert.equal(f.records.get('classSections/section/students/student').authUid, undefined);
    await assert.rejects(service.manageStudentAccount({ auth: { uid: 'outsider', token: {} }, data: {} }), { code: 'permission-denied' });
});

test('one login links matching students across sections without resetting password or losing the first membership', async () => {
    const f = fixture();
    f.records.get('classSections/section/students/student').phone = '9666033404';
    const first = await f.service.manageStudentAccount(f.request({ password: 'original-password' }));
    f.records.set('classSections/second/students/102', { studentName: 'Student', phone: '96660 33404', enabled: true });
    const secondRequest = f.request({ sectionId: 'second', studentId: '102', createOnly: true, linkExisting: true,
        password: '966603', student: { email: 'student@school.edu', admissionNo: '102' } });
    const second = await f.service.manageStudentAccount(secondRequest);
    assert.equal(second.status, 'linked');
    assert.equal(second.authUid, first.authUid);
    assert.equal(f.users.size, 1);
    assert.equal(f.users.get(first.authUid).password, 'original-password');
    const profile = f.records.get(`studentProfiles/${first.authUid}`);
    assert.equal(profile.sectionId, 'section');
    assert.equal(profile.memberships.section.active, true);
    assert.equal(profile.memberships.second.studentKey, 'second_102');
    assert.equal(f.records.get('classSections/second/students/102').authUid, first.authUid);
    assert.equal((await f.service.manageStudentAccount(secondRequest)).status, 'skipped');
    await f.service.manageStudentAccount(f.request({ sectionId: 'second', studentId: '102', student: { enabled: false } }));
    assert.equal(f.users.get(first.authUid).disabled, false);
    assert.equal(f.records.get(`studentProfiles/${first.authUid}`).memberships.second.active, false);
    assert.equal(f.records.get(`studentProfiles/${first.authUid}`).memberships.section.active, true);
});

test('cross-section linking rejects mismatched identity and accounts without student profiles', async () => {
    const f = fixture();
    f.records.get('classSections/section/students/student').phone = '9666033404';
    await f.service.manageStudentAccount(f.request({ password: 'original-password' }));
    f.records.set('classSections/second/students/102', { phone: '1111111111' });
    const request = f.request({ sectionId: 'second', studentId: '102', createOnly: true, linkExisting: true,
        password: '111111', student: { email: 'student@school.edu', admissionNo: '102' } });
    await assert.rejects(f.service.manageStudentAccount(request), /does not match/);
    assert.equal(f.records.get('classSections/second/students/102').authUid, undefined);
    f.records.get('classSections/second/students/102').phone = '9666033404';
    request.data.student.admissionNo = 'wrong';
    await assert.rejects(f.service.manageStudentAccount(request), /does not match/);
    f.users.set('unrelated', { uid: 'unrelated', email: 'other@school.edu' });
    request.data.student.email = 'other@school.edu';
    await assert.rejects(f.service.manageStudentAccount(request), /no student profile/);
    assert.equal(f.users.get('unrelated').password, undefined);
});
