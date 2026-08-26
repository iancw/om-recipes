'use client';

import React, { useEffect, useMemo, useState } from "react";
import RecipeSettings from "./RecipeSettings";
import { useRouter } from 'next/navigation';
import AuthorSocialLinks from './AuthorSocialLinks';
import DeleteConfirmationModal from './DeleteConfirmationModal.jsx';
import RecipePreviewImage from './RecipePreviewImage.jsx';
import RecipeSampleStrip from './RecipeSampleStrip.jsx';
import {
  getRecipeCardPreviewUrl,
  getRecipeDownloadUrl,
  getVisibleComparisonImages,
  getVisibleSampleImages,
  SAMPLE_IMAGE_SELECTION
} from '../lib/recipe-image-selection.js';
import { getRecipePath } from '../lib/recipe-url.js';
import { Badge } from './ui/badge.jsx';
import { Button, buttonVariants } from './ui/button.jsx';
import { Card, CardContent } from './ui/card.jsx';
import { Input } from './ui/input.jsx';
import { Textarea } from './ui/textarea.jsx';
import { cn } from '../lib/cn.js';

function isRedirectError(error) {
  if (!error || typeof error !== 'object') return false;
  return 'digest' in error && typeof error.digest === 'string' && error.digest.startsWith('NEXT_REDIRECT');
}

