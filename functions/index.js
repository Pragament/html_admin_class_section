const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { createStudentService, AccountError } = require('./student-service');
initializeApp();
const service = createStudentService({ db: getFirestore(), auth: getAuth(), timestamp: () => FieldValue.serverTimestamp() });
function callable(handler) {
    return async request => {
        try { return await handler(request); }
        catch (error) {
            if (error instanceof AccountError) throw new HttpsError(error.code, error.message);
            throw new HttpsError('internal', 'Student operation failed. Retry to complete synchronization.');
        }
    };
}
exports.manageStudentAccount = onCall(callable(service.manageStudentAccount));
exports.migrateStudentProfiles = onCall({ timeoutSeconds: 540 }, callable(service.migrateStudentProfiles));
