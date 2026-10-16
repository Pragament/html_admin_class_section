import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
    getAuth,
    GoogleAuthProvider,
    onAuthStateChanged,
    signInWithPopup,
    signOut
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
    collection,
    getDocs,
    getFirestore
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';


const COLLECTIONS = {
    questions: 'qb_questions_v1',
    sections: 'classSections',
    submissions: 'qb_quiz_submissions_v1'
};
// Question class/subject/options rarely change, so they are cached to avoid re-reading every question on each visit.
const QUESTION_CACHE_KEY = `studentRecords.questionMeta.v2.${firebaseConfig.projectId}`;
const QUESTION_CACHE_TTL = 12 * 60 * 60 * 1000;
const PAGE_SIZE = 100;
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 };

const ADMIN_EMAILS = [];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let answers = [];
let visibleLimit = PAGE_SIZE;
let toastTimer = null;

const $ = (id) => document.getElementById(id);
const els = {
    topbar: $('topbar'),
    statusText: $('statusText'),
    loginView: $('loginView'),
    dashboardView: $('dashboardView'),
    loginBtn: $('loginBtn'),
    logoutBtn: $('logoutBtn'),
    refreshBtn: $('refreshBtn'),
    adminLabel: $('adminLabel'),
    exportBtn: $('exportBtn'),
    searchInput: $('searchInput'),
    sectionFilter: $('sectionFilter'),
    classFilter: $('classFilter'),
    subjectFilter: $('subjectFilter'),
    typeFilter: $('typeFilter'),
    verifiedFilter: $('verifiedFilter'),
    startDateFilter: $('startDateFilter'),
    endDateFilter: $('endDateFilter'),
    resultCount: $('resultCount'),
    answerTableWrap: $('answerTableWrap'),
    showMoreBtn: $('showMoreBtn'),
    toast: $('toast')
};

bindEvents();

onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    const allowed = isAllowedAdmin(user);
    els.topbar.hidden = !allowed;
    els.loginView.hidden = allowed;
    els.dashboardView.hidden = !allowed;

    if (!user) {
        answers = [];
        setStatus('Sign in with Google');
        renderAnswers();
        return;
    }

    if (!allowed) {
        answers = [];
        await signOut(auth);
        toast('This Google account is not allowed for admin access');
        renderAnswers();
        return;
    }

    els.adminLabel.textContent = user.email || user.displayName || user.uid;
    await loadData();
});

function bindEvents() {
    els.loginBtn.addEventListener('click', login);
    els.logoutBtn.addEventListener('click', () => signOut(auth));
    els.refreshBtn.addEventListener('click', () => loadData({ refreshQuestions: true }));
    els.exportBtn.addEventListener('click', exportCsv);
    els.searchInput.addEventListener('input', resetAndRender);
    [els.sectionFilter, els.classFilter, els.subjectFilter, els.typeFilter, els.verifiedFilter, els.startDateFilter, els.endDateFilter]
        .forEach(el => el.addEventListener('change', resetAndRender));
    els.showMoreBtn.addEventListener('click', () => {
        visibleLimit += PAGE_SIZE;
        renderAnswers();
    });
}

async function login() {
    await signInWithPopup(auth, new GoogleAuthProvider());
}

function isAllowedAdmin(user) {
    if (!user) return false;
    if (!ADMIN_EMAILS.length) return true;
    return ADMIN_EMAILS.includes(String(user.email || '').toLowerCase());
}

async function loadData({ refreshQuestions = false } = {}) {
    if (!currentUser) return;
    setStatus('Loading student records...');
    try {
        const [sectionSnap, submissionSnap, questionMeta] = await Promise.all([
            getDocs(collection(db, COLLECTIONS.sections)),
            getDocs(collection(db, COLLECTIONS.submissions)),
            loadQuestionMeta(refreshQuestions)
        ]);
        const sectionNames = new Map(sectionSnap.docs.map(d => {
            const data = d.data();
            return [d.id, data.sectionName || data.name || data.className || data.title || d.id];
        }));
        answers = submissionSnap.docs.flatMap(d => answerRows({ id: d.id, ...d.data() }, sectionNames, questionMeta))
            .sort((a, b) => b.submittedMillis - a.submittedMillis);
        renderFilterOptions();
        resetAndRender();
        setStatus(`${answers.length} answers from ${submissionSnap.size} submissions`);
    } catch (error) {
        answers = [];
        renderAnswers();
        setStatus(error.message || 'Unable to load student records');
        toast('Unable to load student records');
    }
}

