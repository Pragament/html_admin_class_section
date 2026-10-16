const { test } = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../question-filters.js');

const translated = {
    explanation: 'English',
    translations: { Hindi: { explanation: 'हिंदी' }, Telugu: { explanation: 'తెలుగు' } }
};

test('explanation filter: has, missing and Hindi + Telugu translations', async () => {
    const { matchesExplanationFilter } = await load();
    const plain = { explanation: 'English only' };
    const blank = { explanation: '   ' };
    const hindiOnly = { explanation: 'English', translations: { Hindi: { explanation: 'हिंदी' }, Telugu: { question: 'q' } } };
    const noEnglish = { translations: translated.translations };

    assert.equal(matchesExplanationFilter(plain, 'has'), true);
    assert.equal(matchesExplanationFilter(blank, 'has'), false);
    assert.equal(matchesExplanationFilter(blank, 'missing'), true);
    assert.equal(matchesExplanationFilter(translated, 'translated'), true);
    assert.equal(matchesExplanationFilter(plain, 'translated'), false);
    assert.equal(matchesExplanationFilter(hindiOnly, 'translated'), false);
    assert.equal(matchesExplanationFilter(noEnglish, 'translated'), false);
    assert.equal(matchesExplanationFilter(blank, 'all'), true);
});

test('hints filter ignores blank and non-array hints', async () => {
    const { matchesHintsFilter } = await load();
    assert.equal(matchesHintsFilter({ hints: ['Think about c/a'] }, 'has'), true);
    assert.equal(matchesHintsFilter({ hints: ['', '  '] }, 'has'), false);
    assert.equal(matchesHintsFilter({ hints: 'not a list' }, 'missing'), true);
    assert.equal(matchesHintsFilter({}, 'missing'), true);
    assert.equal(matchesHintsFilter({}, 'all'), true);
});

test('translation filter needs every language to have question, answer and explanation', async () => {
    const { matchesTranslationFilter } = await load();
    const full = { question: 'प्रश्न', answer: 'उत्तर', explanation: 'व्याख्या' };
    const complete = { type: 'short_answer', translations: { English: {}, Hindi: full, Telugu: { ...full, prompt: 'x', question: '' } } };
    const missingQuestion = { type: 'short_answer', translations: { Hindi: { ...full, question: ' ' } } };
    const oneIncomplete = { type: 'short_answer', translations: { Hindi: full, Telugu: { ...full, explanation: '' } } };
    const mcqNoOptions = { type: 'mcq', translations: { Hindi: { ...full, options: ['', ' '] } } };
    const mcqWithOptions = { type: 'mcq', translations: { Hindi: { ...full, options: ['क', 'ख'] } } };
    const englishOnly = { type: 'short_answer', translations: { English: full } };

    assert.equal(matchesTranslationFilter(complete, 'has'), true);
    assert.equal(matchesTranslationFilter(missingQuestion, 'has'), false);
    assert.equal(matchesTranslationFilter(oneIncomplete, 'has'), false);
    assert.equal(matchesTranslationFilter(oneIncomplete, 'missing'), true);
    assert.equal(matchesTranslationFilter(mcqNoOptions, 'has'), true);
    assert.equal(matchesTranslationFilter(mcqWithOptions, 'has'), true);
    assert.equal(matchesTranslationFilter(englishOnly, 'has'), false);
    assert.equal(matchesTranslationFilter({}, 'missing'), true);
    assert.equal(matchesTranslationFilter({}, 'all'), true);
});