export default function RecipeCard({
  recipe,
  isOwner = false,
  saveCount = null,
  updateRecipeAction,
  deleteRecipeAction,
  onSavedChange,
  selectedImageOption = SAMPLE_IMAGE_SELECTION,
  showSampleStrip = false
}) {
  const router = useRouter();

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(recipe?.recipeName ?? '');
  const [description, setDescription] = useState(recipe?.description ?? '');
  const [sourceUrl, setSourceUrl] = useState(recipe?.sourceUrl ?? '');
  const [updateError, setUpdateError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRecipeSaved, setIsRecipeSaved] = useState(Boolean(recipe?.isSaved));
  const [saveToggleError, setSaveToggleError] = useState('');
  const [isSaveTogglePending, setIsSaveTogglePending] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [isDownloadingImage, setIsDownloadingImage] = useState(false);

  const recipeName = recipe?.recipeName ?? '';
  const recipeDescription = recipe?.description ?? '';
  const recipeSourceUrl = recipe?.sourceUrl ?? '';
  const canSaveRecipe = Number.isFinite(Number(recipe?.id));
  const viewerIsLoggedIn = Boolean(recipe?.viewerIsLoggedIn);

  const canEdit = Boolean(isOwner && typeof updateRecipeAction === 'function');
  const canDelete = Boolean(isOwner && typeof deleteRecipeAction === 'function');

  useEffect(() => {
    if (!editing) {
      setName(recipeName);
      setDescription(recipeDescription);
      setSourceUrl(recipeSourceUrl);
    }
  }, [editing, recipeName, recipeDescription, recipeSourceUrl]);

  useEffect(() => {
    if (!canEdit && editing) {
      setEditing(false);
    }
  }, [canEdit, editing]);

  useEffect(() => {
    setIsRecipeSaved(Boolean(recipe?.isSaved));
  }, [recipe?.isSaved, recipe?.id]);

  const visibleSampleImages = useMemo(() => getVisibleSampleImages(recipe), [recipe]);
  const visibleComparisonImages = useMemo(() => getVisibleComparisonImages(recipe), [recipe]);
  const gallerySampleImages = useMemo(
    () => [...visibleSampleImages, ...visibleComparisonImages],
    [visibleSampleImages, visibleComparisonImages]
  );
  const showSamplesStrip = Boolean(showSampleStrip)
    && selectedImageOption === SAMPLE_IMAGE_SELECTION
    && gallerySampleImages.length > 1;
  const recipeHref = getRecipePath(recipe);

  const downloadImageHref = getRecipeDownloadUrl(recipe);
  const previewUrl = getRecipeCardPreviewUrl(recipe, selectedImageOption);

  const slug = recipe?.slug ?? '';
  const oesHref = slug ? `/oes/${slug}.oes` : '#';
  const recipeType = String(recipe?.type ?? 'COLOR').toUpperCase();
  const canDownloadOes = Boolean(slug);

  const authorLinks = useMemo(() => {
    const social = recipe?.authorSocial ?? {};
    const fallback = {
      instagram: recipe?.instagramLink,
      flickr: recipe?.flickrLink,
      website: recipe?.website,
      kofi: recipe?.kofiLink
    };

    const pick = (key) => {
      const primary = typeof social?.[key] === 'string' ? social[key].trim() : '';
      if (primary) return primary;
      const secondary = typeof fallback?.[key] === 'string' ? fallback[key].trim() : '';
      return secondary;
    };

    const entries = [
      { key: 'instagram', label: 'Instagram', url: pick('instagram') },
      { key: 'flickr', label: 'Flickr', url: pick('flickr') },
      { key: 'website', label: 'Website', url: pick('website') },
      { key: 'kofi', label: 'Ko-fi', url: pick('kofi') }
    ];

    return entries.filter((entry) => Boolean(entry.url));
  }, [recipe?.authorSocial, recipe?.instagramLink, recipe?.flickrLink, recipe?.website, recipe?.kofiLink]);

  const handleStartEdit = () => {
    if (!canEdit) return;
    setUpdateError('');
    setEditing(true);
  };

  const handleCancelEdit = () => {
    if (!canEdit) return;
    setEditing(false);
    setUpdateError('');
    setName(recipeName);
    setDescription(recipeDescription);
    setSourceUrl(recipeSourceUrl);
  };

  const handleSave = async () => {
    if (!canEdit || isSaving) return;

    if (!name.trim()) {
      setUpdateError('Recipe name is required');
      return;
    }

    setIsSaving(true);
    setUpdateError('');

    const formData = new FormData();
    formData.append('recipeId', String(recipe?.id));
    formData.append('recipeName', name);
    formData.append('description', description);
    formData.append('sourceUrl', sourceUrl);

    try {
      await updateRecipeAction(formData);
      setEditing(false);
      router.refresh();
    } catch (err) {
      if (isRedirectError(err)) throw err;
      setUpdateError(err?.message || 'Failed to update recipe');
    } finally {
      setIsSaving(false);
    }
  };

  const openDeleteModal = () => {
    if (!canDelete) return;
    setDeleteError('');
    setShowDeleteModal(true);
  };

  const closeDeleteModal = () => {
    if (isDeleting) return;
    setShowDeleteModal(false);
    setDeleteError('');
  };

  const handleDelete = async (typedValue) => {
    if (!canDelete || isDeleting) return;

    setIsDeleting(true);
    setDeleteError('');

    const formData = new FormData();
    formData.append('recipeId', String(recipe?.id));
    formData.append('confirmName', typedValue);

    try {
      await deleteRecipeAction(formData);
    } catch (err) {
      if (isRedirectError(err)) throw err;
      setDeleteError(err?.message || 'Failed to delete recipe');
      setIsDeleting(false);
    }
  };

  const handleToggleSavedRecipe = async () => {
    if (!canSaveRecipe || isSaveTogglePending) return;

    setSaveToggleError('');
    setIsSaveTogglePending(true);

    try {
      const redirectTo = `${window.location.pathname}${window.location.search}`;
      const response = await fetch('/recipes/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          recipeId: Number(recipe?.id),
          redirectTo
        })
      });

      const body = await response.json().catch(() => ({}));

      if (response.status === 401 && body?.loginUrl) {
        router.push(body.loginUrl);
        return;
      }

      if (!response.ok) {
        throw new Error(body?.error || 'Failed to update saved recipe');
      }

      const nextSaved = Boolean(body?.isSaved);
      setIsRecipeSaved(nextSaved);
      if (typeof onSavedChange === 'function') {
        onSavedChange(recipe?.id, nextSaved);
      }
    } catch (err) {
      setSaveToggleError(err?.message || 'Failed to update saved recipe');
    } finally {
      setIsSaveTogglePending(false);
    }
  };

  const handleDownloadRecipeImage = async () => {
    if (!downloadImageHref || isDownloadingImage) return;

    setDownloadError('');

    let resolvedUrl;
    try {
      resolvedUrl = new URL(downloadImageHref, window.location.href);
    } catch {
      window.open(downloadImageHref, '_blank', 'noopener,noreferrer');
      return;
    }

    const suggestedFilename = slug ? `${slug}.jpg` : 'recipe-image.jpg';

    const triggerDownload = (href) => {
      const link = document.createElement('a');
      link.href = href;
      link.download = suggestedFilename;
      document.body.appendChild(link);
      link.click();
      link.remove();
    };

    if (resolvedUrl.origin === window.location.origin) {
      triggerDownload(resolvedUrl.href);
      return;
    }

    setIsDownloadingImage(true);

    try {
      const response = await fetch(resolvedUrl.href, { mode: 'cors', credentials: 'omit' });
      if (!response.ok) {
        throw new Error(`Download failed with status ${response.status}`);
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      triggerDownload(objectUrl);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    } catch (error) {
      console.error('Failed to download recipe image directly', error);
      setDownloadError('Direct download was unavailable, so the image was opened in a new tab.');
      window.open(resolvedUrl.href, '_blank', 'noopener,noreferrer');
    } finally {
      setIsDownloadingImage(false);
    }
  };

  return (
    <div className="flex w-full flex-col gap-4 items-start">
      {(canEdit || canDelete) && (
        <div className="flex flex-wrap gap-2 self-start">
          {editing && canEdit ? (
            <>
              <Button type="button" onClick={handleSave} disabled={isSaving}>
                {isSaving ? 'Saving…' : 'Save changes'}
              </Button>
              <Button type="button" variant="outline" onClick={handleCancelEdit} disabled={isSaving}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              {canEdit && (
                <Button type="button" onClick={handleStartEdit}>
                  Edit recipe
                </Button>
              )}
              {canDelete && (
                <Button type="button" variant="destructive" onClick={openDeleteModal}>
                  Delete recipe
                </Button>
              )}
            </>
          )}
        </div>
      )}
      <Card className="w-full overflow-hidden">
        <CardContent className="space-y-8 p-5 sm:p-8">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex-1 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">Recipe</Badge>
                <Badge variant="outline">{recipeType === 'MONO' ? 'Monochrome' : 'Color'}</Badge>
                {recipe?.camera ? <Badge variant="outline">{recipe.camera}</Badge> : null}
                {recipe?.filmSimulation ? <Badge variant="outline">{recipe.filmSimulation}</Badge> : null}
                {isOwner && typeof saveCount === 'number' ? (
                  <Badge variant="outline">Saved {saveCount} {saveCount === 1 ? 'time' : 'times'}</Badge>
                ) : null}
              </div>
            {editing ? (
              <div className="flex items-start gap-3 flex-wrap rounded-2xl border border-border/70 bg-muted/35 p-4">
                <label className="flex min-w-[240px] flex-1 flex-col gap-2">
                  <span className="text-sm font-medium text-foreground">Recipe name</span>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Input
                      className="min-w-[240px] flex-1"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      disabled={isSaving}
                      required
                    />
                    <button
                      type="button"
                      aria-label={isRecipeSaved ? 'Unsave recipe' : 'Save recipe'}
                      aria-pressed={isRecipeSaved}
                      className={cn(
                        'inline-flex h-11 w-11 items-center justify-center rounded-full border text-2xl leading-none transition-colors',
                        isRecipeSaved
                          ? 'border-primary/30 bg-primary/10 text-primary'
                          : 'border-border bg-card text-muted-foreground hover:border-primary/25 hover:text-primary'
                      )}
                      onClick={handleToggleSavedRecipe}
                      disabled={!canSaveRecipe || isSaveTogglePending}
                      title={
                        viewerIsLoggedIn
                          ? isRecipeSaved
                            ? 'Remove from saved recipes'
                            : 'Save recipe'
                          : 'Log in to save recipes'
                      }
                    >
                      <span aria-hidden="true">{isRecipeSaved ? '★' : '☆'}</span>
                    </button>
                  </div>
                </label>
              </div>
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="m-0 text-3xl sm:text-4xl">
                  {recipeName}
                </h2>
                <button
                  type="button"
                  aria-label={isRecipeSaved ? 'Unsave recipe' : 'Save recipe'}
                  aria-pressed={isRecipeSaved}
                  className={cn(
                    'inline-flex h-11 w-11 items-center justify-center rounded-full border text-2xl leading-none transition-colors',
                    isRecipeSaved
                      ? 'border-primary/30 bg-primary/10 text-primary'
                      : 'border-border bg-card text-muted-foreground hover:border-primary/25 hover:text-primary'
                  )}
                  onClick={handleToggleSavedRecipe}
                  disabled={!canSaveRecipe || isSaveTogglePending}
                  title={
                    viewerIsLoggedIn
                      ? isRecipeSaved
                        ? 'Remove from saved recipes'
                        : 'Save recipe'
                      : 'Log in to save recipes'
                  }
                >
                  <span aria-hidden="true">{isRecipeSaved ? '★' : '☆'}</span>
                </button>
              </div>
            )}
            <div className="flex items-center gap-2 flex-wrap text-muted-foreground">
              <span>{recipe?.authorName}</span>
              <AuthorSocialLinks
                links={authorLinks}
                authorName={recipe?.authorName}
                iconClassName="text-muted-foreground transition-colors hover:text-foreground"
              />
            </div>
          </div>

            <div className="flex flex-col gap-3 xl:items-end">
              <div className="flex flex-col gap-3 xl:items-end xl:text-right">
              {canDownloadOes ? (
                <a
                  href={oesHref}
                  download
                  className={buttonVariants({ className: 'no-underline' })}
                >
                  OM Workspace Batch Processing File
                </a>
              ) : null}
              {downloadImageHref && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleDownloadRecipeImage}
                  disabled={isDownloadingImage}
                >
                  {isDownloadingImage ? 'Downloading…' : 'Download Recipe Image'}
                </Button>
              )}
            </div>
          </div>
        </div>

        {updateError ? (
          <p className="text-sm text-destructive">{updateError}</p>
        ) : null}
        {saveToggleError ? (
          <p className="text-sm text-destructive">{saveToggleError}</p>
        ) : null}
        {downloadError ? (
          <p className="text-sm text-destructive">{downloadError}</p>
        ) : null}

        {(editing || recipeDescription || recipeSourceUrl || previewUrl) && (
          <div className="recipe-notes-image-row rounded-[1.5rem] border border-border/70 bg-muted/25 p-4 sm:p-5">
            {showSamplesStrip ? (
              <RecipeSampleStrip
                key={recipe?.id ?? recipe?.uuid ?? recipe?.slug}
                images={gallerySampleImages}
                recipeHref={recipeHref}
              />
            ) : previewUrl && (
              <div className="flex flex-[0_0_auto] flex-col items-center">
                <RecipePreviewImage
                  src={previewUrl}
                  alt="Recipe Sample Image"
                  width={400}
                  height={300}
                  sizes="(min-width: 1280px) 400px, (min-width: 768px) 45vw, 100vw"
                  imageClassName="max-h-[300px] w-auto max-w-full rounded-xl border border-border/60 object-cover"
                  placeholderClassName="h-[300px] w-full max-w-[400px] rounded-xl border border-border/60 bg-background/70"
                />
              </div>
            )}
            {(editing || recipeDescription || recipeSourceUrl) && (
              <div className="mb-2 flex-1 px-0 py-2 sm:px-3">
                {editing ? (
                  <div className="flex flex-col gap-4">
                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-medium text-foreground">Notes / description</span>
                      <Textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={4}
                        placeholder="Optional notes..."
                        disabled={isSaving}
                      />
                    </label>
                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-medium text-foreground">Source link</span>
                      <Input
                        type="url"
                        value={sourceUrl}
                        onChange={(e) => setSourceUrl(e.target.value)}
                        placeholder="https://example.com/original-recipe"
                        disabled={isSaving}
                      />
                    </label>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {recipeDescription ? (
                      <div className="whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{recipeDescription}</div>
                    ) : null}
                    {recipeSourceUrl ? (
                      <div className="text-sm leading-7 text-muted-foreground">
                        <span>Source: </span>
                        <a
                          href={recipeSourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="break-all underline underline-offset-4 transition-colors hover:text-foreground"
                        >
                          {recipeSourceUrl}
                        </a>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <RecipeSettings recipe={recipe} />

        </CardContent>
      </Card>

      {showDeleteModal && (
        <DeleteConfirmationModal
          key={showDeleteModal ? `recipe-delete-${recipe?.id ?? 'open'}` : 'recipe-delete-closed'}
          open={showDeleteModal}
          title="Delete recipe"
          description={<>This will permanently delete <strong>{recipeName}</strong> and its associated samples. Type the recipe name to confirm.</>}
          confirmValue={recipeName}
          error={deleteError}
          isDeleting={isDeleting}
          onClose={closeDeleteModal}
          onConfirm={handleDelete}
        />
    )}
  </div>
  );
}