async function loadQuestionMeta(forceRefresh) {
    if (!forceRefresh) {
        try {
            const cached = JSON.parse(localStorage.getItem(QUESTION_CACHE_KEY) || 'null');
            if (cached && Date.now() - cached.savedAt < QUESTION_CACHE_TTL) return cached.items;
        } catch (error) {
            // Ignore unreadable cache and fall through to Firestore.
        }
    }
    const snap = await getDocs(collection(db, COLLECTIONS.questions));
    const items = {};
    snap.docs.forEach(d => {
        const q = d.data();
        items[d.id] = [
            classLabel(q.classId || q.className),
            subjectLabel(q.subjectId || q.subject),
            (q.options || []).map(option => stripHtml(option?.html)),
            q.type === 'short_answer' ? stripHtml(q.shortAnswerHtml) : '',
            q.verified === true
        ];
    });
    try {
        localStorage.setItem(QUESTION_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), items }));
    } catch (error) {
        // Storage may be full or blocked; the page still works without the cache.
    }
    return items;
}

function answerRows(submission, sectionNames, questionMeta) {
    const studentName = submission.studentName || submission.name || submission.admissionNo || '';
    const sectionName = sectionNames.get(submission.sectionId) || submission.sectionName || submission.sectionId || '';
    const submittedAt = submittedMillis(submission);
    return (submission.answers || []).map(answer => {
        const [qClass, qSubject, options, currentShortAnswer, verified] = questionMeta[answer.questionId] || [];
        return {
            studentName,
            admissionNo: String(submission.admissionNo || ''),
            sectionId: submission.sectionId || '',
            sectionName,
            className: qClass || classLabel(submission.className),
            subject: qSubject || subjectLabel(submission.subject),
            submittedMillis: submittedAt,
            questionId: answer.questionId || '',
            type: answer.type || '',
            verified: verified === true,
            question: stripHtml(answer.promptHtml),
            // Short answers use the question's current model answer, since submission snapshots keep old placeholders.
            teacherAnswer: currentShortAnswer || teacherAnswerText(answer),
            studentAnswer: studentAnswerText(answer, options || []),
            result: answer.isCorrect === true ? 'correct' : answer.isCorrect === false ? 'wrong' : 'review'
        };
    });
}

function renderFilterOptions() {
    fillSelect(els.sectionFilter, 'All sections', uniqueOptions(row => [row.sectionId, row.sectionName]));
    fillSelect(els.classFilter, 'All classes', uniqueOptions(row => [row.className, row.className]), classSortKey);
    fillSelect(els.subjectFilter, 'All subjects', uniqueOptions(row => [row.subject, row.subject]));
}

function uniqueOptions(pick) {
    const map = new Map();
    answers.forEach(row => {
        const [value, label] = pick(row);
        if (value && !map.has(value)) map.set(value, label || value);
    });
    return [...map.entries()];
}

function fillSelect(select, allLabel, options, sortKey = label => label) {
    const current = select.value;
    options.sort((a, b) => String(sortKey(a[1])).localeCompare(String(sortKey(b[1])), undefined, { numeric: true, sensitivity: 'base' }));
    select.innerHTML = `<option value="all">${esc(allLabel)}</option>`
        + options.map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join('');
    select.value = options.some(([value]) => value === current) ? current : 'all';
}

function resetAndRender() {
    visibleLimit = PAGE_SIZE;
    renderAnswers();
}

