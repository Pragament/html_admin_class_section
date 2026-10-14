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
