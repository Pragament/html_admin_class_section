#!/usr/bin/env node
'use strict';

// Standalone: requires only Node.js and firebase-admin. Credentials stay on disk.
const { readFileSync } = require('node:fs');
const { parseArgs } = require('node:util');
const { initializeApp, cert, deleteApp } = require('firebase-admin/app');
const { getFirestore, DocumentReference } = require('firebase-admin/firestore');

function remapReferences(value, source, destination) {
  if (value instanceof DocumentReference) {
    if (value.firestore !== source) throw new Error('Found a reference outside the source database');
    return destination.doc(value.path);
  }
  if (Array.isArray(value)) return value.map(item => remapReferences(item, source, destination));
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) =>
      [key, remapReferences(item, source, destination)]));
  }
  // Preserve Timestamp, GeoPoint, Buffer, VectorValue and other SDK value types.
  return value;
}

async function copyCollection(collection, source, destination, options, counts) {
  if ((options.exclude || []).includes(collection.path)) {
    console.log(`Excluded collection subtree: ${collection.path}`);
    return;
  }
  // Includes nonexistent parent documents that still contain subcollections.
  const refs = await collection.listDocuments();
  for (let offset = 0; offset < refs.length; offset += 100) {
    const snapshots = await source.getAll(...refs.slice(offset, offset + 100));
    for (const snapshot of snapshots) {
      if (snapshot.exists) {
        counts.read++;
        const data = remapReferences(snapshot.data(), source, destination);
        if (options.apply) {
          const target = destination.doc(snapshot.ref.path);
          try {
            if (options.overwrite) await target.set(data);
            else await target.create(data);
          } catch (error) {
            throw new Error(`Write failed at ${snapshot.ref.path}: ${error.message}`, { cause: error });
          }
          counts.written++;
        }
      } else counts.missingParents++;
      for (const child of await snapshot.ref.listCollections()) {
        await copyCollection(child, source, destination, options, counts);
      }
    }
    console.log(JSON.stringify({ collection: collection.path, ...counts }));
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    source: { type: 'string' }, destination: { type: 'string' },
    'source-database': { type: 'string', default: '(default)' },
    'destination-database': { type: 'string', default: '(default)' },
    apply: { type: 'boolean', default: false },
    overwrite: { type: 'boolean', default: false },
    exclude: { type: 'string', multiple: true, default: [] },
    help: { type: 'boolean', short: 'h', default: false },
  } });
  if (values.help) {
    console.log('Usage: node migrate-firestore.cjs --source /path/source.json --destination /path/destination.json [--source-database ID] [--destination-database ID] [--exclude COLLECTION_PATH ...] [--apply] [--overwrite]\nDefault: read-only dry run. --apply writes; --overwrite replaces existing documents. Repeat --exclude for each exact collection path; its entire subtree is skipped.');
    return;
  }
  if (!values.source || !values.destination) throw new Error('--source and --destination service-account JSON paths are required');
  for (const path of values.exclude) {
    const segments = path.split('/');
    if (segments.length % 2 !== 1 || segments.some(segment => !segment || segment === '.' || segment === '..') || path.includes('*')) {
      throw new Error(`Invalid --exclude collection path: ${path}. Use an exact path such as logs or schools/school1/logs (no wildcards).`);
    }
  }
  if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Unset FIRESTORE_EMULATOR_HOST before migrating accounts');
  const sourceKey = JSON.parse(readFileSync(values.source, 'utf8'));
  const destinationKey = JSON.parse(readFileSync(values.destination, 'utf8'));
  for (const key of [sourceKey, destinationKey]) {
    if (!key.project_id || !key.client_email || !key.private_key) throw new Error('Each key must be a service-account JSON with project_id, client_email and private_key');
  }
  if (sourceKey.project_id === destinationKey.project_id && values['source-database'] === values['destination-database']) {
    throw new Error('Source and destination must be different databases');
  }
  const apps = [];
  const counts = { read: 0, written: 0, missingParents: 0 };
  try {
    const sourceApp = initializeApp({ credential: cert(sourceKey), projectId: sourceKey.project_id }, 'migration-source');
    apps.push(sourceApp);
    const destinationApp = initializeApp({ credential: cert(destinationKey), projectId: destinationKey.project_id }, 'migration-destination');
    apps.push(destinationApp);
    const source = getFirestore(sourceApp, values['source-database']);
    const destination = getFirestore(destinationApp, values['destination-database']);
    console.log(`${values.apply ? 'COPY' : 'DRY RUN'}: ${sourceKey.project_id}/${values['source-database']} -> ${destinationKey.project_id}/${values['destination-database']}`);
    if (values.exclude.length) console.log(`Excluded collection paths: ${values.exclude.join(', ')}`);
    for (const collection of await source.listCollections()) {
      await copyCollection(collection, source, destination, values, counts);
    }
    console.log(`Completed: ${JSON.stringify(counts)}`);
  } catch (error) {
    console.error(`Stopped; partial progress: ${JSON.stringify(counts)}`);
    throw error;
  } finally {
    await Promise.all(apps.map(app => deleteApp(app)));
  }
}

if (require.main === module) main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});

module.exports = { remapReferences, copyCollection };
