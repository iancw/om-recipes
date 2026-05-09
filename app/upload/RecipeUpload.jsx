'use client';

import React, { useState } from "react";
import { useDropzone } from "react-dropzone";
import { dispose as disposeExifTool, parseMetadata } from '@uswriting/exiftool';

import { Alert } from 'components/alert';
import { Button } from 'components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from 'components/ui/card';
import { cn } from 'lib/cn';
import { parseRecipeSettingsFromExif, RECIPE_EXIFTOOL_ARGS } from 'lib/exifparse';
import { computeRecipeFingerprint } from 'lib/recipeFingerprint.js';

import { buildUploadSections } from './group-upload-candidates.js';
import InvalidUploadFilesCard from './InvalidUploadFilesCard.jsx';
import RecipeUploadSection from './RecipeUploadSection.jsx';

function buildCandidateId(file, index) {
  const safeName = String(file?.name || 'file').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return `${safeName || 'file'}-${file?.lastModified || 0}-${file?.size || 0}-${index}`;
}

function buildRejectionError(errors) {
  if (!Array.isArray(errors) || errors.length === 0) {
    return 'Unsupported file.';
  }

  return errors
    .map((error) => error?.message || 'Unsupported file.')
    .filter(Boolean)
    .join(' ');
}

export default function RecipeUpload({ initialAuthor = "" }) {
  const [candidates, setCandidates] = useState([]);
  const [sections, setSections] = useState([]);
  const [invalidFiles, setInvalidFiles] = useState([]);
  const [dropError, setDropError] = useState('');
  const [isParsingFiles, setIsParsingFiles] = useState(false);

  const hasReviewState = sections.length > 0 || invalidFiles.length > 0;
  const parsedImageCount = sections.reduce((count, section) => count + section.fileIds.length, 0);

  const parseExif = async (file) => {
    try {
      const result = await parseMetadata(file, {
        args: RECIPE_EXIFTOOL_ARGS
      });

      if (!result?.success) {
        throw new Error(result?.error || 'Unable to read EXIF metadata');
      }

      return parseRecipeSettingsFromExif(result.data);
    } finally {
      // Release the cached WASM/virtual filesystem once parsing completes to
      // keep mobile Safari from carrying that memory through the rest of review.
      await disposeExifTool().catch(() => {});
    }
  };

  const clearReview = () => {
    setCandidates([]);
    setSections([]);
    setInvalidFiles([]);
    setDropError('');
    setIsParsingFiles(false);
  };

  const onDrop = async (acceptedFiles, fileRejections = []) => {
    setIsParsingFiles(true);
    setDropError('');

    try {
      const parsedCandidates = await Promise.all(
        acceptedFiles.map(async (file, index) => {
          const id = buildCandidateId(file, index);

          try {
            const recipeSettings = await parseExif(file);

            if (!recipeSettings?.hasColorProfileSettings) {
              return {
                id,
                file,
                fileName: file.name,
                status: 'invalid',
                error: 'No recipe found. Upload straight out of camera JPGs from OM-3, Pen-F, or E-P7 cameras.'
              };
            }

            return {
              id,
              file,
              fileName: file.name,
              status: 'parsed',
              recipeSettings,
              exactFingerprint: computeRecipeFingerprint(recipeSettings)
            };
          } catch (error) {
            console.error(error);
            return {
              id,
              file,
              fileName: file.name,
              status: 'invalid',
              error: `EXIF read error: ${error?.message || String(error)}`
            };
          }
        })
      );

      const rejectedCandidates = fileRejections.map(({ file, errors }, index) => ({
        id: buildCandidateId(file, acceptedFiles.length + index),
        file,
        fileName: file?.name || `rejected-file-${index + 1}`,
        status: 'invalid',
        error: buildRejectionError(errors)
      }));

      const nextCandidates = [...parsedCandidates, ...rejectedCandidates];
      const grouped = buildUploadSections(nextCandidates, { initialAuthor });

      setCandidates(nextCandidates);
      setSections(grouped.sections);
      setInvalidFiles(grouped.invalidFiles);
    } catch (error) {
      console.error(error);
      clearReview();
      setDropError(error?.message || 'Failed to prepare upload review.');
    } finally {
      setIsParsingFiles(false);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      "image/jpeg": ['.jpg', '.jpeg']
    },
    multiple: true,
    onDrop
  });

  return (
    <div className="flex flex-col gap-6">
      {dropError && (
        <Alert type="error">Upload review error: {dropError}</Alert>
      )}

      <Card className="border-border/70 bg-card/75">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Recipe Image Review</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div
            {...getRootProps()}
            className={cn(
              "flex min-h-[260px] w-full cursor-pointer flex-col items-center justify-center rounded-[1.5rem] border-2 border-dashed px-5 py-8 text-center transition-colors",
              isDragActive
                ? "border-primary/50 bg-primary/8"
                : "border-border bg-card/75 hover:border-primary/35 hover:bg-muted/30"
            )}
            aria-label="Recipe image uploader"
          >
            <input {...getInputProps()} />
            {isDragActive ? (
              <p className="text-sm text-foreground">Drop the images here ...</p>
            ) : (
              <div className="flex max-w-[420px] flex-col gap-2">
                <p className="m-0 text-sm font-medium text-foreground">
                  Drag and drop one or more JPGs here, or click to select them.
                </p>
                <p className="m-0 text-sm leading-6 text-muted-foreground">
                  The page will group images with identical detected recipe settings into shared review sections.
                </p>
              </div>
            )}
          </div>

          {isParsingFiles && (
            <Alert>
              Reading EXIF metadata and grouping matching files for review...
            </Alert>
          )}

          {hasReviewState && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="m-0 text-sm leading-6 text-muted-foreground">
                {sections.length} review section{sections.length === 1 ? '' : 's'} from {parsedImageCount} valid image{parsedImageCount === 1 ? '' : 's'}.
                {invalidFiles.length > 0 ? ` ${invalidFiles.length} invalid file${invalidFiles.length === 1 ? '' : 's'} listed separately.` : ''}
              </p>
              <Button type="button" variant="outline" onClick={clearReview}>
                Choose different files
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <InvalidUploadFilesCard invalidFiles={invalidFiles} />

      {sections.length > 0 ? (
        <div className="grid gap-6">
          {sections.map((section) => {
            const sectionFiles = candidates
              .filter((candidate) => section.fileIds.includes(candidate.id))
              .map((candidate) => candidate.file)
              .filter(Boolean);

            return (
              <RecipeUploadSection
                key={section.id}
                section={section}
                files={sectionFiles}
              />
            );
          })}
        </div>
      ) : (
        hasReviewState && !isParsingFiles && (
          <Alert>
            No valid recipe sections were detected from this batch.
          </Alert>
        )
      )}
    </div>
  );
}
