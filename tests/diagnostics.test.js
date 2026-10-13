const { test } = require('node:test');
const assert = require('node:assert/strict');
const { diagnostic, logFailure } = require('../functions/diagnostics');

test('uncoded credential and network errors produce useful fixed hints without leaking text', () => {
    for (const [message, code] of [
        ['invalid_grant secret-key private@email.example', 'credential-rejected'],
        ['getaddrinfo ENOTFOUND secret-host', 'dns-failure'],
        ['database secret-db does not exist', 'database-missing']
    ]) {
        const result = diagnostic(new Error(message));
        assert.equal(result.code, code);
        assert.doesNotMatch(JSON.stringify(result), /secret|private@email/);
    }
});
test('wrapped errors preserve the stage and underlying SDK code', () => {
    const cause = Object.assign(new Error('secret'), { code: 7 });
    const error = Object.assign(new Error('wrapper'), { cause, stage: 'read-school-admin-marker' });
    let entry;
    logFailure({ error: text => { entry = JSON.parse(text); } }, { operation: 'migrateStudentProfiles', stage: 'generic' }, error);
    assert.equal(entry.stage, 'read-school-admin-marker');
    assert.equal(entry.code, '7');
    assert.doesNotMatch(JSON.stringify(entry), /secret/);
});

test('unknown Firestore read errors reveal a bounded message with credentials redacted', () => {
    const cause = new Error('Metadata plugin failed: password="do-not-log" access_token=do-not-log user=admin@example.com https://example.com?secret=do-not-log -----BEGIN PRIVATE KEY-----do-not-log-----END PRIVATE KEY-----');
    const error = Object.assign(new Error('wrapper'), { cause, stage: 'read-school-admin-marker' });
    let entry;
    logFailure({ error: text => { entry = JSON.parse(text); } }, {}, error);
    assert.match(entry.sdkMessage, /Metadata plugin failed/);
    assert.doesNotMatch(entry.sdkMessage, /do-not-log|admin@example|https:\/\//);
    assert.ok(entry.sdkMessage.length <= 1200);
});
