function defaultSectionName(fileName) {
    return String(fileName || '').replace(/\.[a-z0-9]+$/i, '').trim();
}

export function buildUploadSections(candidates, { initialAuthor = '' } = {}) {
    const sectionsByFingerprint = new Map();
    const invalidFiles = [];

    for (const candidate of candidates) {
        if (candidate?.status !== 'parsed' || !candidate?.exactFingerprint || !candidate?.recipeSettings) {
            if (candidate?.status === 'invalid') {
                invalidFiles.push(candidate);
            }
            continue;
        }

        if (!sectionsByFingerprint.has(candidate.exactFingerprint)) {
            sectionsByFingerprint.set(candidate.exactFingerprint, {
                id: `section-${candidate.exactFingerprint}`,
                exactFingerprint: candidate.exactFingerprint,
                recipeSettings: candidate.recipeSettings,
                fileIds: [],
                form: {
                    author: initialAuthor,
                    name: defaultSectionName(candidate.fileName),
                    notes: '',
                    sourceUrl: ''
                }
            });
        }

        sectionsByFingerprint.get(candidate.exactFingerprint).fileIds.push(candidate.id);
    }

    return {
        sections: Array.from(sectionsByFingerprint.values()),
        invalidFiles
    };
}
