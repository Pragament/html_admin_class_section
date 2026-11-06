# Copy Firestore to a new Firebase project

The standalone script is `scripts/migrate-firestore.cjs`. It uses private service-account JSON keys for both projects, never browser Firebase API keys. No keys are embedded in the script. The source is never modified.

## 1. Prepare both projects

1. Create the destination Firestore database in the Firebase console, choosing its permanent location carefully. This script supports Firestore Native mode.
2. In each project's **Project settings → Service accounts → Firebase Admin SDK → Generate new private key**, download a service-account JSON key (if your organization permits keys). You can also use existing dedicated service-account keys.
3. Grant the source service account **Cloud Datastore Viewer** (`roles/datastore.viewer`) on the source project and the destination service account **Cloud Datastore User** (`roles/datastore.user`) on the destination project. These server credentials use IAM and bypass Firestore security rules.
4. Store keys outside this repository, for example `~/.config/firestore-migration/source.json` and `~/.config/firestore-migration/destination.json`. Restrict access with `chmod 600` on both files. Never commit or share them, and revoke temporary keys after migration.
5. Pause writes from clients, servers, scheduled jobs, and functions during the final copy and validation. Reads happen over time, so this script does not provide a point-in-time snapshot. Pause destination writers too; consider destination triggers before copying because writes can invoke them.

## 2. Install

Use Node.js 22 or later. From this repository:

```sh
npm ci
```

To use the script independently, copy `migrate-firestore.cjs` to a separate folder, run `npm init -y` there, then `npm install firebase-admin@^14.5.0`. Invoke it with its new path instead of `scripts/migrate-firestore.cjs`.

## 3. Run a read-only preview

```sh
node scripts/migrate-firestore.cjs \
  --source "$HOME/.config/firestore-migration/source.json" \
  --destination "$HOME/.config/firestore-migration/destination.json"
```

Check the printed source and destination project IDs. The default database ID is `(default)` on both sides. For named databases, add `--source-database SOURCE_ID --destination-database DESTINATION_ID`.

The preview reads all source documents and counts them, incurring read charges, but does not write or check destination permissions or document conflicts. It requires both valid key files. The keys' `project_id` values select the projects; the app's local Firebase configuration is not used.

### Exclude collections

Repeat `--exclude` for each exact collection path in either preview or copy mode:

```sh
node scripts/migrate-firestore.cjs \
  --source "$HOME/.config/firestore-migration/source.json" \
  --destination "$HOME/.config/firestore-migration/destination.json" \
  --exclude logs \
  --exclude notifications \
  --exclude schools/school1/auditLogs \
  --apply
```

This skips each matching collection and all descendants, without reading its documents or writing them to the destination. Paths are relative to the database root, case-sensitive, and exact; `--exclude logs` excludes only the root `logs` collection, not every subcollection named `logs`. Wildcards are not supported. Omit `--apply` to preview. Keep the same exclusions when rerunning. Existing destination data in excluded collections remains untouched. Reference fields in included documents are still remapped, even if they point to excluded documents, so verify those targets exist separately. Excluded paths that do not exist have no effect.

## 4. Copy

Prefer an empty destination database. Add `--apply` to write:

```sh
node scripts/migrate-firestore.cjs \
  --source "$HOME/.config/firestore-migration/source.json" \
  --destination "$HOME/.config/firestore-migration/destination.json" \
  --apply
```

The script stops on the first error, including an existing destination document, and exits with a nonzero status. Completed writes remain. The final progress counters report successful writes. Logs include collection/document paths, so treat logs as potentially sensitive.

To rerun after a partial failure, or intentionally replace matching destination documents, use the same command with **both `--apply --overwrite`**. Overwrite replaces each matching document's fields with the source data; destination-only documents and subcollections remain. This is a copy, not an exact mirror or an atomic operation. There is no automatic rollback or resume checkpoint; a rerun reads everything again. Back up a populated destination before overwriting.

## 5. Validate and switch the app

1. Check the completion counters, then compare source and destination collection/document counts and representative documents in the Firebase console. Verify nested collections, timestamps, and reference fields. A successful run reports writes accepted, not an independent data comparison.
2. Deploy the required Firestore rules and indexes separately and wait for indexes to build. Migrate Firebase Authentication users separately if the app depends on their UIDs. Configure functions, IAM, and other Firebase services in the new project.
3. Update the app's Firebase configuration to the new project, test its login/read/write flows, then resume application traffic. Keep source writes paused until cutover is complete.

## Scope and operational limits

- Copies all discovered root collections and nested subcollections, preserving document IDs and paths. Missing ancestor documents remain missing while their descendants are copied.
- Preserves SDK data types such as timestamps, geographic points, bytes, and vectors. Document-reference fields are rewritten recursively to the same path in the destination database. Plain strings containing project IDs, URLs, Storage paths, or document paths are copied unchanged; review these separately.
- Does not copy indexes, rules, TTL settings, backups, document create/update metadata, Authentication, Storage files, Realtime Database, or project configuration. Destination TTL policies may expire copied documents.
- Performs sequential writes and reads documents in groups of 100. Document references for each collection are listed into memory, so very large collections may require substantial memory. Both reads and writes incur normal Firestore charges; dry runs still cost reads. Use Firebase's managed export/import for large production migrations.
- Rejects the same project/database pair and refuses to run when `FIRESTORE_EMULATOR_HOST` is set.

Official references: [Move data between projects](https://firebase.google.com/docs/firestore/manage-data/move-data), [Read documents and list subcollections](https://firebase.google.com/docs/firestore/query-data/get-data).
