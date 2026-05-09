function buildPrepareParameters({ file, section, matchedRecipe, mode }) {
    return {
        author: section.form.author,
        name: section.form.name,
        notes: section.form.notes,
        sourceUrl: section.form.sourceUrl,
        imageMeta: { name: file.name, type: file.type, size: file.size },
        recipeSettings: section.recipeSettings,
        mode,
        matchedRecipe
    };
}

function normalizeRecipeIdentity(recipe) {
    const slug = String(recipe?.slug ?? '').trim();
    const uuid = String(recipe?.uuid ?? recipe?.recipeUuid ?? '').trim();

    if (!slug || !uuid) return null;

    return { slug, uuid };
}

function recipeContextFromPrepare(prep) {
    const slug = String(prep?.slug ?? '').trim();
    const uuid = String(prep?.recipeUuid ?? '').trim();

    if (!slug || !uuid) return null;

    return {
        id: prep?.recipeId ?? null,
        slug,
        uuid
    };
}

async function uploadOneFile({ file, section, prepare, directUpload, finalize, matchedRecipe }) {
    let prep;
    const mode = matchedRecipe ? 'attach' : section.mode;

    try {
        prep = await prepare(buildPrepareParameters({ file, section, matchedRecipe, mode }));
    } catch (error) {
        return { ok: false, stage: 'prepare', error: error?.message || String(error) };
    }

    if (!prep?.ok) {
        return { ok: false, stage: 'prepare', error: prep?.error || 'Prepare failed' };
    }

    try {
        const uploadResult = await directUpload({ file, parUrl: prep.parUrl });
        if (uploadResult?.ok === false) {
            return {
                ok: false,
                stage: 'direct-upload',
                error: uploadResult?.error || 'Direct upload failed',
                prep
            };
        }
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
            const failedCreatedRecipe = result.prep?.shouldCreateRecipe ? normalizeRecipeIdentity(result.prep) : null;
            const failedMatchedRecipe = failedCreatedRecipe ?? normalizeRecipeIdentity(matchedRecipe);

            return {
                ok: false,
                uploadedCount: successes.length,
                failedFile: file.name,
                failedStage: result.stage,
                error: result.error,
                createdRecipe: createdRecipe ?? failedCreatedRecipe,
                matchedRecipe: failedMatchedRecipe
            };
        }

        if (result.prep.shouldCreateRecipe) {
            createdRecipe = normalizeRecipeIdentity(result.prep);
            matchedRecipe = recipeContextFromPrepare(result.prep);
        } else {
            matchedRecipe = result.prep.matchedRecipe ?? matchedRecipe;
        }
        successes.push(file.name);
    }

    return {
        ok: true,
        uploadedCount: successes.length,
        failedFile: null,
        failedStage: null,
        createdRecipe,
        matchedRecipe: normalizeRecipeIdentity(matchedRecipe)
    };
}
