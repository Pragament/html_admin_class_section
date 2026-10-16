// Pure filter checks for the Questions page, kept free of DOM/Firebase so Node tests can import them.
export const TRANSLATED_EXPLANATION_LANGUAGES = ['Hindi', 'Telugu'];

function hasText(value) {
    return Boolean(String(value ?? '').trim());
}

export function hasExplanation(question) {
    return hasText(question.explanation);
}

// True when the English explanation exists and every listed language has a translated explanation.
export function hasTranslatedExplanations(question, languages = TRANSLATED_EXPLANATION_LANGUAGES) {
    return hasExplanation(question) && languages.every(language => hasText(question.translations?.[language]?.explanation));
}

export function hasHints(question) {
    return Array.isArray(question.hints) && question.hints.some(hasText);
}

// Non-English language entries in `translations`, as [language, value] pairs.
export function translationEntries(translations) {
    if (!translations || typeof translations !== 'object' || Array.isArray(translations)) return [];
    return Object.entries(translations).filter(([language, value]) =>
        value && typeof value === 'object' && language.trim().toLowerCase() !== 'english'
    );
}

export function translationOptions(value) {
    return Array.isArray(value.options) ? value.options.filter(hasText) : [];
}

// A language counts only when it has a question, answer and explanation; MCQ options are not required.
export function isCompleteTranslation(value) {
    return hasText(value.question || value.prompt)
        && hasText(value.answer ?? value.correctAnswer)
        && hasText(value.explanation);
}

// "has" needs at least one language and every language complete, so no "Not provided" rows show.
export function hasCompleteTranslations(question) {
    const entries = translationEntries(question.translations);
    return entries.length > 0 && entries.every(([, value]) => isCompleteTranslation(value));
}

export function matchesTranslationFilter(question, value) {
    if (value === 'has') return hasCompleteTranslations(question);
    if (value === 'missing') return !hasCompleteTranslations(question);
    return true;
}

export function matchesExplanationFilter(question, value) {
    if (value === 'has') return hasExplanation(question);
    if (value === 'missing') return !hasExplanation(question);
    if (value === 'translated') return hasTranslatedExplanations(question);
    return true;
}

export function matchesHintsFilter(question, value) {
    if (value === 'has') return hasHints(question);
    if (value === 'missing') return !hasHints(question);
    return true;
}
