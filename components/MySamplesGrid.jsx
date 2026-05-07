'use client';

import React, { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import DeleteConfirmationModal from './DeleteConfirmationModal.jsx';
import RecipePreviewImage from './RecipePreviewImage.jsx';
import { getRecipePath } from '../lib/recipe-url.js';
import { getImagePreviewUrl } from '../lib/recipe-image-selection.js';
import { Badge } from './ui/badge.jsx';
import { Button } from './ui/button.jsx';
import { Card, CardContent } from './ui/card.jsx';

export default function MySamplesGrid({ samples, deleteSampleAction }) {
  const router = useRouter();
  const [selectedSample, setSelectedSample] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const [isDeletePending, startDeleteTransition] = useTransition();

  const normalizedSamples = useMemo(
    () =>
      (samples ?? []).filter((sample) => sample?.image?.id && getImagePreviewUrl(sample.image)),
    [samples]
  );

  const openDeleteModal = (sample) => {
    setDeleteError('');
    setSelectedSample(sample);
  };

  const closeDeleteModal = () => {
    if (isDeletePending) return;
    setSelectedSample(null);
    setDeleteError('');
  };

  const handleDelete = async () => {
    if (!selectedSample?.recipeId || !selectedSample?.image?.id) return;

    startDeleteTransition(async () => {
      try {
        await deleteSampleAction({
          recipeId: selectedSample.recipeId,
          imageId: selectedSample.image.id
        });
        setSelectedSample(null);
        router.refresh();
      } catch (error) {
        setDeleteError(error?.message || 'Failed to delete sample image');
      }
    });
  };

  return (
    <>
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-6 w-full">
        {normalizedSamples.map((sample) => {
          const previewUrl = getImagePreviewUrl(sample.image);
          const recipeHref = getRecipePath({ slug: sample.recipeSlug, uuid: sample.recipeUuid });
          return (
            <li key={`${sample.recipeId}:${sample.image.id}`} className="relative">
              <Card className="h-full overflow-hidden border-border/70 bg-card/80 transition-transform duration-200 hover:-translate-y-1 hover:border-primary/35 hover:shadow-xl">
                <CardContent className="relative p-3">
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    onClick={() => openDeleteModal(sample)}
                    className="absolute right-5 top-5 z-10 h-8 w-8 rounded-full bg-card/95"
                    disabled={isDeletePending}
                    aria-label="Delete sample image"
                  >
                    ×
                  </Button>
                  <Link href={recipeHref} className="block no-underline">
                    <div className="relative mb-4 w-full overflow-hidden rounded-xl border border-border/60" style={{ aspectRatio: '4 / 3' }}>
                      <RecipePreviewImage
                        src={previewUrl}
                        alt={sample.recipeName ? `${sample.recipeName} sample` : 'Sample image'}
                        fill
                        sizes="(min-width: 1536px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                        imageClassName="object-cover"
                        placeholderClassName="absolute inset-0 bg-muted/40"
                      />
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="secondary">Sample</Badge>
                      </div>
                      <div className="font-semibold text-foreground">{sample.recipeName}</div>
                      <div className="text-muted-foreground">{sample.recipeAuthorName}</div>
                      {(sample.image.camera || sample.image.lens) ? (
                        <div className="text-xs text-muted-foreground">
                          {[sample.image.camera, sample.image.lens].filter(Boolean).join(' • ')}
                        </div>
                      ) : null}
                    </div>
                  </Link>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>

      <DeleteConfirmationModal
        key={selectedSample?.image?.id != null ? `my-sample-delete-${selectedSample.image.id}` : 'my-sample-delete-closed'}
        open={Boolean(selectedSample)}
        title="Delete sample image"
        description={`This will remove the sample image from "${selectedSample?.recipeName ?? 'this recipe'}". The underlying image file will also be deleted if it is no longer used anywhere else. Type the recipe name to confirm.`}
        confirmValue={selectedSample?.recipeName ?? ''}
        error={deleteError}
        isDeleting={isDeletePending}
        onClose={closeDeleteModal}
        onConfirm={handleDelete}
      />
    </>
  );
}
