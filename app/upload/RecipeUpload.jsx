'use client';
import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";
import {
  finalizeRecipeUploadAction,
  prepareRecipeUploadAction,
  findRecipeMatchAction,
  checkImageDuplicateAction
} from './actions';
import RecipeSettings from "components/RecipeSettings";
import { parseMetadata } from '@uswriting/exiftool';
import {parseRecipeSettingsFromExif} from 'lib/exifparse'
import { Alert } from 'components/alert';
import { Button, buttonVariants } from 'components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from 'components/ui/card';
import { Input } from 'components/ui/input';
import { Textarea } from 'components/ui/textarea';
import { cn } from 'lib/cn';
import { getRecipePath } from 'lib/recipe-url.js';

export default function RecipeUpload({ initialAuthor = "" }) {
  const FINALIZING_NOTICE_DELAY_MS = 5000;

  const router = useRouter();
  const [author, setAuthor] = useState(initialAuthor);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [imageFiles, setImageFiles] = useState([]);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [recipe, setRecipeDetails] = useState(null)
  const [exifError, setExifError] = useState("");
  const [isParsingExif, setIsParsingExif] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('idle'); // idle | uploading | ok | error
  const [uploadError, setUploadError] = useState('');
  const [uploadedSlug, setUploadedSlug] = useState('');
  const [uploadedRecipeUuid, setUploadedRecipeUuid] = useState('');
  const [uploadPhase, setUploadPhase] = useState(''); // preparing | direct-upload | finalizing
  const [matchingRecipe, setMatchingRecipe] = useState(null);
  const [matchType, setMatchType] = useState(null); // 'full' | 'no-wb' | null
  const [similarRecipes, setSimilarRecipes] = useState([]);
  const [matchError, setMatchError] = useState('');
  const [isCheckingMatch, setIsCheckingMatch] = useState(false);
  const [lastUploadMode, setLastUploadMode] = useState('create'); // create | attach
  const [imageHashHex, setImageHashHex] = useState('');
  const [hashError, setHashError] = useState('');
  const [duplicateMatch, setDuplicateMatch] = useState(null);
  const [isCheckingDuplicate, setIsCheckingDuplicate] = useState(false);
  const [duplicateError, setDuplicateError] = useState('');
  const [missingColorProfile, setMissingColorProfile] = useState(false);
  const [showFinalizingNotice, setShowFinalizingNotice] = useState(false);
  const omWorkspaceWarning = recipe?.isOmWorkspace
    ? 'Warning: This JPG was produced by OM Workspace. JPGs produced by OM Workspace may not have accurate recipe data in EXIF. CAREFULLY CHECK the recipe data shown before uploading.'
    : '';

  const hasDroppedImage = imageFiles?.length > 0;
  const hasRedirectedRef = useRef(false);

  useEffect(() => {
    if (!imageFiles?.length) {
      setPreviewUrl(null);
      return;
    }

    const url = URL.createObjectURL(imageFiles[0]);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFiles]);

  useEffect(() => {
    if (!hasDroppedImage || !recipe) {
      if (!hasDroppedImage) {
        setMatchingRecipe(null);
        setMatchType(null);
        setSimilarRecipes([]);
        setMatchError('');
      } else {
        setMatchingRecipe(null);
        setMatchType(null);
        setSimilarRecipes([]);
      }
      setIsCheckingMatch(false);
      return;
    }
    let cancelled = false;
    setIsCheckingMatch(true);
    setMatchError('');

    findRecipeMatchAction({
      parameters: {
        recipeSettings: recipe
      }
    })
      .then((res) => {
        if (cancelled) return;
        if (!res?.ok) {
          setMatchError(res?.error || 'Failed to check for existing recipes');
          setMatchingRecipe(null);
          setMatchType(null);
          setSimilarRecipes([]);
          return;
        }

        // Full, no-wb, and color-tone matches all block the upload form.
        const blockingMatch = res.full ?? res.noWb ?? res.colorTone ?? null;
        setMatchingRecipe(blockingMatch);
        setMatchType(blockingMatch ? (res.full ? 'full' : (res.noWb ? 'no-wb' : 'color-tone')) : null);

        // Build deduplicated list of informational partial matches.
        // no-wb and color-tone are excluded here since they're treated as blocking matches above.
        const seenIds = new Set(blockingMatch ? [blockingMatch.id] : []);
        const partials = [];
        const addIfNew = (type, recipe, label) => {
          if (!recipe || seenIds.has(recipe.id)) return;
          seenIds.add(recipe.id);
          partials.push({ type, recipe, label });
        };
        addIfNew('color', res.color, 'Same color wheel');
        setSimilarRecipes(partials);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error(err);
        setMatchError(err?.message || 'Failed to check for existing recipes');
        setMatchingRecipe(null);
        setSimilarRecipes([]);
      })
      .finally(() => {
        if (cancelled) return;
        setIsCheckingMatch(false);
      });

    return () => {
      cancelled = true;
    };
  }, [hasDroppedImage, recipe]);

  useEffect(() => {
    if (!imageHashHex) return;

    let cancelled = false;
    setIsCheckingDuplicate(true);
    setDuplicateError('');

    checkImageDuplicateAction({
      parameters: {
        sha256: imageHashHex
      }
    })
      .then((res) => {
        if (cancelled) return;
        if (!res?.ok) {
          setDuplicateMatch(null);
          setDuplicateError(res?.error || 'Failed to check for duplicate images.');
          return;
        }
        if (res.duplicate) {
          setDuplicateMatch(res.duplicate);
          const recipeLabel =
            res.duplicate.recipeName ||
            res.duplicate.recipeSlug ||
            res.duplicate.recipeUuid ||
            res.duplicate.recipeId ||
            '';
          const message = recipeLabel
            ? `This image already exists on the site for "${recipeLabel}". Please select another image.`
            : 'This image already exists on the site. Please select another image.';
          setDuplicateError(message);
        } else {
          setDuplicateMatch(null);
          setDuplicateError('');
        }
      })
      .catch((err) => {
        if (cancelled) return;
        console.error(err);
        setDuplicateMatch(null);
        setDuplicateError(err?.message || 'Failed to check for duplicate images.');
      })
      .finally(() => {
        if (cancelled) return;
        setIsCheckingDuplicate(false);
      });

    return () => {
      cancelled = true;
    };
  }, [imageHashHex]);

  useEffect(() => {
    if (uploadStatus !== 'uploading' || uploadPhase !== 'finalizing') {
      setShowFinalizingNotice(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setShowFinalizingNotice(true);
    }, FINALIZING_NOTICE_DELAY_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [uploadPhase, uploadStatus]);

  const parseExif = async (file) => {
    const result = await parseMetadata(file)
    return parseRecipeSettingsFromExif(result.data)
  };

  const ensureImageHash = async (file) => {
    if (!file) {
      throw new Error('Missing image file');
    }
    if (imageHashHex) return imageHashHex;
    if (typeof window === 'undefined' || !window.crypto?.subtle) {
      throw new Error('Secure hashing is not supported in this browser');
    }
    try {
      const buffer = await file.arrayBuffer();
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', buffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
      setImageHashHex(hex);
      setHashError('');
      return hex;
    } catch (err) {
      const message = err?.message || 'Unable to fingerprint image';
      setImageHashHex('');
      setHashError(message);
      throw new Error(message);
    }
  };

  const onDrop = async (acceptedFiles) => {
    const file = acceptedFiles?.[0];
    setImageFiles(acceptedFiles);
    setExifError("");
    setIsParsingExif(true);
    setImageHashHex('');
    setHashError('');
    setDuplicateMatch(null);
    setDuplicateError('');
    setIsCheckingDuplicate(false);
    setMissingColorProfile(false);
    try {
      // Best-effort prefill of recipe name from filename.
      if (file && !name?.trim()) {
        const base = String(file.name || '').replace(/\.[a-z0-9]+$/i, '').trim();
        if (base) setName(base);
      }

      if (file) {
        await ensureImageHash(file);
      }

      const recipe = await parseExif(file);
      if (!recipe?.hasColorProfileSettings) {
        setRecipeDetails(null);
        setExifError('No recipe found. Upload straight out of camera JPGs from OM-3, Pen-F, or E-P7 cameras.');
        setMissingColorProfile(true);
        return;
      }
      setRecipeDetails(recipe);
      setExifError('');
      setMissingColorProfile(false);
    } catch (e) {
      console.error(e);
      setRecipeDetails(null);
      const message = e?.message || String(e);
      setExifError(`EXIF read error: ${message}`);
      setMissingColorProfile(false);
    } finally {
      setIsParsingExif(false);
    }
  };

  const handleRemoveImage = () => {
    setImageFiles([]);
    setRecipeDetails(null);
    setExifError("");
    setIsParsingExif(false);
    setImageHashHex('');
    setHashError('');
    setDuplicateMatch(null);
    setDuplicateError('');
    setIsCheckingDuplicate(false);
    setMatchingRecipe(null);
    setMatchType(null);
    setSimilarRecipes([]);
    setMatchError('');
    setIsCheckingMatch(false);
    setUploadStatus('idle');
    setUploadError('');
    setUploadedSlug('');
    setUploadedRecipeUuid('');
    setUploadPhase('');
    setLastUploadMode('create');
    setMissingColorProfile(false);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      "image/jpeg": ['.jpg', '.jpeg']
    },
    multiple: false,
    onDrop
  });

  const handleSubmit = async (event, options = {}) => {
    if (event?.preventDefault) event.preventDefault();
    const { attachToCommunity = false } = options;

    setUploadStatus('uploading');
    setUploadPhase('hashing');
    setUploadError('');
    setUploadedSlug('');
    setUploadedRecipeUuid('');
    setMatchError('');
    setMatchType(null);
    setSimilarRecipes([]);

    try {
      const file = imageFiles[0] || null;
      if (!file) throw new Error('Missing image file');
      if (duplicateMatch) {
        setUploadStatus('error');
        setUploadError('This image already exists on the site. Please select another image.');
        setUploadPhase('');
        return;
      }
      if (isCheckingDuplicate) {
        setUploadStatus('error');
        setUploadError('Still checking for duplicate images. Please wait a moment and try again.');
        setUploadPhase('');
        return;
      }

      const digest = await ensureImageHash(file);

      setUploadPhase('preparing');
      const prep = await prepareRecipeUploadAction({
        parameters: {
          author,
          name,
          notes,
          sourceUrl,
          imageMeta: { name: file.name, type: file.type, size: file.size, sha256: digest },
          recipeSettings: recipe
        }
      });

      if (!prep?.ok) {
        setUploadStatus('error');
        setUploadError(prep?.error || 'Upload failed');
        setUploadPhase('');
        return;
      }

      if (!attachToCommunity && !prep.shouldCreateRecipe) {
        setUploadStatus('idle');
        setUploadPhase('');
        setMatchingRecipe((prev) => prev ?? prep.matchedRecipe ?? null);
        return;
      }

      // Direct-to-OCI upload via PAR
      setUploadPhase('direct-upload');
      const putRes = await fetch(prep.parUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': file.type || 'application/octet-stream'
        },
        body: file
      });
      if (!putRes.ok) {
        throw new Error(`Direct upload failed: ${putRes.status}`);
      }

      // Finalize (server verifies object exists + updates DB)
      setUploadPhase('finalizing');
      const fin = await finalizeRecipeUploadAction({
        parameters: {
          imageId: prep.imageId,
          originalFileSize: file.size
        }
      });

      if (!fin?.ok) {
        setUploadStatus('error');
        setUploadError(fin?.error || 'Finalize failed');
        return;
      }

      if (prep.shouldCreateRecipe) {
        setMatchingRecipe(null);
      } else {
        setMatchingRecipe(prep.matchedRecipe ?? matchingRecipe);
      }
      setLastUploadMode(prep.shouldCreateRecipe ? 'create' : 'attach');
      setUploadStatus('ok');
      setUploadedSlug(prep.slug);
      setUploadedRecipeUuid(prep.recipeUuid || '');
      setUploadPhase('');
    } catch (err) {
      console.error(err);
      setUploadStatus('error');
      setUploadError(err?.message || String(err));
      setUploadPhase('');
    }
  };

  useEffect(() => {
    if (uploadStatus !== 'ok') {
      hasRedirectedRef.current = false;
      return;
    }

    if (hasRedirectedRef.current) return;

    const recipeHref = getRecipePath({
      slug: matchingRecipe?.slug || uploadedSlug,
      uuid: matchingRecipe?.uuid || uploadedRecipeUuid
    });

    if (recipeHref === '/recipes') return;

    hasRedirectedRef.current = true;
    router.push(recipeHref);
  }, [uploadStatus, uploadedSlug, uploadedRecipeUuid, matchingRecipe, lastUploadMode, router]);

  return (
    <div>
      <form className="recipe-upload-form">
        {hasDroppedImage && uploadStatus === 'ok' && (
          <div className="mb-3">
            <Alert type="success">
              {lastUploadMode === 'attach' ? (() => {
                const linkHref = getRecipePath({
                  slug: matchingRecipe?.slug || uploadedSlug,
                  uuid: matchingRecipe?.uuid || uploadedRecipeUuid
                });
                const linkLabel = matchingRecipe?.recipeName || matchingRecipe?.slug || uploadedSlug || 'View recipe';
                return (
                  <>
                    Image attached as a community sample for&nbsp;
                    <Link href={linkHref}>{linkLabel}</Link>.
                  </>
                );
              })() : (
                <>
                  Recipe uploaded!{' '}
                  {getRecipePath({ slug: uploadedSlug, uuid: uploadedRecipeUuid }) !== '/recipes' ? (
                    <Link href={getRecipePath({ slug: uploadedSlug, uuid: uploadedRecipeUuid })}>
                      View recipe
                    </Link>
                  ) : null}
                  {uploadedSlug ? (
                    <>
                      {' '}
                      (slug: <code>{uploadedSlug}</code>)
                    </>
                  ) : null}
                </>
              )}
            </Alert>
          </div>
        )}
        {hasDroppedImage && uploadStatus === 'error' && (
          <div className="mb-3">
            <Alert type="error">Upload error: {uploadError}</Alert>
          </div>
        )}
        {hasDroppedImage && showFinalizingNotice && (
          <div className="mb-3">
            <Alert>
              Processing the image is taking a bit longer than usual. Hang tight for a bit. It usually finishes within a minute.
            </Alert>
          </div>
        )}
        <div className="flex flex-wrap items-start gap-6">
          <div className="flex min-w-[280px] flex-[1_1_360px] flex-col gap-3">
            <div className="flex w-full flex-col gap-2">
              <span className="text-sm font-medium text-foreground">Recipe Image</span>
              <div
                {...getRootProps()}
                className={cn(
                  "flex h-[300px] w-full max-w-[400px] cursor-pointer flex-col items-center justify-center rounded-[1.5rem] border-2 border-dashed px-5 text-center transition-colors",
                  isDragActive
                    ? "border-primary/50 bg-primary/8"
                    : "border-border bg-card/75 hover:border-primary/35 hover:bg-muted/30"
                )}
                aria-label="Recipe image uploader"
              >
                <input {...getInputProps()} />
                {isDragActive ? (
                  <p className="text-sm text-foreground">Drop the image here …</p>
                ) : (
                  <p className="text-sm leading-6 text-muted-foreground">
                    {hasDroppedImage
                      ? `Selected: ${imageFiles[0].name}`
                      : "Drag 'n' drop an image here, or click to select one"}
                  </p>
                )}
                {hasDroppedImage && (
                  <div className="relative mt-2 inline-block">
                    {!!previewUrl && (
                      <img
                        src={previewUrl}
                        alt="Preview"
                        className="block max-h-[120px] max-w-[120px] rounded-xl border border-border/60 object-cover"
                      />
                    )}
                    <button
                      type="button"
                      aria-label="Remove photo"
                      title="Remove photo"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleRemoveImage();
                      }}
                      className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card/95 text-sm leading-none shadow-sm"
                    >
                      ×
                    </button>
                  </div>
                )}
                {isParsingExif && <p className="mt-3 text-sm text-muted-foreground">Reading EXIF…</p>}
                {uploadStatus === 'uploading' && uploadPhase === 'hashing' && (
                  <p className="mt-3 text-sm text-muted-foreground">Computing image fingerprint…</p>
                )}
                {isCheckingDuplicate && (
                  <p className="mt-3 text-sm text-muted-foreground">Checking for existing uploads…</p>
                )}
                {!!exifError && (
                  <p className="mt-2 text-sm text-destructive">
                    {exifError}
                  </p>
                )}
                {!!hashError && (
                  <p className="mt-2 text-sm text-destructive">
                    Fingerprint error: {hashError}
                  </p>
                )}
              </div>
            </div>
            {hasDroppedImage && isCheckingMatch && (
              <p className="text-sm text-muted-foreground">Checking for existing recipes…</p>
            )}
            {hasDroppedImage && matchError && (
              <Alert type="error">{matchError}</Alert>
            )}
            {hasDroppedImage && !duplicateMatch && !!duplicateError && (
              <Alert type="error">{duplicateError}</Alert>
            )}
            {hasDroppedImage && !!omWorkspaceWarning && (
              <Alert>{omWorkspaceWarning}</Alert>
            )}
          </div>
          {hasDroppedImage && !missingColorProfile && (
            <Card className="w-full max-w-[420px] border-border/70 bg-card/80">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Upload Details</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
              {matchingRecipe && (
                <>
                  <Alert>
                    {(() => {
                      const linkHref = getRecipePath(matchingRecipe);
                      const linkLabel = matchingRecipe.recipeName || matchingRecipe.slug || 'View recipe';
                      const intro = matchType === 'no-wb'
                        ? 'A recipe with these settings already exists (white balance differs):'
                        : matchType === 'color-tone'
                          ? 'A recipe with the same color wheel and tone adjustments already exists (sliders or white balance differ):'
                          : 'Exact match — this recipe already exists:';
                      return (
                        <>
                          {intro}&nbsp;
                          <Link href={linkHref}>
                            {linkLabel}
                          </Link>
                          {matchingRecipe.authorName ? ` by ${matchingRecipe.authorName}` : ''}.
                        </>
                      );
                    })()}
                  </Alert>
                  {!duplicateMatch && matchType === 'full' && (
                    <>
                      <p className="m-0 text-sm leading-6 text-muted-foreground">
                        Continue below to attach your image as a community sample or choose a different photo.
                      </p>
                      <div className="flex flex-wrap gap-3">
                        <Button
                          onClick={(event) => handleSubmit(event, { attachToCommunity: true })}
                          disabled={
                            uploadStatus === 'uploading' ||
                            isParsingExif ||
                            !recipe ||
                            !imageFiles?.length ||
                            isCheckingDuplicate
                          }
                        >
                          {uploadStatus === 'uploading'
                            ? (uploadPhase === 'hashing'
                              ? 'Computing fingerprint…'
                              : uploadPhase === 'preparing'
                                ? 'Preparing…'
                                : uploadPhase === 'direct-upload'
                                  ? 'Uploading to storage…'
                                : uploadPhase === 'finalizing'
                                    ? 'Finalizing…'
                                    : 'Uploading…')
                            : 'Attach as community sample'}
                        </Button>
                        <button
                          type="button"
                          className={buttonVariants({ variant: 'outline' })}
                          onClick={handleRemoveImage}
                          disabled={uploadStatus === 'uploading'}
                        >
                          Choose different image
                        </button>
                      </div>
                    </>
                  )}
                  {(matchType === 'no-wb' || matchType === 'color-tone') && (
                    <button
                      type="button"
                      className={buttonVariants({ variant: 'outline', className: 'self-start' })}
                      onClick={handleRemoveImage}
                    >
                      Choose different image
                    </button>
                  )}
                </>
              )}
              {duplicateMatch && (
                <>
                  <Alert type="error">
                    {(() => {
                      const recipeId =
                        duplicateMatch.recipeSlug ||
                        duplicateMatch.recipeUuid ||
                        duplicateMatch.recipeId ||
                        '';
                      const recipeHref = getRecipePath({
                        slug: duplicateMatch.recipeSlug,
                        uuid: duplicateMatch.recipeUuid
                      });
                      const recipeLabel =
                        duplicateMatch.recipeName ||
                        recipeId ||
                        'the existing recipe';
                      return (
                        <>
                          This image already exists on the site for{' '}
                          {recipeHref !== '/recipes' ? (
                            <Link href={recipeHref}>
                              {recipeLabel}
                            </Link>
                          ) : (
                            recipeLabel
                          )}
                          . Please select another image.
                        </>
                      );
                    })()}
                  </Alert>
                  <button
                    type="button"
                    className={buttonVariants({ variant: 'outline', className: 'self-start' })}
                    onClick={handleRemoveImage}
                  >
                    Choose different image
                  </button>
                </>
              )}
              {!matchingRecipe && !duplicateMatch && similarRecipes.length > 0 && (
                <div className="flex flex-col gap-2">
                  {similarRecipes.map(({ type, recipe, label }) => {
                    const linkHref = getRecipePath(recipe);
                    const linkLabel = recipe.recipeName || recipe.slug || 'View recipe';
                    if (type === 'color') {
                      return (
                        <Alert key={type}>
                          Another recipe has exactly the same color settings but different tone curve. Are you sure you want to create a new recipe?

                          <Link href={linkHref}>{linkLabel}</Link>
                          {recipe.authorName ? ` by ${recipe.authorName}` : ''}
                        </Alert>
                      );
                    }
                    return (
                      <Alert key={type}>
                        {label}:{' '}
                        <Link href={linkHref}>{linkLabel}</Link>
                        {recipe.authorName ? ` by ${recipe.authorName}` : ''}.
                      </Alert>
                    );
                  })}
                </div>
              )}
              {!matchingRecipe && !duplicateMatch && (
                <>
                  <label className="flex w-full flex-col gap-2">
                    <span className="text-sm font-medium text-foreground">Author Name</span>
                    <Input
                      type="text"
                      value={author}
                      onChange={(e) => setAuthor(e.target.value)}
                      required
                      placeholder="Author Name"
                    />
                  </label>
                  <label className="flex w-full flex-col gap-2">
                    <span className="text-sm font-medium text-foreground">Recipe Name</span>
                    <Input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      placeholder="Recipe Name"
                    />
                  </label>
                  <label className="flex w-full flex-col gap-2">
                    <span className="text-sm font-medium text-foreground">Notes</span>
                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Enter any notes"
                      rows={3}
                    />
                  </label>
                  <label className="flex w-full flex-col gap-2">
                    <span className="text-sm font-medium text-foreground">Source Link</span>
                    <Input
                      type="url"
                      value={sourceUrl}
                      onChange={(e) => setSourceUrl(e.target.value)}
                      placeholder="https://example.com/original-recipe"
                    />
                  </label>
                  <Button
                    onClick={handleSubmit}
                    disabled={
                      uploadStatus === 'uploading' ||
                      isParsingExif ||
                      !recipe ||
                      !imageFiles?.length ||
                      isCheckingDuplicate
                    }
                  >
                    {uploadStatus === 'uploading'
                      ? (uploadPhase === 'hashing'
                        ? 'Computing fingerprint…'
                        : uploadPhase === 'preparing'
                          ? 'Preparing…'
                          : uploadPhase === 'direct-upload'
                            ? 'Uploading to storage…'
                            : uploadPhase === 'finalizing'
                              ? 'Finalizing…'
                              : 'Uploading…')
                      : 'Upload'}
                  </Button>
                </>
              )}
              </CardContent>
            </Card>
          )}
        </div>
        {hasDroppedImage && recipe && (
          <Card className="mt-6 overflow-hidden border-border/70 bg-card/75">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Detected Recipe Settings</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <RecipeSettings recipe={recipe} />
            </CardContent>
          </Card>
        )}
      </form>
    </div>
  );
}
