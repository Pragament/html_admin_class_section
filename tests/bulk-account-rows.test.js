const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const source = readFileSync(join(__dirname, '../app.js'), 'utf8');
const helper = source.slice(source.indexOf('function existingStudentAccountRows('), source.indexOf('function previewExistingAccounts('));
const buildRows = new Function(`${helper}; return existingStudentAccountRows;`)();
const build = async (...args) => buildRows(...args);

test('existing records generate admission emails and first six phone digits without altering records', async () => {
    const student = { id: 'student101', admissionNo: '00614', phone: '+91 98765-43210' };
    const rows = await build([student], ' DSSSangareddy.com ');
    assert.equal(rows[0].email, '00614@dsssangareddy.com');
    assert.equal(rows[0].password, '919876');
    assert.equal(rows[0].status, 'ready');
    assert.equal(student.email, undefined);
    assert.equal(student.password, undefined);
});

test('missing, invalid and duplicate data are flagged while linked accounts are skipped', async () => {
    const rows = await build([
        { id: 'a', admissionNo: '614', phone: '0123456789' },
        { id: 'b', admissionNo: '614', phone: '9876543210' },
        { id: '', phone: '9876543210' },
        { id: 'd', admissionNo: 'bad name', phone: '9876543210' },
        { id: 'e', admissionNo: '615', phone: '12345' },
        { id: 'f', authUid: 'linked', email: 'existing@example.com' }
    ], 'school.example');
    assert.deepEqual(rows.map(row => row.status), ['ready', 'invalid', 'invalid', 'invalid', 'invalid', 'skip']);
    assert.equal(rows[0].password, '012345');
    assert.ok(rows.slice(1).every(row => row.password === ''));
    assert.equal(rows[5].email, 'existing@example.com');
});

test('school domain is required and must be a domain without a scheme or email prefix', async () => {
    for (const domain of ['', '@school.com', 'https://school.com', 'school', 'school.com/path', '-school.com']) {
        await assert.rejects(build([], domain), /school domain/);
    }
});

test('student ID supplies a missing admission number and preserves leading zeros', async () => {
    const rows = await build([{ id: '045', studentName: 'Ausali Nishith', admissionNo: ' ', phone: '9876543210' }], 'dsssangareddy.com');
    assert.equal(rows[0].admissionNo, '045');
    assert.equal(rows[0].email, '045@dsssangareddy.com');
    assert.equal(rows[0].password, '987654');
    assert.equal(rows[0].status, 'ready');
});
