const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLocalServer } = require('../local-server');
const { AccountError } = require('../functions/student-service');

test('local API protects credentials, verifies tokens and restricts request origins', async t => {
    let calls = 0;
    const auth = { verifyIdToken: async (token, revoked) => {
        assert.equal(revoked, true);
        if (token !== 'valid') throw new Error('invalid token');
        return { uid: 'admin', role: 'admin' };
    } };
    const service = { manageStudentAccount: async request => {
        calls++;
        assert.equal(request.auth.uid, 'admin');
        return { authUid: 'student123' };
    }, migrateStudentProfiles: async () => { throw new AccountError('permission-denied', 'Admin required.'); } };
    const server = createLocalServer({ auth, service });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (endpoint, headers = {}, body = '{}') => fetch(`${base}/api/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
    assert.equal((await fetch(base)).status, 200);
    for (const file of ['package.json', 'local-server.js', 'functions/student-service.js', '.git/config', 'service-account.json']) {
        assert.equal((await fetch(`${base}/${file}`)).status, 404);
    }
    assert.equal((await post('manageStudentAccount')).status, 401);
    assert.equal((await post('manageStudentAccount', { Authorization: 'Bearer bad' })).status, 401);
    assert.equal((await post('manageStudentAccount', { Authorization: 'Bearer valid', Origin: 'https://evil.example' })).status, 403);
    const reboundStatus = await new Promise((resolve, reject) => {
        const req = require('node:http').request(`${base}/api/manageStudentAccount`, { method: 'POST', headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); });
        req.on('error', reject);
        req.end();
    });
    assert.equal(reboundStatus, 403);
    assert.equal((await post('manageStudentAccount', { Authorization: 'Bearer valid' }, '[]')).status, 400);
    assert.equal((await post('manageStudentAccount', { Authorization: 'Bearer valid' }, '{')).status, 400);
    assert.equal((await post('manageStudentAccount', { Authorization: 'Bearer valid' }, JSON.stringify({ data: 'x'.repeat(17000) }))).status, 400);
    assert.equal((await post('migrateStudentProfiles', { Authorization: 'Bearer valid' })).status, 403);
    const response = await post('manageStudentAccount', { Authorization: 'Bearer valid', Origin: base });
    assert.deepEqual(await response.json(), { data: { authUid: 'student123' } });
    assert.equal(calls, 1);
});

test('backend failures emit safe diagnostics with a matching request ID', async t => {
    const logs = [];
    const server = createLocalServer({
        auth: { verifyIdToken: async () => ({ uid: 'admin' }) },
        service: { migrateStudentProfiles: async () => { throw Object.assign(new Error('private password token student@email.example'), { code: 7 }); } },
        logger: { error: text => logs.push(JSON.parse(text)) }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    t.after(() => new Promise(resolve => server.close(resolve)));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/migrateStudentProfiles`, {
        method: 'POST', headers: { Authorization: 'Bearer private-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'secret' })
    });
    assert.equal(response.status, 500);
    const result = await response.json();
    assert.equal(logs[0].requestId, result.error.requestId);
    assert.equal(logs[0].code, '7');
    assert.match(logs[0].hint, /IAM/);
    assert.doesNotMatch(JSON.stringify(logs), /private|secret|student@email/);
});
