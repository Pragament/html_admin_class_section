const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { logFailure } = require('./functions/diagnostics');
const { createStudentService, AccountError } = require('./functions/student-service');

const PUBLIC_FILES = new Set([
    'index.html', 'app.js', 'styles.css', 'classrooms.html', 'classrooms.js',
    'students.html', 'students.js', 'submissions.html', 'submissions.js',
    'questions.html', 'questions.js', 'taxonomy.html', 'taxonomy.js',
    'firebase-config.js', 'firebase-config.local.js', 'copy-data.html', 'copy-data.js',
    'question-filters.js'
]);
const TEAM_PROJECT_ID = 'eschool-dev-4c6b4';
// The pages use firebase-config.local.js when it exists, so the server must use that same project.
async function expectedProjectId(root) {
    try {
        const config = await fs.readFile(path.join(root, 'firebase-config.local.js'), 'utf8');
        return /projectId:\s*['"]([^'"]+)['"]/.exec(config)?.[1] || TEAM_PROJECT_ID;
    } catch {
        return TEAM_PROJECT_ID;
    }
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const STATUS = { 'resource-exhausted': 429, unauthenticated: 401, 'permission-denied': 403, 'invalid-argument': 400, 'not-found': 404, 'failed-precondition': 409, 'already-exists': 409 };
function json(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(data));
}
async function readJson(req) {
    if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
        throw new AccountError('invalid-argument', 'Use application/json.');
    }
    let body = '';
    let bytes = 0;
    for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 16384) throw new AccountError('invalid-argument', 'Request is too large.');
        body += chunk.toString();
    }
    let data;
    try { data = JSON.parse(body); }
    catch { throw new AccountError('invalid-argument', 'Invalid JSON.'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new AccountError('invalid-argument', 'Expected a JSON object.');
    return data;
}
function createLocalServer({ auth, service, root = __dirname, logger = console }) {
    return http.createServer(async (req, res) => {
        // Validate Host as well as Origin to prevent DNS rebinding and browser cross-origin writes.
        const port = req.socket.localPort;
        const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
        if (!hosts.includes(req.headers.host)) return json(res, 403, { error: { message: 'Localhost access only.' } });
        const origin = `http://${req.headers.host}`;
        if (req.headers.origin && req.headers.origin !== origin) return json(res, 403, { error: { message: 'Same-origin access required.' } });
        if (req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error: { message: 'Same-origin access required.' } });
        const url = new URL(req.url, origin);
        if (url.pathname.startsWith('/api/')) {
            const operation = url.pathname.slice(5);
            if (!['manageStudentAccount', 'migrateStudentProfiles'].includes(operation)) return json(res, 404, { error: { message: 'Unknown API endpoint.' } });
            if (req.method !== 'POST') return json(res, 405, { error: { message: 'Use POST.' } });
            const requestId = randomUUID();
            let stage = 'verify-login';
            try {
                const match = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
                if (!match) throw new AccountError('unauthenticated', 'Sign in first.');
                let decoded;
                try { decoded = await auth.verifyIdToken(match[1], true); }
                catch (cause) {
                    const error = new AccountError('unauthenticated', 'Session expired or revoked. Sign in again.');
                    error.cause = cause;
                    throw error;
                }
                stage = 'parse-request';
                const data = await readJson(req);
                stage = 'authorize-admin-and-run-operation';
                const result = await service[operation]({ data, auth: { uid: decoded.uid, token: decoded } });
                return json(res, 200, { data: result });
            } catch (error) {
                const known = error instanceof AccountError;
                logFailure(logger, { requestId, operation, stage }, error);
                return json(res, known ? (STATUS[error.code] || 500) : 500, {
                    error: { code: known ? error.code : 'internal', requestId, message: `${known ? error.message : 'Student operation failed. Check server credentials and retry.'} (Request: ${requestId}; see server terminal)` }
                });
            }
        }
        if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: { message: 'Method not allowed.' } });
        const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        // Explicit allowlist means JSON keys, node_modules, backend code and .git can never be served.
        if (!PUBLIC_FILES.has(file)) return json(res, 404, { error: { message: 'Not found.' } });
        try {
            const content = await fs.readFile(path.join(root, file));
            res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
            res.end(req.method === 'HEAD' ? undefined : content);
        } catch { json(res, 404, { error: { message: 'Not found.' } }); }
    });
}
async function start() {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) throw new Error('Set GOOGLE_APPLICATION_CREDENTIALS to your service account JSON file outside this repository.');
    const credentialPath = await fs.realpath(process.env.GOOGLE_APPLICATION_CREDENTIALS);
    const repoPath = await fs.realpath(__dirname);
    const relative = path.relative(repoPath, credentialPath);
    if (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) throw new Error('Move the service account JSON outside this repository.');
    const credentials = JSON.parse(await fs.readFile(credentialPath, 'utf8'));
    const projectId = await expectedProjectId(__dirname);
    if (credentials.type !== 'service_account' || credentials.project_id !== projectId) throw new Error(`Use a service account for the ${projectId} Firebase project.`);
    const { initializeApp, applicationDefault } = require('firebase-admin/app');
    const { getAuth } = require('firebase-admin/auth');
    const { getFirestore, FieldValue } = require('firebase-admin/firestore');
    initializeApp({ credential: applicationDefault(), projectId: credentials.project_id });
    const auth = getAuth();
    const service = createStudentService({ db: getFirestore(), auth, timestamp: () => FieldValue.serverTimestamp() });
    const port = Number(process.env.PORT || 8000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
    const server = createLocalServer({ auth, service });
    server.on('error', error => {
        if (error.code === 'EADDRINUSE') {
            console.error(`Port ${port} is already in use. Stop the existing server with Ctrl+C in its terminal, or run PORT=${port === 65535 ? 8000 : port + 1} npm start.`);
        } else if (error.code === 'EACCES' || error.code === 'EPERM') {
            console.error(`Permission denied when binding to 127.0.0.1:${port}. Use an unprivileged port or check local execution permissions.`);
        } else {
            console.error('Unable to bind the local server. Check local networking configuration.');
        }
        process.exitCode = 1;
    });
    server.listen(port, '127.0.0.1', () => console.log(`School Admin: http://127.0.0.1:${port} (project: ${credentials.project_id})`));
}
if (require.main === module) start().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { createLocalServer };
