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

    return {
        slug,
        uuid,
        ...(recipe?.recipeName ? { recipeName: recipe.recipeName } : {}),
        ...(recipe?.authorName ? { authorName: recipe.authorName } : {})
    };
}

function recipeContextFromPrepare(prep) {
    const slug = String(prep?.slug ?? '').trim();
    const uuid = String(prep?.recipeUuid ?? '').trim();

    if (!slug || !uuid) return null;

    return {
        id: prep?.recipeId ?? null,
        slug,
        uuid,
        ...(prep?.recipeName ? { recipeName: prep.recipeName } : {}),
        ...(prep?.authorName ? { authorName: prep.authorName } : {})
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
        return {
            ok: false,
            stage: 'prepare',
            error: prep?.error || 'Prepare failed',
            ...(prep?.errorCode ? { errorCode: prep.errorCode } : {}),
            ...(prep?.status != null ? { status: prep.status } : {})
        };
    }

    try {
        const uploadResult = await directUpload({ file, parUrl: prep.parUrl });
        if (uploadResult?.ok === false) {
            return {
                ok: false,
                stage: 'direct-upload',
                error: uploadResult?.error || 'Direct upload failed',
                ...(uploadResult?.errorCode ? { errorCode: uploadResult.errorCode } : {}),
                ...(uploadResult?.status != null ? { status: uploadResult.status } : {}),
                prep
            };
        }
    } catch (error) {
        return {
            ok: false,
            stage: 'direct-upload',
            error: error?.message || String(error),
            ...(error?.errorCode ? { errorCode: error.errorCode } : {}),
            ...(error?.status != null ? { status: error.status } : {}),
            prep
        };
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
        return {
            ok: false,
            stage: 'finalize',
            error: fin?.error || 'Finalize failed',
            ...(fin?.errorCode ? { errorCode: fin.errorCode } : {}),
            ...(fin?.status != null ? { status: fin.status } : {}),
            prep
        };
    }

    return { ok: true, prep, fin };
}

export async function submitUploadSection({ section, prepare, directUpload, finalize, onProgress }) {
    const successes = [];
    let createdRecipe = null;
    let matchedRecipe = section.matchedRecipe ?? null;

    for (const [index, file] of section.files.entries()) {
        onProgress?.({
            currentFileIndex: index + 1,
            totalFiles: section.files.length,
            fileName: file.name
        });

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
            const failedMatchedRecipe = failedCreatedRecipe
                ?? normalizeRecipeIdentity(result.prep?.matchedRecipe)
                ?? normalizeRecipeIdentity(matchedRecipe);

            return {
                ok: false,
                uploadedCount: successes.length,
                failedFile: file.name,
                failedStage: result.stage,
                error: result.error,
                ...(result.errorCode ? { errorCode: result.errorCode } : {}),
                ...(result.status != null ? { status: result.status } : {}),
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
