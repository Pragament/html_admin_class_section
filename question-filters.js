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
