// Shared Firebase config for every admin page.
// To use your own Firebase project, copy firebase-config.local.example.js to
// firebase-config.local.js (git-ignored) and paste your project's config there.

export const teamFirebaseConfig = {
    apiKey: 'AIzaSyAYlezFn0tSSQHA-vRnJeBfJ-Om1YlDghk',
    authDomain: 'eschool-dev-4c6b4.firebaseapp.com',
    projectId: 'eschool-dev-4c6b4',
    storageBucket: 'eschool-dev-4c6b4.firebasestorage.app',
    messagingSenderId: '875648503944',
    appId: '1:875648503944:web:5423a89ccd19e06c6f0f3d',
    measurementId: 'G-05GNVCMP1F'
};

async function loadLocalConfig() {
    try {
        const module = await import('./firebase-config.local.js');
        return module.localFirebaseConfig || null;
    } catch {
        return null;
    }
}

export const localFirebaseConfig = await loadLocalConfig();
export const firebaseConfig = localFirebaseConfig || teamFirebaseConfig;

if (localFirebaseConfig) {
    console.info(`Using local Firebase project: ${localFirebaseConfig.projectId}`);
}
