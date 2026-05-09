function buildPrepareParameters({ file, section, matchedRecipe }) {
    return {
        author: section.form.author,
        name: section.form.name,
        notes: section.form.notes,
        sourceUrl: section.form.sourceUrl,
        imageMeta: { name: file.name, type: file.type, size: file.size },
        recipeSettings: section.recipeSettings,
        mode: section.mode,
        matchedRecipe
    };
}

async function uploadOneFile({ file, section, prepare, directUpload, finalize, matchedRecipe }) {
    let prep;

    try {
        prep = await prepare(buildPrepareParameters({ file, section, matchedRecipe }));
    } catch (error) {
        return { ok: false, stage: 'prepare', error: error?.message || String(error) };
    }

    if (!prep?.ok) {
        return { ok: false, stage: 'prepare', error: prep?.error || 'Prepare failed' };
    }

    try {
        await directUpload({ file, parUrl: prep.parUrl });
    } catch (error) {
        return { ok: false, stage: 'direct-upload', error: error?.message || String(error), prep };
    }

    let fin;

    try {
        fin = await finalize({
            imageId: prep.imageId,
            originalFileSize: file.size
        });
    } catch (error) {
        return { ok: false, stage: 'finalize', error: error?.message || String(error), prep };
    }

    if (!fin?.ok) {
        return { ok: false, stage: 'finalize', error: fin?.error || 'Finalize failed', prep };
    }

    return { ok: true, prep, fin };
}

export async function submitUploadSection({ section, prepare, directUpload, finalize }) {
    const successes = [];
    let createdRecipe = null;
    let matchedRecipe = section.matchedRecipe ?? null;

    for (const file of section.files) {
        const result = await uploadOneFile({
            file,
            section,
            prepare,
            directUpload,
            finalize,
            matchedRecipe
        });

        if (!result.ok) {
            return {
                ok: false,
                uploadedCount: successes.length,
                failedFile: file.name,
                failedStage: result.stage,
                error: result.error,
                createdRecipe,
                matchedRecipe
            };
        }

        if (result.prep.shouldCreateRecipe) {
            createdRecipe = { slug: result.prep.slug, uuid: result.prep.recipeUuid };
        }

        matchedRecipe = result.prep.matchedRecipe ?? matchedRecipe;
        successes.push(file.name);
    }

    return {
        ok: true,
        uploadedCount: successes.length,
        failedFile: null,
        failedStage: null,
        createdRecipe,
        matchedRecipe
    };
}
