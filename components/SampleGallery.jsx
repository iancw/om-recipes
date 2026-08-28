'use client';
import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import AuthorSocialLinks from './AuthorSocialLinks';
import DeleteConfirmationModal from './DeleteConfirmationModal.jsx';
import RecipePreviewImage from './RecipePreviewImage.jsx';
import {
  formatComparisonImageLabelForDisplay,
  formatImageMetadataLine,
  getImagePreviewUrl,
  getRecipeModalImageUrl
} from '../lib/recipe-image-selection';

const IMAGE_QUERY_PARAM = 'image';
// Native pushState/replaceState don't fire `popstate`, so same-tab writes below
// dispatch this to notify the useSyncExternalStore subscription of the change.
const IMAGE_PARAM_CHANGE_EVENT = 'samplegallery:imageparamchange';

function getImageParamSnapshot() {
  return new URLSearchParams(window.location.search).get(IMAGE_QUERY_PARAM);
}

function getImageParamServerSnapshot() {
  return null;
}

function subscribeToImageParam(onChange) {
  window.addEventListener('popstate', onChange);
  window.addEventListener(IMAGE_PARAM_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(IMAGE_PARAM_CHANGE_EVENT, onChange);
  };
}

// The `image` query param is the single source of truth for which image is open,
// mirroring the raw window.history approach used for the recipe-selection modal on
// the home page (app/page.jsx) so deep-linking works the same way across the app.
function writeImageParam(uuid, historyMethod) {
  const url = new URL(window.location.href);
  const params = new URLSearchParams(url.search);
  if (uuid) {
    params.set(IMAGE_QUERY_PARAM, uuid);
  } else {
    params.delete(IMAGE_QUERY_PARAM);
  }
  const nextSearch = params.toString();
  const nextHref = `${url.pathname}${nextSearch ? `?${nextSearch}` : ''}${url.hash}`;
  const currentHref = `${url.pathname}${url.search}${url.hash}`;
  if (nextHref === currentHref) return;
  window.history[historyMethod]({}, '', nextHref);
  window.dispatchEvent(new Event(IMAGE_PARAM_CHANGE_EVENT));
}

function collectSocialLinks(author) {
  if (!author) return [];

  const normalize = (value) => {
    const str = typeof value === 'string' ? value.trim() : '';
    return str ? str : null;
  };

  const entries = [
    { key: 'instagram', label: 'Instagram', url: normalize(author.instagramLink) },
    { key: 'flickr', label: 'Flickr', url: normalize(author.flickrLink) },
    { key: 'website', label: 'Website', url: normalize(author.website) },
    { key: 'kofi', label: 'Ko-fi', url: normalize(author.kofiLink) }
  ];

  return entries.filter((entry) => Boolean(entry.url));
}

function normalizeImages(images) {
  return (images ?? [])
    .map((img, idx) => {
      if (!img) return null;
      const smallSrc = getImagePreviewUrl(img);
      const fullSrc = getRecipeModalImageUrl(img);
      if (!smallSrc && !fullSrc) return null;

      const sampleAuthor = img.sampleAuthor ?? null;
      const sampleAuthorLinks = sampleAuthor ? collectSocialLinks(sampleAuthor) : [];
      const sampleAuthorName = sampleAuthor
        ? sampleAuthor.name && sampleAuthor.name.trim()
          ? sampleAuthor.name.trim()
          : 'Contributor'
        : null;

      return {
        ...img,
        __key: img.id ?? `image-${idx}`,
        displaySrc: smallSrc,
        modalSrc: fullSrc,
        sampleAuthor,
        sampleAuthorName,
        sampleAuthorLinks
      };
    })
    .filter(Boolean);
}

function StarIcon({ filled = false }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3.75 14.55 8.92l5.7.83-4.12 4.01.97 5.67L12 16.75l-5.1 2.68.97-5.67-4.12-4.01 5.7-.83L12 3.75Z" />
    </svg>
  );
}