function renderAnswers() {
    const rows = filteredAnswers();
    const shown = rows.slice(0, visibleLimit);
    els.resultCount.textContent = rows.length
        ? `Showing ${shown.length} of ${rows.length} answer${rows.length === 1 ? '' : 's'}`
        : '';
    els.showMoreBtn.hidden = shown.length >= rows.length;
    els.answerTableWrap.innerHTML = rows.length ? `
        <table class="section-table qa-table">
            <thead>
                <tr>
                    <th scope="col">Question</th>
                    <th scope="col">Teacher's Answer</th>
                    <th scope="col">Student's Answer</th>
                </tr>
            </thead>
            <tbody>
                ${shown.map(row => `
                    <tr>
                        <td>
                            <div>${esc(row.question)}</div>
                            <div class="answer-meta">${esc([row.studentName, row.sectionName, row.subject, formatDate(row.submittedMillis)].filter(Boolean).join(' · '))}</div>
                        </td>
                        <td>${esc(row.teacherAnswer) || '<span class="answer-meta">No answer stored</span>'}</td>
                        <td><span class="answer-text ${row.result}" title="${resultLabel(row.result)}">${esc(row.studentAnswer) || 'Not answered'}</span></td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    ` : '<div class="empty-card">No answers match these filters.</div>';
}

function filteredAnswers() {
    const search = els.searchInput.value.trim().toLowerCase();
    const section = els.sectionFilter.value;
    const className = els.classFilter.value;
    const subject = els.subjectFilter.value;
    const type = els.typeFilter.value;
    const verified = els.verifiedFilter.value;
    const [start, end] = dateRange();
    return answers.filter(row => {
        if (section !== 'all' && row.sectionId !== section) return false;
        if (className !== 'all' && row.className !== className) return false;
        if (subject !== 'all' && row.subject !== subject) return false;
        if (type !== 'all' && row.type !== type) return false;
        if (verified === 'verified' && !row.verified) return false;
        if (verified === 'unverified' && row.verified) return false;
        if (start !== null && row.submittedMillis < start) return false;
        if (end !== null && row.submittedMillis >= end) return false;
        if (!search) return true;
        return [row.studentName, row.admissionNo, row.question, row.teacherAnswer, row.studentAnswer, row.questionId]
            .some(value => String(value || '').toLowerCase().includes(search));
    });
}

function dateRange() {
    let start = dayStartMillis(els.startDateFilter.value);
    let end = dayStartMillis(els.endDateFilter.value, 1);
    if (start !== null && end !== null && start >= end) {
        [start, end] = [dayStartMillis(els.endDateFilter.value), dayStartMillis(els.startDateFilter.value, 1)];
    }
    return [start, end];
}

function dayStartMillis(inputValue, dayOffset = 0) {
    if (!inputValue) return null;
    const [year, month, day] = inputValue.split('-').map(Number);
    return new Date(year, month - 1, day + dayOffset).getTime();
}

function teacherAnswerText(answer) {
    return stripHtml(answer.correctAnswer).replace(/^Option ([A-Z]):\s*/, '$1) ');
}

function studentAnswerText(answer, options) {
    if (answer.type === 'mcq' && Array.isArray(answer.selectedOptions) && answer.selectedOptions.length) {
        return answer.selectedOptions.map(index => {
            const letter = String.fromCharCode(65 + Number(index));
            return options[index] ? `${letter}) ${options[index]}` : `Option ${letter}`;
        }).join(', ');
    }
    if (answer.shortAnswer) return stripHtml(answer.shortAnswer);
    if (typeof answer.trueFalseAnswer === 'boolean') return answer.trueFalseAnswer ? 'True' : 'False';
    if (Array.isArray(answer.fibAnswers) && answer.fibAnswers.some(Boolean)) return answer.fibAnswers.join('; ');
    return stripHtml(answer.displayAnswer);
}

function resultLabel(result) {
    if (result === 'correct') return 'Correct';
    if (result === 'wrong') return 'Wrong';
    return 'Needs review';
}

function classLabel(value) {
    const raw = String(value || '').trim().replace(/^class[_\s-]*/i, '');
    if (!raw) return '';
    const number = ROMAN[raw.toLowerCase()] || raw.toUpperCase();
    return `Class ${number}`;
}

function classSortKey(label) {
    const number = Number(String(label).replace(/^Class\s+/, ''));
    return Number.isFinite(number) ? String(number).padStart(3, '0') : label;
}

function subjectLabel(value) {
    const slug = String(value || '').split('__subject_').pop().trim();
    if (!slug) return '';
    if (slug.length <= 3) return slug.toUpperCase();
    return slug.replace(/[-_]+/g, ' ').toLowerCase().replace(/\b\w/g, char => char.toUpperCase());
}

function exportCsv() {
    const rows = filteredAnswers();
    if (!rows.length) {
        toast('No answers to export');
        return;
    }
    const csv = [['Student ID', 'Question ID', 'Subject', 'Question', 'Correct Answer', 'Student Answer']]
        .concat(rows.map(row => [
            row.admissionNo, row.questionId, row.subject, row.question, row.teacherAnswer, row.studentAnswer
        ]))
        .map(row => row.map(value => {
            const text = String(value ?? '');
            return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
        }).join(','))
        .join('\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'student-records.csv';
    a.click();
    URL.revokeObjectURL(url);
}

function submittedMillis(submission) {
    if (Number.isFinite(Number(submission.submittedAtMillis))) return Number(submission.submittedAtMillis);
    const submittedAt = submission.submittedAt;
    if (submittedAt?.toMillis) return submittedAt.toMillis();
    if (submittedAt?.toDate) return submittedAt.toDate().getTime();
    if (Number.isFinite(Number(submittedAt?.seconds))) {
        return (Number(submittedAt.seconds) * 1000) + Math.floor(Number(submittedAt.nanoseconds || 0) / 1000000);
    }
    return 0;
}

function formatDate(value) {
    const millis = Number(value || 0);
    if (!millis) return '';
    return new Date(millis).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function stripHtml(value) {
    const template = document.createElement('template');
    template.innerHTML = String(value || '');
    return (template.content.textContent || '').replace(/\s+/g, ' ').trim();
}

function setStatus(message) {
    els.statusText.textContent = message;
}

function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2400);
}

function esc(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}
