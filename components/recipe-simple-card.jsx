import React from "react";
import RecipePreviewImage from "./RecipePreviewImage.jsx";
import { getRecipeCardPreviewUrl, SAMPLE_IMAGE_SELECTION } from "../lib/recipe-image-selection.js";
import { Badge } from "./ui/badge.jsx";
import { Card, CardContent } from "./ui/card.jsx";
import { cn } from "../lib/cn.js";

export default function RecipeSimpleCard({ recipe, onClick, selectedImageOption = SAMPLE_IMAGE_SELECTION, priority = false }) {
  const previewUrl = getRecipeCardPreviewUrl(recipe, selectedImageOption);

  const getTruncatedNotes = (notes) => {
    if (!notes) return "";
    return notes.length > 300 ? notes.slice(0, 300) + "..." : notes;
  };

  const cardBody = (
    <Card
      className={cn(
        "group h-full overflow-hidden border-border/70 bg-card/90 transition-transform duration-200",
        onClick ? "cursor-pointer hover:-translate-y-1 hover:border-primary/35 hover:shadow-xl" : ""
      )}
    >
      <div className="relative aspect-[4/3] overflow-hidden border-b border-border/60 bg-muted/40">
        {previewUrl ? (
          <RecipePreviewImage
            src={previewUrl}
            alt={`${recipe.recipeName} sample`}
            fill
            priority={priority}
            sizes="(min-width: 1536px) 24rem, (min-width: 1024px) 30vw, (min-width: 768px) 45vw, 100vw"
            imageClassName="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            placeholderClassName="absolute inset-0 bg-muted/40"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No sample image</div>
        )}
      </div>
      <CardContent className="flex h-full flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{recipe?.authorName ?? 'Unknown author'}</Badge>
          <Badge variant="outline">{String(recipe?.type ?? 'COLOR').toUpperCase() === 'MONO' ? 'Monochrome' : 'Color'}</Badge>
          {recipe?.isSaved ? <Badge variant="outline">Saved</Badge> : null}
        </div>
        <div className="space-y-2">
          <h3 className="text-xl leading-tight text-foreground">{recipe.recipeName}</h3>
          {recipe.description ? (
            <p className="text-sm leading-6 text-muted-foreground whitespace-pre-wrap">
              {getTruncatedNotes(recipe.description)}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No description provided.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="recipe-simple-card" onClick={onClick}>
      {cardBody}
    </div>
  );
}
