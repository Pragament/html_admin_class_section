const { AccountError } = require('./student-service');
function createSchoolService({ db, timestamp, requireAdmin }) {
    const fail = (code, message) => { throw new AccountError(code, message); };
    const code = value => {
        const result = String(value || '').trim().toUpperCase();
        if (!/^[A-Z0-9][A-Z0-9-]{0,31}$/.test(result)) fail('invalid-argument', 'Code must contain 1–32 letters, digits or hyphens.');
        return result;
    };
    const admission = value => {
        const result = String(value || '').trim().toUpperCase();
        if (!/^[A-Z0-9][A-Z0-9_-]{0,63}$/.test(result)) fail('invalid-argument', 'Admission number is required and must contain letters, digits, hyphens or underscores.');
        return result;
    };
    const id = value => {
        if (typeof value !== 'string' || !value || value.includes('/') || value.length > 500 || ['.', '..'].includes(value)) fail('invalid-argument', 'Invalid document ID.');
        return value;
    };
    const clean = data => {
        const name = String(data.name || '').trim();
        if (!name || name.length > 200) fail('invalid-argument', 'Name is required (maximum 200 characters).');
        const address = String(data.address || '').trim();
        if (address.length > 1000) fail('invalid-argument', 'Address is too long.');
        return { name, address, enabled: data.enabled !== false };
    };
    async function sectionAccess(request, section) {
        if (!request.auth) fail('unauthenticated', 'Sign in first.');
        const email = String(request.auth.token.email || '').toLowerCase();
        if ((section.members || []).some(member => member.email === email && member.role === 'admin')) return;
        await requireAdmin(request);
    }
    async function manageSchoolStructure(request) {
        await requireAdmin(request);
        const data = request.data || {};
        const branch = data.kind === 'branch';
        if (!branch && data.kind !== 'organisation') fail('invalid-argument', 'Choose organisation or branch.');
        const key = code(data.code);
        const ref = db.doc(`${branch ? 'schoolBranches' : 'schoolOrganisations'}/${key}`);
        return db.runTransaction(async tx => {
            const old = await tx.get(ref);
            if (data.action === 'delete') {
                if (!old.exists) fail('not-found', 'Record not found.');
                const children = await tx.get(branch ? db.collection('classSections').where('branchId', '==', key).limit(1)
                    : db.collection('schoolBranches').where('orgId', '==', key).limit(1));
                if (!children.empty) fail('failed-precondition', branch ? 'Delete empty sections before deleting this branch; disable branches with students instead.' : 'Delete the organisation’s branches first.');
                const admissions = branch ? await tx.get(ref.collection('admissions').limit(1)) : null;
                if (admissions && !admissions.empty) fail('failed-precondition', 'This branch has registered students; disable it instead.');
                tx.delete(ref);
                return { id: key, status: 'deleted' };
            }
            if (data.action !== 'save') fail('invalid-argument', 'Invalid action.');
            if (old.exists && old.data().authUid && !syncLinked) fail('failed-precondition', 'Use the student account controls to update a linked student.');
            if (data.create === true && old.exists) fail('already-exists', 'This code is already in use.');
            if (data.create !== true && !old.exists) fail('not-found', 'Record not found.');
            const fields = clean(data);
            if (branch) {
                const orgId = code(data.orgId);
                const org = await tx.get(db.doc(`schoolOrganisations/${orgId}`));
                if (!org.exists) fail('not-found', 'Choose an existing organisation.');
                if (old.exists && old.data().orgId !== orgId) fail('failed-precondition', 'A branch cannot be moved to another organisation.');
                fields.orgId = orgId;
            }
            tx.set(ref, { ...fields, code: key, updatedAt: timestamp(), updatedBy: request.auth.uid,
                ...(!old.exists ? { createdAt: timestamp() } : {}) }, { merge: true });
            return { id: key, status: old.exists ? 'updated' : 'created' };
        });
    }
    function claim(tx, branchRef, sectionId, studentId, student, existing, claimSnapshot) {
        const admissionNo = admission(student.admissionNo);
        const canonicalId = `${branchRef.id}-${admissionNo}`;
        const registry = claimSnapshot.exists ? claimSnapshot.data() : {};
        const phone = String(student.phone || '').replace(/\D/g, '');
        const name = String(student.studentName || student.name || '').trim();
        if (!name) fail('invalid-argument', 'Student name is required.');
        if (claimSnapshot.exists && registry.sections?.[sectionId] !== studentId
            && (phone.length < 6 || registry.phoneDigits !== phone || String(registry.name || '').toLowerCase() !== name.toLowerCase())) {
            fail('already-exists', `Admission ${admissionNo} already belongs to ${registry.name} in this branch. Name and full phone must match to reuse the student in another section.`);
        }
        if (claimSnapshot.exists && registry.sections?.[sectionId] && registry.sections[sectionId] !== studentId) fail('already-exists', 'Admission number already exists in this section.');
        if (existing && String(existing.admissionNo || existing.id).trim().toUpperCase() !== admissionNo) fail('failed-precondition', 'Admission number cannot be changed after registration.');
        tx.set(claimSnapshot.ref, { admissionNo, studentId: canonicalId, name, phoneDigits: phone,
            sections: { ...(registry.sections || {}), [sectionId]: studentId }, updatedAt: timestamp() }, { merge: true });
        return { admissionNo, branchStudentId: canonicalId };
    }
    async function saveSchoolSection(request) {
        const data = request.data || {};
        const ref = data.sectionId ? db.doc(`classSections/${id(data.sectionId)}`) : db.collection('classSections').doc();
        const old = await ref.get();
        if (old.exists) await sectionAccess(request, old.data()); else await requireAdmin(request);
        const incoming = data.section || {};
        const branchId = incoming.branchId ? code(incoming.branchId) : old.data()?.branchId;
        if (!branchId) fail('failed-precondition', 'Choose a school branch for this section.');
        if (!old.exists || old.data().branchId !== branchId) await requireAdmin(request);
        return db.runTransaction(async tx => {
            const section = await tx.get(ref);
            const branchRef = db.doc(`schoolBranches/${branchId}`);
            const branch = await tx.get(branchRef);
            if (!branch.exists) fail('not-found', 'School branch not found.');
            if (section.exists && section.data().branchId && section.data().branchId !== branchId) fail('failed-precondition', 'An assigned section cannot change branches.');
            const roster = await tx.get(ref.collection('students'));
            if (roster.size > 200 && !section.data()?.branchId) fail('failed-precondition', 'Legacy sections with over 200 students need a staged migration before assignment.');
            const claims = !section.data()?.branchId ? await Promise.all(roster.docs.map(student => tx.get(branchRef.collection('admissions').doc(admission(student.data().admissionNo || student.id))))) : [];
            const seen = new Set();
            roster.docs.forEach((student, index) => {
                if (!claims.length) return;
                const fields = student.data();
                const admissionNo = admission(fields.admissionNo || student.id);
                if (seen.has(admissionNo)) fail('already-exists', 'Duplicate admission numbers in the section. Correct the roster before assigning a branch.');
                seen.add(admissionNo);
                const identity = claim(tx, branchRef, ref.id, student.id, { ...fields, admissionNo }, null, claims[index]);
                // Existing IDs and login student keys remain stable.
                tx.set(student.ref, { ...identity, admissionNo: fields.admissionNo || student.id, branchId, orgId: branch.data().orgId }, { merge: true });
            });
            const fields = {};
            for (const key of ['sectionName', 'className', 'title', 'sortOrder', 'enabled', 'members']) if (incoming[key] !== undefined) fields[key] = incoming[key];
            if (!(fields.sectionName || section.data()?.sectionName)) fail('invalid-argument', 'Section name is required.');
            if (fields.sectionName !== undefined && (typeof fields.sectionName !== 'string' || !fields.sectionName.trim() || fields.sectionName.length > 200)) fail('invalid-argument', 'Section name must contain 1–200 characters.');
            if (fields.members !== undefined && (!Array.isArray(fields.members) || fields.members.some(member => typeof member.email !== 'string' || member.email !== member.email.toLowerCase() || !['admin', 'viewer'].includes(member.role)))) fail('invalid-argument', 'Invalid section memberships.');
            if (fields.sectionName) fields.name = fields.sectionName;
            tx.set(ref, { ...fields, branchId, branchCode: branchId, orgId: branch.data().orgId,
                updatedAt: timestamp(), updatedBy: request.auth.uid,
                ...(!section.exists ? { createdAt: timestamp(), createdDate: Date.now() } : {}) }, { merge: true });
            return { id: ref.id, branchId, orgId: branch.data().orgId };
        });
    }
    async function saveSchoolStudent(request, syncLinked = false) {
        const data = request.data || {};
        const sectionRef = db.doc(`classSections/${id(data.sectionId)}`);
        const section = await sectionRef.get();
        if (!section.exists) fail('not-found', 'Section not found.');
        await sectionAccess(request, section.data());
        const branchId = section.data().branchId;
        if (!branchId) fail('failed-precondition', 'Assign this section to a school branch before adding or importing students.');
        const input = data.student || {};
        const admissionNo = admission(input.admissionNo);
        const canonicalId = `${branchId}-${admissionNo}`;
        const studentId = data.studentId ? id(data.studentId) : canonicalId;
        const ref = sectionRef.collection('students').doc(studentId);
        return db.runTransaction(async tx => {
            const currentSection = await tx.get(sectionRef);
            if (currentSection.data()?.branchId !== branchId) fail('failed-precondition', 'Section branch changed; refresh.');
            const branchRef = db.doc(`schoolBranches/${branchId}`);
            const branch = await tx.get(branchRef);
            if (!branch.exists) fail('not-found', 'School branch not found.');
            const old = await tx.get(ref);
            if (old.exists && old.data().authUid && !syncLinked) fail('failed-precondition', 'Use the student account controls to update a linked student.');
            if (data.create === true && old.exists) fail('already-exists', 'Student ID already exists.');
            if ((!old.exists || data.import === true) && studentId !== canonicalId) fail('invalid-argument', `Student ID must be ${canonicalId} (branch code and admission number).`);
            const student = { ...(old.exists ? old.data() : {}), ...input };
            const registry = await tx.get(branchRef.collection('admissions').doc(admissionNo));
            const identity = claim(tx, branchRef, sectionRef.id, studentId, student, old.exists ? { ...old.data(), id: old.id } : null, registry);
            if (old.exists) identity.admissionNo = old.data().admissionNo || old.id;
            const fields = {};
            for (const key of ['studentName', 'name', 'phone', 'enabled', 'email']) if (input[key] !== undefined) {
                if (key === 'enabled' ? typeof input[key] !== 'boolean' : typeof input[key] !== 'string' || input[key].length > 500) fail('invalid-argument', 'Invalid student field.');
                fields[key] = input[key];
            }
            tx.set(ref, { ...fields, ...identity, branchId, orgId: branch.data().orgId,
                updatedAt: timestamp(), updatedBy: request.auth.uid,
                ...(!old.exists ? { createdAt: timestamp(), createdDate: Date.now() } : {}) }, { merge: true });
            return { id: studentId, ...identity };
        });
    }
    async function deleteSchoolStudent(request) {
        const data = request.data || {};
        const sectionRef = db.doc(`classSections/${id(data.sectionId)}`);
        const section = await sectionRef.get();
        if (!section.exists) fail('not-found', 'Section not found.');
        await sectionAccess(request, section.data());
        const ref = sectionRef.collection('students').doc(id(data.studentId));
        return db.runTransaction(async tx => {
            const student = await tx.get(ref);
            if (!student.exists) fail('not-found', 'Student not found.');
            if (student.data().authUid) fail('failed-precondition', 'Disable linked students instead of deleting them.');
            const branchId = section.data().branchId;
            const registryRef = branchId ? db.doc(`schoolBranches/${branchId}/admissions/${admission(student.data().admissionNo || student.id)}`) : null;
            const registry = registryRef ? await tx.get(registryRef) : null;
            if (registry?.exists) {
                const sections = { ...registry.data().sections };
                delete sections[data.sectionId];
                if (Object.keys(sections).length) tx.update(registryRef, { sections }); else tx.delete(registryRef);
            }
            tx.delete(ref);
            return { status: 'deleted' };
        });
    }
    async function deleteSchoolSection(request) {
        const ref = db.doc(`classSections/${id(request.data?.sectionId)}`);
        const section = await ref.get();
        if (!section.exists) fail('not-found', 'Section not found.');
        await sectionAccess(request, section.data());
        return db.runTransaction(async tx => {
            await tx.get(ref);
            const roster = await tx.get(ref.collection('students').limit(1));
            if (!roster.empty) fail('failed-precondition', 'This section has students. Disable it instead of deleting it.');
            tx.delete(ref);
            return { status: 'deleted' };
        });
    }
    return { manageSchoolStructure, saveSchoolSection, saveSchoolStudent, deleteSchoolStudent, deleteSchoolSection };
}
module.exports = { createSchoolService };