export default function SampleGallery({
  images,
  title = 'Sample images',
  canDelete = false,
  canSetPrimary = false,
  recipeId = null,
  recipeName = '',
  deleteImageAction = null,
  setPrimaryImageAction = null
}) {
  const normalizedImages = useMemo(() => normalizeImages(images), [images]);
  const [isDeletePending, startDeleteTransition] = useTransition();
  const [isPrimaryPending, startPrimaryTransition] = useTransition();
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const [primaryError, setPrimaryError] = useState('');
  const router = useRouter();

  // The `image` query param (read via useSyncExternalStore, so it stays in sync with
  // both browser back/forward and our own same-tab history writes) is the single
  // source of truth for which image is open — only one gallery instance's images
  // will ever contain a match, so the other stays closed automatically.
  const imageParam = useSyncExternalStore(subscribeToImageParam, getImageParamSnapshot, getImageParamServerSnapshot);
  const activeIndex = useMemo(() => {
    if (!imageParam) return null;
    const idx = normalizedImages.findIndex((img) => img.uuid === imageParam);
    return idx >= 0 ? idx : null;
  }, [imageParam, normalizedImages]);

  const openModal = useCallback(
    (idx) => {
      if (!Number.isInteger(idx) || idx < 0 || idx >= normalizedImages.length) return;
      writeImageParam(normalizedImages[idx]?.uuid ?? null, 'pushState');
    },
    [normalizedImages]
  );

  const closeModal = useCallback(() => {
    writeImageParam(null, 'replaceState');
  }, []);

  const showModal = activeIndex != null && activeIndex >= 0 && activeIndex < normalizedImages.length;
  const activeImage = showModal ? normalizedImages[activeIndex] : null;
  const hasMultiple = normalizedImages.length > 1;

  const goPrev = useCallback(() => {
    if (!hasMultiple || activeIndex == null) return;
    const prevIdx = (activeIndex - 1 + normalizedImages.length) % normalizedImages.length;
    writeImageParam(normalizedImages[prevIdx]?.uuid ?? null, 'pushState');
  }, [hasMultiple, activeIndex, normalizedImages]);

  const goNext = useCallback(() => {
    if (!hasMultiple || activeIndex == null) return;
    const nextIdx = (activeIndex + 1) % normalizedImages.length;
    writeImageParam(normalizedImages[nextIdx]?.uuid ?? null, 'pushState');
  }, [hasMultiple, activeIndex, normalizedImages]);

  useEffect(() => {
    if (!showModal) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeModal();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goPrev();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        goNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showModal, closeModal, goPrev, goNext]);

  useEffect(() => {
    if (!showModal) return undefined;
    const { body } = document;
    if (!body) return undefined;

    const originalOverflow = body.style.overflow;
    body.style.overflow = 'hidden';
    return () => {
      body.style.overflow = originalOverflow;
    };
  }, [showModal]);

  const openDeleteModal = useCallback((image) => {
    if (!canDelete || !deleteImageAction || !Number.isFinite(Number(recipeId)) || !image?.id) return;
    setDeleteError('');
    setPrimaryError('');
    setDeleteCandidate(image);
  }, [canDelete, deleteImageAction, recipeId]);

  const closeDeleteModal = useCallback(() => {
    if (isDeletePending) return;
    setDeleteCandidate(null);
    setDeleteError('');
    setPrimaryError('');
  }, [isDeletePending]);

  const handleDelete = useCallback(() => {
    if (!canDelete || !deleteImageAction || !Number.isFinite(Number(recipeId)) || deleteCandidate?.id == null) return;

    setDeleteError('');
    startDeleteTransition(async () => {
      try {
        await deleteImageAction({ recipeId: Number(recipeId), imageId: deleteCandidate.id });
        setDeleteCandidate(null);
        closeModal();
        router.refresh();
      } catch (error) {
        setDeleteError(error?.message || 'Failed to delete sample image');
      }
    });
  }, [canDelete, closeModal, deleteCandidate, deleteImageAction, recipeId, router]);

  const handleSetPrimary = useCallback((image) => {
    if (!canSetPrimary || !setPrimaryImageAction || !Number.isFinite(Number(recipeId)) || image?.id == null || image?.isPrimary) {
      return;
    }

    setPrimaryError('');
    startPrimaryTransition(async () => {
      try {
        await setPrimaryImageAction({ recipeId: Number(recipeId), imageId: image.id });
        router.refresh();
      } catch (error) {
        setPrimaryError(error?.message || 'Failed to update overview image');
      }
    });
  }, [canSetPrimary, recipeId, router, setPrimaryImageAction]);

  if (normalizedImages.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="text-xl font-semibold mb-3">{title}</h2>
      {primaryError ? <p className="mb-3 text-sm text-destructive">{primaryError}</p> : null}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {normalizedImages.map((img, idx) => (
          <div
            key={img.__key}
            className="relative flex-shrink-0"
          >
            <button
              type="button"
              onClick={() => openModal(idx)}
              className="focus:outline-none"
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'block', position: 'relative', height: 180, width: 240, borderRadius: 8, overflow: 'hidden' }}
              title={img.label ? formatComparisonImageLabelForDisplay(img.label) : ''}
            >
              <RecipePreviewImage
                src={img.displaySrc}
                alt={img.label ? `Sample (${formatComparisonImageLabelForDisplay(img.label)})` : 'Sample image'}
                fill
                sizes="(min-width: 1024px) 200px, (min-width: 768px) 150px, 120px"
                priority={idx === 0}
                imageClassName="object-cover"
                placeholderClassName="absolute inset-0 bg-muted/40"
              />
            </button>
            {canSetPrimary && (
              <button
                type="button"
                onClick={() => handleSetPrimary(img)}
                disabled={isPrimaryPending || img.isPrimary}
                className={`absolute top-2 left-2 rounded-full border p-2 backdrop-blur-sm transition disabled:cursor-default disabled:opacity-100 ${
                  img.isPrimary
                    ? 'border-amber-300/80 bg-amber-400/90 text-black shadow'
                    : 'border-white/50 bg-black/45 text-white hover:border-amber-200 hover:text-amber-200'
                }`}
                aria-label={img.isPrimary ? 'Shown in overview' : 'Show in overview'}
                title={img.isPrimary ? 'Shown in overview' : 'Show in overview'}
              >
                <StarIcon filled={img.isPrimary} />
              </button>
            )}
            {canDelete && deleteImageAction && (
              <button
                type="button"
                onClick={() => openDeleteModal(img)}
                disabled={isDeletePending || isPrimaryPending}
                className="absolute top-2 right-2 rounded bg-black/70 px-2 py-1 text-xs text-white disabled:opacity-60"
              >
                Delete
              </button>
            )}
          </div>
        ))}
      </div>

      {showModal && activeImage && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75 px-4"
          onClick={closeModal}
        >
          <div
            className="relative max-w-5xl w-full flex flex-col items-center"
            style={{ maxHeight: '90vh' }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={closeModal}
              className="absolute top-3 right-3 text-white text-3xl leading-none"
              style={{ background: 'none', border: 'none', cursor: 'pointer' }}
              aria-label="Close"
            >
              ×
            </button>

            {hasMultiple && (
              <button
                type="button"
                onClick={goPrev}
                className="absolute left-3 top-1/2 transform -translate-y-1/2 text-white text-4xl leading-none"
                style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                aria-label="Previous image"
              >
                ‹
              </button>
            )}

            <RecipePreviewImage
              src={activeImage.modalSrc}
              alt={activeImage.label ? `Sample (${formatComparisonImageLabelForDisplay(activeImage.label)})` : 'Sample image'}
              width={1200}
              height={900}
              sizes="(min-width: 1024px) 1200px, 100vw"
              imageClassName="rounded-lg shadow-lg object-contain"
              placeholderClassName="min-h-[320px] w-full rounded-lg bg-white/10 text-white"
              style={{ maxHeight: '80vh', width: '100%', height: 'auto' }}
            />

            <div className="mt-4 text-center text-white text-sm space-y-1 px-4">
              {canDelete && deleteImageAction && activeImage?.id != null && (
                <div className="mb-3">
                  <button
                    type="button"
                    onClick={() => openDeleteModal(activeImage)}
                    disabled={isDeletePending || isPrimaryPending}
                    className="rounded bg-white px-3 py-1.5 text-sm font-medium text-black disabled:opacity-60"
                  >
                    Delete sample image
                  </button>
                </div>
              )}
              {canSetPrimary && activeImage?.isPrimary && (
                <div className="mb-3 text-xs font-medium uppercase tracking-wide text-white/80">
                  Overview image
                </div>
              )}
              {(activeImage.sampleAuthorName ||
                activeImage.sampleAuthorLinks.length > 0) && (
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {activeImage.sampleAuthorName && (
                    <span className="font-semibold">
                      {activeImage.sampleAuthorName}
                    </span>
                  )}
                  <AuthorSocialLinks
                    links={activeImage.sampleAuthorLinks}
                    authorName={activeImage.sampleAuthorName}
                    iconClassName="text-white hover:text-gray-200 transition-colors"
                  />
                </div>
              )}
              {activeImage.label && (
                <p className="font-medium">
                  {[recipeName, formatComparisonImageLabelForDisplay(activeImage.label)].filter(Boolean).join(' — ')}
                </p>
              )}
              {formatImageMetadataLine(activeImage) && (
                <p>
                  {formatImageMetadataLine(activeImage)}
                </p>
              )}
            </div>

            {hasMultiple && (
              <button
                type="button"
                onClick={goNext}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-white text-4xl leading-none"
                style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                aria-label="Next image"
              >
                ›
              </button>
            )}
          </div>
        </div>
      )}

      <DeleteConfirmationModal
        key={deleteCandidate?.id != null ? `sample-delete-${deleteCandidate.id}` : 'sample-delete-closed'}
        open={Boolean(deleteCandidate)}
        title="Delete sample image"
        description={`This will remove the sample image from "${recipeName || 'this recipe'}". The underlying image file will also be deleted if it is no longer used anywhere else. Type the recipe name to confirm.`}
        confirmValue={recipeName}
        error={deleteError}
        isDeleting={isDeletePending}
        onClose={closeDeleteModal}
        onConfirm={handleDelete}
      />
    </section>
  );
}
