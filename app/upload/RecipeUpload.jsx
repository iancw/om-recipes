'use client';

import React, { useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { dispose as disposeExifTool, parseMetadata } from '@uswriting/exiftool';

import { Alert } from 'components/alert';
import { Button } from 'components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from 'components/ui/card';
import { cn } from 'lib/cn';
import {
  parseRecipeSettingsFromExif,
  parseCameraMetadataFromExif,
  extractExifOrientation,
  extractThumbnailDataUrl,
  RECIPE_EXIFTOOL_ARGS,
  THUMBNAIL_EXIFTOOL_ARGS
} from 'lib/exifparse';
import { computeRecipeFingerprint } from 'lib/recipeFingerprint.js';

import { buildUploadSections } from './group-upload-candidates.js';
import InvalidUploadFilesCard from './InvalidUploadFilesCard.jsx';
import RecipeUploadSection from './RecipeUploadSection.jsx';
import { buildSectionRenderKey } from './render-boundaries.js';

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

// Build the review thumbnail from the JPEG's own embedded EXIF thumbnail
// rather than decoding the full-resolution original in the browser. Decoding a
// ~20MP straight-out-of-camera JPG with createImageBitmap/canvas is the single
// largest allocation in the upload flow and reliably reloads the tab on mobile
// Safari (which never reports navigator.deviceMemory, so the old low-memory
// guard never engaged there). The embedded thumbnail comes back as a few KB of
// base64 text through the same exiftool WASM pass, costing negligible memory.
// The thumbnail is a bare JPEG with no orientation of its own, so the parent
// file's EXIF Orientation is read in the same pass for the caller to apply.
// A failure here is non-fatal: the file still uploads, it just has no preview.
export async function readEmbeddedThumbnail(file) {
  try {
    const result = await parseMetadata(file, { args: THUMBNAIL_EXIFTOOL_ARGS });
    if (!result?.success) {
      return { dataUrl: null, orientation: 1 };
    }
    return {
      dataUrl: extractThumbnailDataUrl(result.data),
      orientation: extractExifOrientation(result.data)
    };
  } catch {
    return { dataUrl: null, orientation: 1 };
  }
}

let exifBatchQueue = Promise.resolve();

export function runExclusiveExifBatch(task) {
  const queuedTask = exifBatchQueue.then(task, task);
  exifBatchQueue = queuedTask.catch(() => {});
  return queuedTask;
}

export function shouldApplyUploadRequestResult(activeRequestId, requestId) {
  return activeRequestId === requestId;
}

export default function RecipeUpload({ initialAuthor = "" }) {
  const [candidates, setCandidates] = useState([]);
  const [sections, setSections] = useState([]);
  const [invalidFiles, setInvalidFiles] = useState([]);
  const [dropError, setDropError] = useState('');
  const [isParsingFiles, setIsParsingFiles] = useState(false);
  const [reviewBatchId, setReviewBatchId] = useState(0);
  const latestDropRequestRef = useRef(0);

  const hasReviewState = sections.length > 0 || invalidFiles.length > 0;
  const parsedImageCount = sections.reduce((count, section) => count + section.fileIds.length, 0);

  const parseExif = async (file) => {
    const result = await parseMetadata(file, {
      args: RECIPE_EXIFTOOL_ARGS
    });

    if (!result?.success) {
      throw new Error(result?.error || 'Unable to read EXIF metadata');
    }

    file.cameraMetadata = parseCameraMetadataFromExif(result.data);

    const thumbnail = await readEmbeddedThumbnail(file);
    file.previewDataUrl = thumbnail.dataUrl;
    file.previewOrientation = thumbnail.orientation;

    return parseRecipeSettingsFromExif(result.data);
  };

  const clearReview = () => {
    latestDropRequestRef.current += 1;
    setCandidates([]);
    setSections([]);
    setInvalidFiles([]);
    setDropError('');
    setIsParsingFiles(false);
  };

  const onDrop = async (acceptedFiles, fileRejections = []) => {
    const requestId = latestDropRequestRef.current + 1;
    latestDropRequestRef.current = requestId;
    setIsParsingFiles(true);
    setDropError('');

    try {
      const parsedCandidates = await runExclusiveExifBatch(async () => {
        try {
          const nextParsedCandidates = [];

          for (const [index, file] of acceptedFiles.entries()) {
            const id = buildCandidateId(file, index);

            try {
              const recipeSettings = await parseExif(file);

              if (!recipeSettings?.hasColorProfileSettings && !recipeSettings?.hasMonochromeProfileSettings) {
                nextParsedCandidates.push({
                  id,
                  file,
                  fileName: file.name,
                  status: 'invalid',
                  error: 'No recipe found. Upload straight out of camera JPGs with compatible color or monochrome profiles from OM-3, Pen-F, or E-P7 cameras.'
                });
                continue;
              }

              nextParsedCandidates.push({
                id,
                file,
                fileName: file.name,
                status: 'parsed',
                recipeSettings,
                exactFingerprint: computeRecipeFingerprint(recipeSettings)
              });
            } catch (error) {
              console.error(error);
              nextParsedCandidates.push({
                id,
                file,
                fileName: file.name,
                status: 'invalid',
                error: `EXIF read error: ${error?.message || String(error)}`
              });
            }
          }

          return nextParsedCandidates;
        } finally {
          // The EXIF parser is shared state. Dispose it once after each serialized
          // batch so one file does not tear it down under another.
          await disposeExifTool().catch(() => {});
        }
      });

      const rejectedCandidates = fileRejections.map(({ file, errors }, index) => ({
        id: buildCandidateId(file, acceptedFiles.length + index),
        file,
        fileName: file?.name || `rejected-file-${index + 1}`,
        status: 'invalid',
        error: buildRejectionError(errors)
      }));

      const nextCandidates = [...parsedCandidates, ...rejectedCandidates];
      const grouped = buildUploadSections(nextCandidates, { initialAuthor });
      if (!shouldApplyUploadRequestResult(latestDropRequestRef.current, requestId)) {
        return;
      }

      setCandidates(nextCandidates);
      setSections(grouped.sections);
      setInvalidFiles(grouped.invalidFiles);
      setReviewBatchId((currentBatchId) => currentBatchId + 1);
    } catch (error) {
      if (!shouldApplyUploadRequestResult(latestDropRequestRef.current, requestId)) {
        return;
      }

      console.error(error);
      clearReview();
      setDropError(error?.message || 'Failed to prepare upload review.');
    } finally {
      if (shouldApplyUploadRequestResult(latestDropRequestRef.current, requestId)) {
        setIsParsingFiles(false);
      }
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
                key={buildSectionRenderKey(reviewBatchId, section.id)}
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
