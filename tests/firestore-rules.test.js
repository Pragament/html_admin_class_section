const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

// Opt in only against an isolated local emulator; never uses production Firebase.
const host = process.env.FIRESTORE_RULES_TEST_HOST;
test('section membership queries enforce the supplied Firestore rules', { skip: !host }, async () => {
    assert.match(host, /^(127\.0\.0\.1|localhost):\d+$/);
    const project = 'demo-section-rules';
    const root = `http://${host}`;
    const base = `${root}/v1/projects/${project}/databases/(default)/documents`;
    const headers = { 'Content-Type': 'application/json' };
    const rules = readFileSync(join(__dirname, '../firestore.rules'), 'utf8');
    const uploaded = await fetch(`${root}/emulator/v1/projects/${project}:securityRules`, {
        method: 'PUT', headers,
        body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: rules }] } })
    });
    assert.equal(uploaded.status, 200, await uploaded.text());
    const member = (email, role) => ({ mapValue: { fields: {
        email: { stringValue: email }, role: { stringValue: role }
    } } });
    const token = email => {
        const now = Math.floor(Date.now() / 1000);
        return [ { alg: 'none', typ: 'JWT' }, {
            sub: 'rules-test-user', email, email_verified: true, aud: project,
            iss: `https://securetoken.google.com/${project}`, iat: now, exp: now + 3600,
            firebase: { sign_in_provider: 'google.com' }
        } ].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.';
    };
    for (const role of ['admin', 'viewer']) {
        const seeded = await fetch(`${base}/classSections/rules-test-${role}`, {
            method: 'PATCH', headers: { ...headers, Authorization: 'Bearer owner' },
            body: JSON.stringify({ fields: { members: { arrayValue: {
                values: [member(`${role}@example.com`, role)]
            } } } })
        });
        assert.equal(seeded.status, 200, await seeded.text());
    }
    const run = async (email, filterEmail = email, filtered = true) => {
        const structuredQuery = { from: [{ collectionId: 'classSections' }] };
        if (filtered) structuredQuery.where = { fieldFilter: {
            field: { fieldPath: 'members' }, op: 'ARRAY_CONTAINS_ANY',
            value: { arrayValue: { values: ['admin', 'viewer'].map(role => member(filterEmail, role)) } }
        } };
        const response = await fetch(`${base}:runQuery`, {
            method: 'POST', headers: { ...headers, ...(email ? { Authorization: `Bearer ${token(email)}` } : {}) },
            body: JSON.stringify({ structuredQuery })
        });
        return { status: response.status, body: await response.json() };
    };
    for (const role of ['admin', 'viewer']) {
        const result = await run(`${role}@example.com`);
        assert.equal(result.status, 200, JSON.stringify(result.body));
        assert.ok(result.body.some(row => row.document?.name.endsWith(`/rules-test-${role}`)));
        assert.ok(result.body.every(row => !row.document || row.document.name.endsWith(`/rules-test-${role}`)));
    }
    const outsider = await run('outsider@example.com');
    assert.equal(outsider.status, 200);
    assert.ok(outsider.body.every(row => !row.document));
    assert.equal((await run('outsider@example.com', 'admin@example.com')).status, 403);
    assert.equal((await run('admin@example.com', undefined, false)).status, 403);
    assert.equal((await run(null, 'admin@example.com')).status, 403);
    const seed = async (path, fields) => {
        const response = await fetch(`${base}/${path}`, {
            method: 'PATCH', headers: { ...headers, Authorization: 'Bearer owner' },
            body: JSON.stringify({ fields })
        });
        assert.equal(response.status, 200, await response.text());
    };
    const text = stringValue => ({ stringValue });
    await seed('classrooms/owned', { creatorId: text('rules-test-user'), sectionId: text('other') });
    await seed('classrooms/section-room', { creatorId: text('someone-else'), sectionId: text('rules-test-admin') });
    await seed('classrooms/private-room', { creatorId: text('someone-else'), sectionId: text('other') });
    await seed('qb_quiz_submissions_v1/owned-answer', { classroomId: text('owned') });
    await seed('qb_quiz_submissions_v1/section-answer', { classroomId: text('section-room'), sectionId: text('rules-test-admin') });
    await seed('qb_quiz_submissions_v1/private-answer', { classroomId: text('private-room'), sectionId: text('other') });
    const scoped = async (collectionId, field, value, email = 'admin@example.com') => {
        const structuredQuery = { from: [{ collectionId }] };
        if (field) structuredQuery.where = { fieldFilter: {
            field: { fieldPath: field }, op: 'EQUAL', value: text(value)
        } };
        const response = await fetch(`${base}:runQuery`, {
            method: 'POST', headers: { ...headers, Authorization: `Bearer ${token(email)}` },
            body: JSON.stringify({ structuredQuery })
        });
        return { status: response.status, body: await response.json() };
    };
    for (const [collectionId, field, value, expected] of [
        ['classrooms', 'creatorId', 'rules-test-user', 'owned'],
        ['classrooms', 'sectionId', 'rules-test-admin', 'section-room'],
        ['qb_quiz_submissions_v1', 'classroomId', 'owned', 'owned-answer'],
        ['qb_quiz_submissions_v1', 'sectionId', 'rules-test-admin', 'section-answer']
    ]) {
        const result = await scoped(collectionId, field, value);
        assert.equal(result.status, 200, JSON.stringify(result.body));
        assert.ok(result.body.some(row => row.document?.name.endsWith(`/${expected}`)));
        assert.ok(result.body.every(row => !row.document || row.document.name.endsWith(`/${expected}`)));
    }
    assert.equal((await scoped('classrooms')).status, 403);
    assert.equal((await scoped('qb_quiz_submissions_v1')).status, 403);
    assert.equal((await scoped('qb_quiz_submissions_v1', 'sectionId', 'other')).status, 403);
    assert.equal((await scoped('qb_quiz_submissions_v1', 'classroomId', 'private-room')).status, 403);
    assert.equal((await scoped('qb_quiz_submissions_v1', 'sectionId', 'rules-test-admin', 'viewer@example.com')).status, 403);

});
