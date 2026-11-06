const { test } = require('node:test');
const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, Timestamp, GeoPoint } = require('firebase-admin/firestore');
const { remapReferences, copyCollection } = require('../scripts/migrate-firestore.cjs');

test('remaps nested document references while preserving SDK values', async () => {
  const a = initializeApp({ projectId: 'migration-test-source' }, 'test-source');
  const b = initializeApp({ projectId: 'migration-test-target' }, 'test-target');
  try {
    const source = getFirestore(a);
    const destination = getFirestore(b);
    const timestamp = Timestamp.now();
    const point = new GeoPoint(1, 2);
    const bytes = Buffer.from('test');
    const result = remapReferences({ nested: [{ ref: source.doc('a/b') }], timestamp, point, bytes }, source, destination);
    assert.equal(result.nested[0].ref.firestore, destination);
    assert.equal(result.nested[0].ref.path, 'a/b');
    assert.equal(result.timestamp, timestamp);
    assert.equal(result.point, point);
    assert.equal(result.bytes, bytes);
    assert.throws(() => remapReferences(destination.doc('a/b'), source, destination), /outside/);
  } finally {
    await Promise.all([deleteApp(a), deleteApp(b)]);
  }
});

test('copies descendants of missing parents and dry run performs no writes', async () => {
  const child = { path: 'a/missing/b', listDocuments: async () => [leaf] };
  const parent = { path: 'a/missing', listCollections: async () => [child] };
  const leaf = { path: 'a/missing/b/c', listCollections: async () => [] };
  const root = { path: 'a', listDocuments: async () => [parent] };
  const source = { getAll: async (...refs) => refs.map(ref => ({ ref, exists: ref === leaf, data: () => ({ ok: true }) })) };
  const writes = [];
  const destination = { doc: path => ({ create: async data => writes.push({ path, data }), set: async () => { throw Error('unexpected overwrite'); } }) };
  for (const apply of [false, true]) {
    const counts = { read: 0, written: 0, missingParents: 0 };
    await copyCollection(root, source, destination, { apply }, counts);
    assert.deepEqual(counts, { read: 1, written: Number(apply), missingParents: 1 });
  }
  assert.deepEqual(writes, [{ path: leaf.path, data: { ok: true } }]);
});

test('exclusions skip exact collection subtrees before reading documents in preview and copy modes', async () => {
  for (const apply of [false, true]) {
    const excluded = { path: 'schools/one/logs', listDocuments: async () => { throw Error('excluded collection read'); } };
    await copyCollection(excluded, {}, {}, { apply, exclude: ['schools/one/logs'] }, {});
    let listed = false;
    const included = { path: 'schools/two/logs', listDocuments: async () => { listed = true; return []; } };
    await copyCollection(included, {}, {}, { apply, exclude: ['logs', 'schools/one/logs'] }, {});
    assert.equal(listed, true);
  }
});
