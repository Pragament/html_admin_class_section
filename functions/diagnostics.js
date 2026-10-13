// Only fixed diagnostic text and recognized SDK codes are logged. Never log SDK
// stacks or error objects: they may contain tokens or credential material.
// Unknown Firestore read errors include a redacted, bounded SDK message.
const HINTS = {
    '8': 'Firestore quota exhausted. Check Firestore usage and Google Cloud quotas for this project before retrying.',
    'resource-exhausted': 'Firestore quota exhausted. Check Firestore usage and Google Cloud quotas for this project before retrying.',
    '7': 'Firestore permission denied. Check service account IAM permissions and whether the Firestore API is enabled.',
    '16': 'Firestore authentication failed. Check the service account key and project.',
    '5': 'Firestore resource not found. Check the project and default database.',
    '9': 'Firestore precondition failed. Check database setup and required indexes.',
    '14': 'Firestore unavailable. Check network access and retry.',
    '4': 'Firestore deadline exceeded. Check network access and retry.',
    'app/invalid-credential': 'Invalid service account credentials. Check the key and system clock.',
    'app/invalid-app-options': 'Invalid Firebase Admin configuration. Check the project and credentials.',
    'auth/insufficient-permission': 'Service account lacks Firebase Authentication user-management permissions.',
    'auth/invalid-credential': 'Firebase Authentication rejected the server credentials.',
    'auth/user-not-found': 'The linked Firebase Authentication user does not exist.',
    'auth/email-already-exists': 'The student email belongs to another Firebase Authentication account.',
    'permission-denied': 'The signed-in user needs an active schoolAdmins marker or an admin role claim.',
    'unauthenticated': 'The login token is missing, invalid, expired or revoked.',
    'invalid-argument': 'The request or student fields are invalid.',
    'failed-precondition': 'Check that the student account exists and the profile belongs to this student.',
    'not-found': 'Save the student roster record before managing its account.'
};
const PATTERNS = [
    [/RESOURCE_EXHAUSTED|quota exceeded/i, 'resource-exhausted', 'Firestore quota exhausted. Check Firestore usage and Google Cloud quotas for this project before retrying.'],
    [/invalid_grant|invalid jwt signature|invalid jwt.*(?:iat|exp)|account not found/i, 'credential-rejected', 'Service account token exchange failed. Check whether the key was revoked or deleted, the service account is enabled, and the system clock is correct.'],
    [/could not load.*default credentials|default credentials.*not found/i, 'credentials-unavailable', 'Application Default Credentials could not be loaded. Check GOOGLE_APPLICATION_CREDENTIALS in the terminal starting npm.'],
    [/ENOTFOUND|EAI_AGAIN|getaddrinfo/i, 'dns-failure', 'DNS lookup failed. Check internet access, DNS and proxy settings.'],
    [/ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed/i, 'connection-failure', 'A backend connection failed. Check internet access, proxy settings and emulator environment variables.'],
    [/SERVICE_DISABLED|API.*(?:not been used|disabled)/i, 'api-disabled', 'A required Google API is disabled. Enable the Firestore and Firebase Authentication APIs for this project.'],
    [/PERMISSION_DENIED|insufficient.*permission/i, 'iam-permission-denied', 'The service account lacks server permissions. Check its Firestore and Firebase Authentication IAM roles.'],
    [/database.*(?:does not exist|not found)/i, 'database-missing', 'The requested Firestore database does not exist. Check the project and default database.'],
    [/ERR_REQUIRE_ESM|require\(\).*ES Module/i, 'module-compatibility', 'A dependency could not be loaded. Check Node.js version and reinstall dependencies with npm ci.']
];
function diagnostic(error) {
    // Inspect text for fixed signatures only; never emit the original text.
    const sources = [];
    let current = error;
    for (let depth = 0; current && depth < 4; depth++) {
        sources.push(current);
        current = current.cause;
    }
    for (const source of sources.slice().reverse()) {
        const candidate = String(source.code ?? source.errorInfo?.code ?? '');
        if (Object.hasOwn(HINTS, candidate)) return { code: candidate, hint: HINTS[candidate] };
        const text = `${source.message || ''} ${source.details || ''} ${source.code || ''}`;
        for (const [pattern, code, hint] of PATTERNS) {
            if (pattern.test(text)) return { code, hint };
        }
    }
    const type = ['TypeError', 'ReferenceError', 'SyntaxError', 'RangeError'].includes(error?.name) ? error.name : 'Error';
    return { code: 'internal', errorType: type, hint: type === 'Error'
        ? 'Unrecognized backend failure. Check service account permissions, project configuration and network connectivity.'
        : 'A backend runtime error occurred. Check the installed Node.js version and dependencies.' };
}
function redactSdkMessage(error) {
    let source = error;
    for (let depth = 0; source?.cause && depth < 4; depth++) source = source.cause;
    return String(source?.message || 'No SDK error message available.')
        .replace(/-----BEGIN[^-]*-----[\s\S]*?(?:-----END[^-]*-----|$)/g, '[REDACTED KEY]')
        .replace(/(private_key|password|access_token|refresh_token|id_token|client_secret|authorization)(["'\s]*[:=]["'\s]*)(?:"[^"\n]*"|'[^'\n]*'|[^,;\s}]+)/gi, '$1=[REDACTED]')
        .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
        .replace(/[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED TOKEN]')
        .replace(/[A-Za-z0-9+/=_-]{40,}/g, '[REDACTED VALUE]')
        .replace(/[\w.+-]+@[\w.-]+/g, '[REDACTED EMAIL]')
        .replace(/https?:\/\/[^\s"'<>]+/g, '[REDACTED URL]')
        .replace(/(?:schoolAdmins|students|studentProfiles)\/[^\s"'<>]+/g, '[REDACTED DOCUMENT]')
        .replace(/[\r\n]+/g, ' ').slice(0, 1200);
}
function logFailure(logger, context, error) {
    const details = diagnostic(error);
    const stage = error?.stage || context.stage;
    const sdkMessage = details.code === 'internal' && ['read-school-admin-marker', 'read-student-roster-page'].includes(stage)
        ? { sdkMessage: redactSdkMessage(error) } : {};
    logger.error(JSON.stringify({ event: 'student-api-error', ...context, stage, ...details, ...sdkMessage }));
}
module.exports = { diagnostic, logFailure };
