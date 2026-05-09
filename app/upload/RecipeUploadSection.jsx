'use client';

import React, { memo, useEffect, useState } from 'react';
import Link from 'next/link';

import { Alert } from 'components/alert';
import { Button } from 'components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from 'components/ui/card';
import { Input } from 'components/ui/input';
import { Textarea } from 'components/ui/textarea';
import { getRecipePath } from 'lib/recipe-url.js';
import { createUploadPreviewUrl, shouldDisableUploadPreview } from 'lib/upload-preview.js';

import DetectedRecipeSettingsCard from './DetectedRecipeSettingsCard';
import { areSectionPreviewPropsEqual } from './render-boundaries.js';
import { submitUploadSection } from './submit-upload-section.js';

export function SectionPreview({
    recipeId,
    fileNames,
    previewUrls,
    disablePreview,
    isPreparingPreview,
    removeDisabled,
    onRemoveImageAtIndex
}) {
    if (!fileNames.length) return null;

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
                <p className="m-0 text-sm font-medium text-foreground">Grouped images</p>
                <p className="m-0 text-sm leading-6 text-muted-foreground">
                    {fileNames.length} image{fileNames.length === 1 ? '' : 's'} share the same detected recipe settings.
                </p>
            </div>
            <div className="flex flex-wrap gap-3">
                {fileNames.map((fileName, index) => {
                    const previewUrl = previewUrls[index] || null;

                    return (
                        <div
                            key={`${recipeId}-${fileName}-${index}`}
                            className="flex w-[124px] flex-col gap-2"
                        >
                            <div className="relative flex h-[124px] items-center justify-center overflow-hidden rounded-xl border border-border/60 bg-muted/20">
                                {disablePreview ? (
                                    <p className="px-3 text-center text-xs leading-5 text-muted-foreground">
                                        Preview disabled on this device.
                                    </p>
                                ) : previewUrl ? (
                                    <img
                                        src={previewUrl}
                                        alt={fileName}
                                        className="h-full w-full object-cover"
                                    />
                                ) : isPreparingPreview ? (
                                    <p className="px-3 text-center text-xs leading-5 text-muted-foreground">
                                        Preparing preview...
                                    </p>
                                ) : (
                                    <p className="px-3 text-center text-xs leading-5 text-muted-foreground">
                                        Preview unavailable.
                                    </p>
                                )}
                                <button
                                    type="button"
                                    aria-label={`Remove image ${fileName}`}
                                    title={`Remove image ${fileName}`}
                                    onClick={() => onRemoveImageAtIndex(index)}
                                    disabled={removeDisabled}
                                    className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card/95 text-sm leading-none shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    ×
                                </button>
                            </div>
                            <p className="m-0 break-all text-xs leading-5 text-muted-foreground">
                                {fileName}
                            </p>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

const MemoizedSectionPreview = memo(SectionPreview, areSectionPreviewPropsEqual);

export function getSectionFieldValidation(mode) {
    return mode === 'attach'
        ? {
            nameRequired: false,
            sourceUrlInputType: 'text'
        }
        : {
            nameRequired: true,
            sourceUrlInputType: 'url'
        };
}

export function SectionFormFields({
    author,
    name,
    notes,
    sourceUrl,
    mode,
    disabled,
    buttonLabel,
    isSubmitDisabled,
    onAuthorChange,
    onNameChange,
    onNotesChange,
    onSourceUrlChange,
    onSubmit
}) {
    const fieldValidation = getSectionFieldValidation(mode);
    const showCreationFields = mode !== 'attach';

    return (
        <form
            className="recipe-upload-form flex flex-col gap-4"
            onSubmit={onSubmit}
        >
            {showCreationFields && (
                <>
                    <label className="flex w-full flex-col gap-2">
                        <span className="text-sm font-medium text-foreground">Author Name</span>
                        <Input
                            type="text"
                            value={author}
                            onChange={(event) => onAuthorChange(event.target.value)}
                            required
                            disabled={disabled}
                            placeholder="Author Name"
                        />
                    </label>
                    <label className="flex w-full flex-col gap-2">
                        <span className="text-sm font-medium text-foreground">Recipe Name</span>
                        <Input
                            type="text"
                            value={name}
                            onChange={(event) => onNameChange(event.target.value)}
                            required={fieldValidation.nameRequired}
                            disabled={disabled}
                            placeholder="Recipe Name"
                        />
                    </label>
                    <label className="flex w-full flex-col gap-2">
                        <span className="text-sm font-medium text-foreground">Notes</span>
                        <Textarea
                            value={notes}
                            onChange={(event) => onNotesChange(event.target.value)}
                            placeholder="Enter any notes"
                            rows={3}
                            disabled={disabled}
                        />
                    </label>
                    <label className="flex w-full flex-col gap-2">
                        <span className="text-sm font-medium text-foreground">Source Link</span>
                        <Input
                            type={fieldValidation.sourceUrlInputType}
                            value={sourceUrl}
                            onChange={(event) => onSourceUrlChange(event.target.value)}
                            disabled={disabled}
                            placeholder="https://example.com/original-recipe"
                        />
                    </label>
                </>
            )}
            <Button type="submit" disabled={isSubmitDisabled}>
                {buttonLabel}
            </Button>
        </form>
    );
}

function pluralizeImages(count) {
    return `${count} image${count === 1 ? '' : 's'}`;
}

function buildPreviewBatchKey(files) {
    if (!Array.isArray(files) || files.length === 0) {
        return 'empty';
    }

    return files
        .map((file) => `${file?.name || ''}:${file?.size || 0}:${file?.lastModified || 0}`)
        .join('|');
}

export function getVisiblePreviewUrls({ previewUrls, resolvedPreviewBatchKey, previewBatchKey }) {
    if (resolvedPreviewBatchKey !== previewBatchKey) {
        return [];
    }

    return Array.isArray(previewUrls) ? previewUrls : [];
}

export function shouldShowSectionForm(submitState, mode = 'create') {
    return submitState !== 'ok' && mode !== 'blocked';
}

export function removePendingFileAtIndex(files, indexToRemove) {
    if (!Array.isArray(files) || files.length === 0) {
        return [];
    }

    return files.filter((_, index) => index !== indexToRemove);
}

function getSubmitButtonLabel({ fileCount, matchState, mode, submitState }) {
    if (submitState === 'uploading') return 'Uploading section...';
    if (submitState === 'ok') return 'Section uploaded';
    if (matchState === 'loading') return 'Checking for exact match...';
    if (matchState === 'error') return 'Exact-match check failed';
    if (mode === 'attach') return `Attach ${pluralizeImages(fileCount)}`;
    return `Create recipe and upload ${pluralizeImages(fileCount)}`;
}

export function buildSuccessSummary({ result, matchedRecipe, recipeName }) {
    const uploadedLabel = pluralizeImages(result.uploadedCount);

    if (result.createdRecipe) {
        return `Created "${recipeName}" and uploaded ${uploadedLabel}.`;
    }

    const summaryRecipe = result?.matchedRecipe
        ? { ...(matchedRecipe || {}), ...result.matchedRecipe }
        : matchedRecipe;
    const matchedRecipeName = summaryRecipe?.recipeName ? `"${summaryRecipe.recipeName}"` : 'the existing recipe';
    return `Attached ${uploadedLabel} to ${matchedRecipeName}.`;
}

export function buildSuccessRecipeLink({ result, matchedRecipe }) {
    const recipe = result?.createdRecipe ?? result?.matchedRecipe ?? matchedRecipe;
    const href = getRecipePath(recipe);

    if (!recipe || href === '/recipes') {
        return null;
    }

    return {
        href,
        label: 'View recipe'
    };
}

export function buildUploadProgressSummary({ currentFileIndex, totalFiles, fileName }) {
    const safeFileName = String(fileName || '').trim();

    if ((Number(totalFiles) || 0) <= 1) {
        return safeFileName ? `Uploading image: ${safeFileName}` : 'Uploading image...';
    }

    const current = Math.max(1, Number(currentFileIndex) || 1);
    const total = Math.max(current, Number(totalFiles) || current);
    return safeFileName
        ? `Uploading image ${current} of ${total}: ${safeFileName}`
        : `Uploading image ${current} of ${total}...`;
}

function buildErrorSummary(result) {
    const stageLabel = result?.failedStage === 'direct-upload'
        ? 'direct upload'
        : result?.failedStage || 'upload';
    const failedFile = result?.failedFile ? `"${result.failedFile}"` : 'This section';
    const uploadedPrefix = result?.uploadedCount
        ? `Uploaded ${pluralizeImages(result.uploadedCount)} before `
        : '';

    return `${uploadedPrefix}${failedFile} failed during ${stageLabel}: ${result?.error || 'Unknown upload error.'}`;
}

export function buildMatchCheckFailureState(error) {
    return {
        matchedRecipe: null,
        blockingRecipe: null,
        blockingMatchLevel: null,
        mode: null,
        matchState: 'error',
        matchError: error?.message || String(error) || 'Failed to check for existing recipes.'
    };
}

function findBlockingMatch(result) {
    if (result?.noWb) {
        return {
            blockingRecipe: result.noWb,
            blockingMatchLevel: 'noWb'
        };
    }

    if (result?.colorTone) {
        return {
            blockingRecipe: result.colorTone,
            blockingMatchLevel: 'colorTone'
        };
    }

    if (result?.color) {
        return {
            blockingRecipe: result.color,
            blockingMatchLevel: 'color'
        };
    }

    return {
        blockingRecipe: null,
        blockingMatchLevel: null
    };
}

export function resolveSectionMatchState(result) {
    if (result?.full) {
        return {
            matchedRecipe: result.full,
            blockingRecipe: null,
            blockingMatchLevel: null,
            mode: 'attach'
        };
    }

    const partialMatch = findBlockingMatch(result);
    if (partialMatch.blockingRecipe) {
        return {
            matchedRecipe: null,
            blockingRecipe: partialMatch.blockingRecipe,
            blockingMatchLevel: partialMatch.blockingMatchLevel,
            mode: 'blocked'
        };
    }

    return {
        matchedRecipe: null,
        blockingRecipe: null,
        blockingMatchLevel: null,
        mode: 'create'
    };
}

export function buildBlockingMatchMessage({ blockingRecipe, blockingMatchLevel }) {
    const recipeName = blockingRecipe?.recipeName ? `"${blockingRecipe.recipeName}"` : 'An existing recipe';
    const authorName = blockingRecipe?.authorName ? ` by ${blockingRecipe.authorName}` : '';

    if (blockingMatchLevel === 'noWb') {
        return `Too close to an existing recipe. ${recipeName}${authorName} already matches these settings except for white balance. Uploading a new recipe is disabled for this section.`;
    }

    if (blockingMatchLevel === 'colorTone') {
        return `Too close to an existing recipe. ${recipeName}${authorName} already matches this recipe's color and tone settings. Uploading a new recipe is disabled for this section.`;
    }

    return `Too close to an existing recipe. ${recipeName}${authorName} already matches this recipe's core color settings. Uploading a new recipe is disabled for this section.`;
}

export function trimUploadedFilesAfterFailure(files, uploadedCount) {
    if (!Array.isArray(files) || files.length === 0) {
        return [];
    }

    const successfulUploads = Math.max(0, Number(uploadedCount) || 0);
    if (successfulUploads === 0) {
        return files;
    }

    return files.slice(Math.min(successfulUploads, files.length));
}

export function buildRetryAttachState({ result, matchedRecipe, mode }) {
    if (
        result?.errorCode === 'matched_recipe_not_found' ||
        result?.errorCode === 'matched_recipe_fingerprint_mismatch'
    ) {
        return {
            matchedRecipe: null,
            mode: 'create'
        };
    }

    const retryRecipe = result?.createdRecipe ?? result?.matchedRecipe ?? null;

    if (!retryRecipe) {
        return {
            matchedRecipe,
            mode
        };
    }

    return {
        matchedRecipe: matchedRecipe
            ? { ...matchedRecipe, ...retryRecipe }
            : retryRecipe,
        mode: 'attach'
    };
}

async function directUploadToPar({ file, parUrl }) {
    const response = await fetch(parUrl, {
        method: 'PUT',
        headers: {
            'Content-Type': file.type || 'application/octet-stream'
        },
        body: file
    });

    if (!response.ok) {
        throw new Error(`Direct upload failed: ${response.status}`);
    }

    return { ok: true };
}

async function findExactRecipeMatch(recipeSettings) {
    const { findRecipeMatchAction } = await import('./actions.js');
    return findRecipeMatchAction({
        parameters: { recipeSettings }
    });
}

async function prepareSectionUpload(parameters) {
    const { prepareRecipeUploadAction } = await import('./actions.js');
    return prepareRecipeUploadAction({ parameters });
}

async function finalizeSectionUpload(parameters) {
    const { finalizeRecipeUploadAction } = await import('./actions.js');
    return finalizeRecipeUploadAction({ parameters });
}

export default function RecipeUploadSection({ section, files = [] }) {
    const [author, setAuthor] = useState(() => section?.form?.author || '');
    const [name, setName] = useState(() => section?.form?.name || '');
    const [notes, setNotes] = useState(() => section?.form?.notes || '');
    const [sourceUrl, setSourceUrl] = useState(() => section?.form?.sourceUrl || '');
    const [mode, setMode] = useState(() => section?.mode || 'create');
    const [matchedRecipe, setMatchedRecipe] = useState(() => section?.matchedRecipe || null);
    const [blockingRecipe, setBlockingRecipe] = useState(() => section?.blockingRecipe || null);
    const [blockingMatchLevel, setBlockingMatchLevel] = useState(() => section?.blockingMatchLevel || null);
    const [matchState, setMatchState] = useState(() => (section?.recipeSettings ? 'loading' : 'error'));
    const [matchError, setMatchError] = useState(() => (
        section?.recipeSettings
            ? (section?.matchError || '')
            : 'Recipe settings are missing for this section.'
    ));
    const [disablePreview, setDisablePreview] = useState(false);
    const [pendingFiles, setPendingFiles] = useState(() => files);
    const [previewUrls, setPreviewUrls] = useState([]);
    const [resolvedPreviewBatchKey, setResolvedPreviewBatchKey] = useState(() => (files.length === 0 ? 'empty' : ''));
    const [submitState, setSubmitState] = useState('idle');
    const [submitSummary, setSubmitSummary] = useState('');
    const [submitError, setSubmitError] = useState('');
    const [successRecipe, setSuccessRecipe] = useState(null);
    const [uploadProgress, setUploadProgress] = useState(null);
    const [isDismissed, setIsDismissed] = useState(false);
    const previewBatchKey = buildPreviewBatchKey(pendingFiles);
    const visiblePreviewUrls = getVisiblePreviewUrls({
        previewUrls,
        resolvedPreviewBatchKey,
        previewBatchKey
    });

    useEffect(() => {
        const frameId = window.requestAnimationFrame(() => {
            setDisablePreview(shouldDisableUploadPreview(window.navigator?.deviceMemory));
        });

        return () => {
            window.cancelAnimationFrame(frameId);
        };
    }, []);

    useEffect(() => {
        let isActive = true;
        let nextPreviewUrls = [];

        if (!pendingFiles.length || disablePreview) {
            setPreviewUrls([]);
            setResolvedPreviewBatchKey(previewBatchKey);
            return undefined;
        }

        Promise.all(
            pendingFiles.map((file) => createUploadPreviewUrl(file).catch(() => null))
        )
            .then((urls) => {
                if (!isActive) {
                    urls.filter(Boolean).forEach((url) => URL.revokeObjectURL(url));
                    return;
                }

                nextPreviewUrls = urls.filter(Boolean);
                setPreviewUrls(urls);
            })
            .finally(() => {
                if (!isActive) return;
                setResolvedPreviewBatchKey(previewBatchKey);
            });

        return () => {
            isActive = false;
            nextPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
        };
    }, [disablePreview, pendingFiles, previewBatchKey]);

    useEffect(() => {
        let cancelled = false;

        async function loadExactMatch() {
            setMatchState('loading');
            setMatchError('');

            let result;
            try {
                result = await findExactRecipeMatch(section?.recipeSettings);
            } catch (error) {
                if (cancelled) {
                    return;
                }

                const failureState = buildMatchCheckFailureState(error);
                setMatchedRecipe(failureState.matchedRecipe);
                setBlockingRecipe(failureState.blockingRecipe);
                setBlockingMatchLevel(failureState.blockingMatchLevel);
                setMode(failureState.mode);
                setMatchState(failureState.matchState);
                setMatchError(failureState.matchError);
                return;
            }

            if (cancelled) {
                return;
            }

            if (!result?.ok) {
                const failureState = buildMatchCheckFailureState(result?.error);
                setMatchedRecipe(failureState.matchedRecipe);
                setBlockingRecipe(failureState.blockingRecipe);
                setBlockingMatchLevel(failureState.blockingMatchLevel);
                setMode(failureState.mode);
                setMatchState(failureState.matchState);
                setMatchError(failureState.matchError);
                return;
            }

            const nextMatchState = resolveSectionMatchState(result);
            setMatchedRecipe(nextMatchState.matchedRecipe);
            setBlockingRecipe(nextMatchState.blockingRecipe);
            setBlockingMatchLevel(nextMatchState.blockingMatchLevel);
            setMode(nextMatchState.mode);
            setMatchState('ready');
            setMatchError('');
        }

        if (!section?.recipeSettings) return undefined;

        void loadExactMatch();

        return () => {
            cancelled = true;
        };
    }, [section?.id, section?.recipeSettings]);

    const fileNames = pendingFiles.map((file) => file?.name || '').filter(Boolean);
    const fileCount = fileNames.length;
    const isPreparingPreview = !disablePreview && pendingFiles.length > 0 && resolvedPreviewBatchKey !== previewBatchKey;
    const sectionTitle = matchedRecipe?.recipeName || name.trim() || section?.form?.name || 'Detected recipe';
    const omWorkspaceWarning = section?.recipeSettings?.isOmWorkspace
        ? 'Warning: This JPG was produced by OM Workspace. JPGs produced by OM Workspace may not have accurate recipe data in EXIF. Carefully check the detected recipe settings before continuing.'
        : '';
    const isSubmitDisabled = submitState === 'uploading'
        || submitState === 'ok'
        || matchState !== 'ready'
        || fileCount === 0
        || mode === 'blocked';
    const isFormDisabled = submitState === 'uploading' || submitState === 'ok';
    const removeDisabled = submitState === 'uploading' || submitState === 'ok';
    const submitButtonLabel = getSubmitButtonLabel({
        fileCount,
        matchState,
        mode,
        submitState
    });

    const handleDismissSection = () => {
        if (removeDisabled) {
            return;
        }

        setPendingFiles([]);
        setPreviewUrls([]);
        setResolvedPreviewBatchKey('empty');
        setSubmitError('');
        setSubmitSummary('');
        setSuccessRecipe(null);
        setUploadProgress(null);
        setIsDismissed(true);
    };

    const handleRemoveImageAtIndex = (indexToRemove) => {
        if (removeDisabled) {
            return;
        }

        setPendingFiles((currentFiles) => {
            const nextFiles = removePendingFileAtIndex(currentFiles, indexToRemove);
            if (nextFiles.length === 0) {
                setPreviewUrls([]);
                setResolvedPreviewBatchKey('empty');
                setSubmitError('');
                setSubmitSummary('');
                setSuccessRecipe(null);
                setUploadProgress(null);
                setIsDismissed(true);
            }
            return nextFiles;
        });
    };

    const handleSubmit = async (event) => {
        event.preventDefault();

        if (!event.currentTarget.reportValidity() || isSubmitDisabled) {
            return;
        }

        setSubmitState('uploading');
        setSubmitSummary('');
        setSubmitError('');
        setSuccessRecipe(null);
        setUploadProgress(null);

        const result = await submitUploadSection({
            section: {
                ...section,
                mode,
                matchedRecipe,
                files: pendingFiles,
                form: {
                    author,
                    name,
                    notes,
                    sourceUrl
                }
            },
            prepare: prepareSectionUpload,
            directUpload: directUploadToPar,
            finalize: finalizeSectionUpload,
            onProgress: setUploadProgress
        });

        if (result.ok) {
            setSubmitState('ok');
            setSubmitSummary(
                buildSuccessSummary({
                    result,
                    matchedRecipe,
                    recipeName: name.trim() || section?.form?.name || 'New recipe'
                })
            );
            setSuccessRecipe(result.createdRecipe ?? result.matchedRecipe ?? matchedRecipe ?? null);
            setUploadProgress(null);
            return;
        }

        const retryAttachState = buildRetryAttachState({
            result,
            matchedRecipe,
            mode
        });

        setMatchedRecipe(retryAttachState.matchedRecipe);
        setMode(retryAttachState.mode);
        setMatchState('ready');
        setMatchError('');
        setPendingFiles((currentFiles) => trimUploadedFilesAfterFailure(currentFiles, result.uploadedCount));
        setSubmitState('error');
        setSubmitError(buildErrorSummary(result));
        setSuccessRecipe(null);
        setUploadProgress(null);
    };

    if (isDismissed) {
        return null;
    }

    return (
        <Card className="w-full border-border/70 bg-card/80">
            <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
                <CardTitle className="text-lg">{sectionTitle}</CardTitle>
                <Button
                    type="button"
                    variant="outline"
                    onClick={handleDismissSection}
                    disabled={removeDisabled}
                >
                    Dismiss section
                </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
                {!!omWorkspaceWarning && <Alert>{omWorkspaceWarning}</Alert>}
                <MemoizedSectionPreview
                    recipeId={section?.id || ''}
                    fileNames={fileNames}
                    previewUrls={visiblePreviewUrls}
                    disablePreview={disablePreview}
                    isPreparingPreview={isPreparingPreview}
                    removeDisabled={removeDisabled}
                    onRemoveImageAtIndex={handleRemoveImageAtIndex}
                />
                <DetectedRecipeSettingsCard recipe={section?.recipeSettings || null} />
                {matchState === 'loading' && (
                    <Alert>
                        Checking for an existing recipe with these settings before enabling this section.
                    </Alert>
                )}
                {matchState !== 'loading' && matchedRecipe && (
                    <Alert>
                        Exact match found. This section will attach {pluralizeImages(fileCount)} to &quot;{matchedRecipe.recipeName || 'Existing recipe'}&quot; by {matchedRecipe.authorName || 'the existing author'}.
                    </Alert>
                )}
                {matchState === 'ready' && !matchedRecipe && blockingRecipe && (
                    <Alert>
                        {buildBlockingMatchMessage({
                            blockingRecipe,
                            blockingMatchLevel
                        })}
                    </Alert>
                )}
                {matchState === 'ready' && !matchedRecipe && !blockingRecipe && (
                    <Alert>
                        No exact match found. Submitting this section will create a new recipe from the metadata below.
                    </Alert>
                )}
                {matchError && (
                    <Alert type="error">
                        Exact-match check failed: {matchError} Upload is disabled until this section can confirm whether an existing recipe already matches these settings.
                    </Alert>
                )}
                {submitSummary && (
                    <Alert type="success">
                        {submitSummary}
                    </Alert>
                )}
                {submitState === 'ok' && buildSuccessRecipeLink({ result: { createdRecipe: successRecipe }, matchedRecipe }) && (
                    <Button asChild>
                        <Link href={buildSuccessRecipeLink({ result: { createdRecipe: successRecipe }, matchedRecipe }).href}>
                            {buildSuccessRecipeLink({ result: { createdRecipe: successRecipe }, matchedRecipe }).label}
                        </Link>
                    </Button>
                )}
                {submitError && (
                    <Alert type="error">
                        {submitError}
                    </Alert>
                )}
                {submitState === 'uploading' && uploadProgress && (
                    <Alert>
                        {buildUploadProgressSummary(uploadProgress)}
                    </Alert>
                )}
                {shouldShowSectionForm(submitState, mode) && (
                    <SectionFormFields
                        author={author}
                        name={name}
                        notes={notes}
                        sourceUrl={sourceUrl}
                        mode={mode}
                        disabled={isFormDisabled}
                        buttonLabel={submitButtonLabel}
                        isSubmitDisabled={isSubmitDisabled}
                        onAuthorChange={setAuthor}
                        onNameChange={setName}
                        onNotesChange={setNotes}
                        onSourceUrlChange={setSourceUrl}
                        onSubmit={handleSubmit}
                    />
                )}
            </CardContent>
        </Card>
    );
}
