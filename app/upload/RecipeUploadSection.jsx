'use client';

import React, { memo, useEffect, useState } from 'react';

import { Alert } from 'components/alert';
import { Button } from 'components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from 'components/ui/card';
import { Input } from 'components/ui/input';
import { Textarea } from 'components/ui/textarea';
import { createUploadPreviewUrl, shouldDisableUploadPreview } from 'lib/upload-preview.js';

import DetectedRecipeSettingsCard from './DetectedRecipeSettingsCard';
import {
    areSectionFormPropsEqual,
    areSectionPreviewPropsEqual
} from './render-boundaries.js';

function SectionPreview({
    recipeId,
    fileNames,
    previewUrls,
    disablePreview,
    isPreparingPreview
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
                            <div className="flex h-[124px] items-center justify-center overflow-hidden rounded-xl border border-border/60 bg-muted/20">
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

function SectionFormFields({
    author,
    name,
    notes,
    sourceUrl,
    submitState,
    onAuthorChange,
    onNameChange,
    onNotesChange,
    onSourceUrlChange
}) {
    const buttonLabel = submitState === 'idle'
        ? 'Section submission arrives in Task 4'
        : 'Preparing...';

    return (
        <form
            className="recipe-upload-form flex flex-col gap-4"
            onSubmit={(event) => {
                event.preventDefault();
            }}
        >
            <label className="flex w-full flex-col gap-2">
                <span className="text-sm font-medium text-foreground">Author Name</span>
                <Input
                    type="text"
                    value={author}
                    onChange={(event) => onAuthorChange(event.target.value)}
                    required
                    placeholder="Author Name"
                />
            </label>
            <label className="flex w-full flex-col gap-2">
                <span className="text-sm font-medium text-foreground">Recipe Name</span>
                <Input
                    type="text"
                    value={name}
                    onChange={(event) => onNameChange(event.target.value)}
                    required
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
                />
            </label>
            <label className="flex w-full flex-col gap-2">
                <span className="text-sm font-medium text-foreground">Source Link</span>
                <Input
                    type="url"
                    value={sourceUrl}
                    onChange={(event) => onSourceUrlChange(event.target.value)}
                    placeholder="https://example.com/original-recipe"
                />
            </label>
            <div className="flex flex-col gap-3">
                <p className="m-0 text-sm leading-6 text-muted-foreground">
                    Review and edit metadata per section now. Exact-match checks and section submission wiring land in Task 4.
                </p>
                <Button type="submit" disabled>
                    {buttonLabel}
                </Button>
            </div>
        </form>
    );
}

const MemoizedSectionFormFields = memo(SectionFormFields, areSectionFormPropsEqual);

export default function RecipeUploadSection({ section, files = [] }) {
    const [author, setAuthor] = useState(() => section?.form?.author || '');
    const [name, setName] = useState(() => section?.form?.name || '');
    const [notes, setNotes] = useState(() => section?.form?.notes || '');
    const [sourceUrl, setSourceUrl] = useState(() => section?.form?.sourceUrl || '');
    const [disablePreview, setDisablePreview] = useState(false);
    const [previewUrls, setPreviewUrls] = useState([]);
    const [hasResolvedPreviews, setHasResolvedPreviews] = useState(() => files.length === 0);
    const submitState = 'idle';

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

        if (!files.length || disablePreview) {
            return undefined;
        }

        Promise.all(
            files.map((file) => createUploadPreviewUrl(file).catch(() => null))
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
                setHasResolvedPreviews(true);
            });

        return () => {
            isActive = false;
            nextPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
        };
    }, [disablePreview, files]);

    const fileNames = files.map((file) => file?.name || '').filter(Boolean);
    const isPreparingPreview = !disablePreview && files.length > 0 && !hasResolvedPreviews;
    const sectionTitle = name.trim() || section?.form?.name || 'Detected recipe';
    const omWorkspaceWarning = section?.recipeSettings?.isOmWorkspace
        ? 'Warning: This JPG was produced by OM Workspace. JPGs produced by OM Workspace may not have accurate recipe data in EXIF. Carefully check the detected recipe settings before continuing.'
        : '';

    return (
        <Card className="w-full border-border/70 bg-card/80">
            <CardHeader className="pb-3">
                <CardTitle className="text-lg">{sectionTitle}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
                {!!omWorkspaceWarning && <Alert>{omWorkspaceWarning}</Alert>}
                <MemoizedSectionPreview
                    recipeId={section?.id || ''}
                    fileNames={fileNames}
                    previewUrls={previewUrls}
                    disablePreview={disablePreview}
                    isPreparingPreview={isPreparingPreview}
                />
                <DetectedRecipeSettingsCard recipe={section?.recipeSettings || null} />
                <MemoizedSectionFormFields
                    author={author}
                    name={name}
                    notes={notes}
                    sourceUrl={sourceUrl}
                    submitState={submitState}
                    onAuthorChange={setAuthor}
                    onNameChange={setName}
                    onNotesChange={setNotes}
                    onSourceUrlChange={setSourceUrl}
                />
            </CardContent>
        </Card>
    );
}
