"use client";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import RecipeSimpleCard from "../components/recipe-simple-card.jsx";
import Link from 'next/link';
import RecipeCard from "../components/recipe-card.jsx";
import { Badge } from "../components/ui/badge.jsx";
import { Button, buttonVariants } from "../components/ui/button.jsx";
import { Card, CardContent } from "../components/ui/card.jsx";
import { Dialog, DialogContent } from "../components/ui/dialog.jsx";
import { Input } from "../components/ui/input.jsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select.jsx";
import { cn } from "../lib/cn.js";
import { RECIPE_TYPE_FILTER_VALUES } from "../lib/recipe-data.js";
import {
  buildRecipeSearchParams,
  clearRecipeSearchParams,
  findRecipeIndexByIdentifier,
  getCanonicalRecipeIdentifier,
  getRecipePath,
  getRecipeSelectionFromSearchParams
} from "../lib/recipe-url.js";
import { DEFAULT_RECIPE_SORT, RECIPE_SORT_OPTIONS } from "../lib/recipe-sort.js";
import {
  comparisonImageSelectionValue,
  formatComparisonImageLabelForDisplay,
  getAvailableComparisonImageLabels,
  SAMPLE_IMAGE_SELECTION
} from "../lib/recipe-image-selection.js";

const PAGE_SIZE = 12;

function TogglePill({ checked, label, onClick }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onClick}
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-2 text-sm transition-colors",
        checked
          ? "border-primary bg-primary text-primary-foreground shadow-sm"
          : "border-border bg-card/80 text-muted-foreground hover:border-primary/35 hover:text-foreground"
      )}
    >
      {label}
    </button>
  );
}

function FilterGroup({ label, children }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function getRecipeId(recipe) {
  return getCanonicalRecipeIdentifier(recipe);
}

function getRecipeListKey(recipe, index) {
  if (recipe?.id != null) return `recipe-${recipe.id}`;
  const recipeId = getRecipeId(recipe);
  if (recipeId) return `recipe-${recipeId}`;
  return `recipe-fallback-${index}`;
}

function mergeUniqueRecipes(existingRecipes, incomingRecipes) {
  const seen = new Set();
  const merged = [];

  for (const recipe of [...existingRecipes, ...incomingRecipes]) {
    const identity =
      recipe?.id != null
        ? `id:${recipe.id}`
        : getRecipeId(recipe)
          ? `recipe:${getRecipeId(recipe)}`
          : null;

    if (identity) {
      if (seen.has(identity)) continue;
      seen.add(identity);
    }

    merged.push(recipe);
  }

  return merged;
}

export default function Page() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(null);
  const [selectedRecipeIndex, setSelectedRecipeIndex] = useState(null);
  const [onlyMine, setOnlyMine] = useState(false);
  const [onlySaved, setOnlySaved] = useState(false);
  const [recipeType, setRecipeType] = useState(RECIPE_TYPE_FILTER_VALUES.ALL);
  const [sortBy, setSortBy] = useState(DEFAULT_RECIPE_SORT);
  const [selectedImageOption, setSelectedImageOption] = useState(SAMPLE_IMAGE_SELECTION);
  const hasLoadedInitialResults = useRef(false);
  const queryRef = useRef("");
  const resultsRef = useRef([]);
  const hasMoreRef = useRef(false);
  const loadingRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const activeSearchKeyRef = useRef("");
  const currentSearchRef = useRef({
    query: "",
    onlyMine: false,
    onlySaved: false,
    recipeType: RECIPE_TYPE_FILTER_VALUES.ALL,
    sortBy: DEFAULT_RECIPE_SORT
  });
  const activeResetRequestRef = useRef(null);
  const loadMoreSentinelRef = useRef(null);

  const updateWindowUrlSearch = useCallback((searchParams, historyMethod = "replaceState") => {
    const url = new URL(window.location.href);
    const nextSearch = searchParams.toString();
    const nextHref = `${url.pathname}${nextSearch ? `?${nextSearch}` : ''}${url.hash}`;
    const currentHref = `${url.pathname}${url.search}${url.hash}`;
    if (nextHref === currentHref) return;
    window.history[historyMethod]({}, '', nextHref);
  }, []);

  const normalizeRecipeSelectionUrl = useCallback((recipe) => {
    const nextParams = buildRecipeSearchParams(window.location.search, recipe);
    updateWindowUrlSearch(nextParams, "replaceState");
  }, [updateWindowUrlSearch]);

  const updateResults = useCallback((nextValue) => {
    setResults((current) => {
      const nextResults = typeof nextValue === "function" ? nextValue(current) : nextValue;
      resultsRef.current = nextResults;
      return nextResults;
    });
  }, []);

  const updateHasMore = useCallback((nextHasMore) => {
    hasMoreRef.current = nextHasMore;
    setHasMore(nextHasMore);
  }, []);

  const buildSearchKey = useCallback(
    (searchQuery, filters) =>
      JSON.stringify({
        q: searchQuery,
        onlyMine: Boolean(filters.onlyMine),
        onlySaved: Boolean(filters.onlySaved),
        recipeType: filters.recipeType ?? RECIPE_TYPE_FILTER_VALUES.ALL,
        sortBy: filters.sortBy ?? DEFAULT_RECIPE_SORT
      }),
    []
  );

  const fetchRecipePage = useCallback(async ({ searchQuery, filters = {}, offset = 0, append = false }) => {
    const searchKey = buildSearchKey(searchQuery, filters);
    const controller = new AbortController();

    if (!append) {
      activeSearchKeyRef.current = searchKey;
      currentSearchRef.current = {
        query: searchQuery,
        onlyMine: Boolean(filters.onlyMine),
        onlySaved: Boolean(filters.onlySaved),
        recipeType: filters.recipeType ?? RECIPE_TYPE_FILTER_VALUES.ALL,
        sortBy: filters.sortBy ?? DEFAULT_RECIPE_SORT
      };
      if (activeResetRequestRef.current) {
        activeResetRequestRef.current.abort();
      }
      activeResetRequestRef.current = controller;
      setLoading(true);
      setError(null);
      updateResults([]);
      updateHasMore(false);
      setSelectedRecipeIndex(null);
    } else {
      if (loadingRef.current || loadingMoreRef.current || !hasMoreRef.current) return null;
      if (activeSearchKeyRef.current !== searchKey) return null;
      loadingMoreRef.current = true;
      setLoadingMore(true);
    }

    try {
      const params = new URLSearchParams();
      params.set('q', searchQuery);
      if (filters.onlyMine) params.set('onlyMine', '1');
      if (filters.onlySaved) params.set('onlySaved', '1');
      if (filters.recipeType && filters.recipeType !== RECIPE_TYPE_FILTER_VALUES.ALL) {
        params.set('type', filters.recipeType);
      }
      params.set('sort', filters.sortBy ?? DEFAULT_RECIPE_SORT);
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(offset));

      const res = await fetch(`/recipes/search?${params.toString()}`, {
        signal: controller.signal
      });
      if (!res.ok) throw new Error("Failed to fetch recipes");
      const data = await res.json();
      if (activeSearchKeyRef.current !== searchKey) return null;

      const pageResults = Array.isArray(data?.results) ? data.results : [];
      const nextResults = append ? mergeUniqueRecipes(resultsRef.current, pageResults) : pageResults;

      updateResults(nextResults);
      updateHasMore(Boolean(data?.hasMore));

      return {
        results: pageResults,
        mergedResults: nextResults,
        hasMore: Boolean(data?.hasMore)
      };
    } catch (err) {
      if (err?.name === 'AbortError') return null;
      setError(err.message || "Unknown error");
      if (!append) updateHasMore(false);
      return null;
    } finally {
      if (!append) {
        if (activeResetRequestRef.current === controller) {
          activeResetRequestRef.current = null;
        }
        setLoading(false);
      } else {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [buildSearchKey, updateHasMore, updateResults]);

  const loadMoreRecipes = useCallback(async () => {
    if (loadingRef.current || loadingMoreRef.current || !hasMoreRef.current) return null;

    const {
      query: currentQuery,
      onlyMine: currentOnlyMine,
      onlySaved: currentOnlySaved,
      recipeType: currentRecipeType,
      sortBy: currentSortBy
    } = currentSearchRef.current;

    return fetchRecipePage({
      searchQuery: currentQuery,
      filters: {
        onlyMine: currentOnlyMine,
        onlySaved: currentOnlySaved,
        recipeType: currentRecipeType,
        sortBy: currentSortBy
      },
      offset: resultsRef.current.length,
      append: true
    });
  }, [fetchRecipePage]);

  const startSearch = useCallback((searchQuery, filters = {}) => {
    void fetchRecipePage({
      searchQuery,
      filters,
      offset: 0,
      append: false
    });
  }, [fetchRecipePage]);

  const maybeLoadMoreRecipes = useCallback(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel) return;
    if (loadingRef.current || loadingMoreRef.current || !hasMoreRef.current) return;

    const sentinelTop = sentinel.getBoundingClientRect().top;
    const viewportBottom = window.innerHeight + 300;
    if (sentinelTop <= viewportBottom) {
      void loadMoreRecipes();
    }
  }, [loadMoreRecipes]);

  const selectedRecipe = useMemo(() => {
    if (selectedRecipeIndex == null) return null;
    if (!Array.isArray(results) || results.length === 0) return null;
    if (selectedRecipeIndex < 0 || selectedRecipeIndex >= results.length) return null;
    return results[selectedRecipeIndex] ?? null;
  }, [results, selectedRecipeIndex]);

  const isModalOpen = selectedRecipe != null;

  const comparisonImageLabelsRef = useRef([]);
  const comparisonImageLabels = useMemo(() => {
    if (loading) return comparisonImageLabelsRef.current;
    const labels = getAvailableComparisonImageLabels(results);
    comparisonImageLabelsRef.current = labels;
    return labels;
  }, [results, loading]);

  const imageOptions = useMemo(
    () => [
      { value: SAMPLE_IMAGE_SELECTION, label: "Author sample" },
      ...comparisonImageLabels.map((label) => ({
        value: comparisonImageSelectionValue(label),
        label: formatComparisonImageLabelForDisplay(label)
      }))
    ],
    [comparisonImageLabels]
  );

  const openRecipeAtIndex = useCallback(
    (index, recipeList = resultsRef.current) => {
      if (!Array.isArray(recipeList) || recipeList.length === 0) return;
      if (!Number.isInteger(index)) return;
      if (index < 0 || index >= recipeList.length) return;
      const r = recipeList[index];
      const id = getRecipeId(r);
      if (!id) return;

      setSelectedRecipeIndex(index);

      const nextParams = buildRecipeSearchParams(window.location.search, r);
      updateWindowUrlSearch(nextParams, "pushState");
    },
    [updateWindowUrlSearch]
  );

  const closeModal = useCallback(() => {
    setSelectedRecipeIndex(null);
    const nextParams = clearRecipeSearchParams(window.location.search);
    updateWindowUrlSearch(nextParams, "replaceState");
  }, [updateWindowUrlSearch]);

  const handleSavedChange = useCallback((recipeId, isSaved) => {
    if (onlySaved && !isSaved) {
      updateResults((current) => current.filter((recipe) => recipe?.id !== recipeId));
      if (selectedRecipe?.id === recipeId) {
        closeModal();
      }
      return;
    }

    updateResults((current) =>
      current.map((recipe) =>
        recipe?.id === recipeId
          ? {
              ...recipe,
              isSaved
            }
          : recipe
      )
    );
  }, [closeModal, onlySaved, selectedRecipe?.id, updateResults]);

  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  useEffect(() => {
    startSearch("", {
      onlyMine: false,
      onlySaved: false,
      recipeType: RECIPE_TYPE_FILTER_VALUES.ALL,
      sortBy: DEFAULT_RECIPE_SORT
    });
    hasLoadedInitialResults.current = true;
  }, [startSearch]);

  useEffect(() => {
    if (!hasLoadedInitialResults.current) return;
    startSearch(queryRef.current, { onlyMine, onlySaved, recipeType, sortBy });
  }, [onlyMine, onlySaved, recipeType, sortBy, startSearch]);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    loadingMoreRef.current = loadingMore;
  }, [loadingMore]);

  useEffect(() => {
    if (imageOptions.some((option) => option.value === selectedImageOption)) return;
    setSelectedImageOption(SAMPLE_IMAGE_SELECTION);
  }, [imageOptions, selectedImageOption]);

  const syncSelectedRecipeFromLocation = useCallback(() => {
    const selection = getRecipeSelectionFromSearchParams(window.location.search);
    if (!selection) {
      setSelectedRecipeIndex(null);
      return;
    }

    const index = findRecipeIndexByIdentifier(resultsRef.current, selection.value);
    if (index >= 0) {
      setSelectedRecipeIndex(index);
      normalizeRecipeSelectionUrl(resultsRef.current[index]);
      return;
    }

    if (hasMoreRef.current && !loadingRef.current && !loadingMoreRef.current) {
      void loadMoreRecipes();
      return;
    }

    if (!loadingRef.current && !loadingMoreRef.current && !hasMoreRef.current) {
      setSelectedRecipeIndex(null);
    }
  }, [loadMoreRecipes, normalizeRecipeSelectionUrl]);

  useEffect(() => {
    syncSelectedRecipeFromLocation();
  }, [hasMore, loading, loadingMore, results, syncSelectedRecipeFromLocation]);

  // Keep modal state in sync with back/forward browser navigation.
  useEffect(() => {
    window.addEventListener("popstate", syncSelectedRecipeFromLocation);
    return () => window.removeEventListener("popstate", syncSelectedRecipeFromLocation);
  }, [syncSelectedRecipeFromLocation]);

  const openNextRecipe = useCallback(async () => {
    if (selectedRecipeIndex == null) return;

    const nextIndex = selectedRecipeIndex + 1;
    if (nextIndex < resultsRef.current.length) {
      openRecipeAtIndex(nextIndex);
      return;
    }

    const page = await loadMoreRecipes();
    const nextResults = page?.mergedResults ?? resultsRef.current;
    if (nextIndex < nextResults.length) {
      openRecipeAtIndex(nextIndex, nextResults);
    }
  }, [loadMoreRecipes, openRecipeAtIndex, selectedRecipeIndex]);

  // Keyboard controls when modal is open.
  useEffect(() => {
    if (!isModalOpen) return;

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeModal();
        return;
      }
      if (e.key === 'ArrowLeft') {
        if (selectedRecipeIndex == null) return;
        const prev = selectedRecipeIndex - 1;
        if (prev >= 0) {
          e.preventDefault();
          openRecipeAtIndex(prev);
        }
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        void openNextRecipe();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeModal, isModalOpen, openRecipeAtIndex, openNextRecipe, selectedRecipeIndex]);

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel || isModalOpen) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        if (loadingRef.current || loadingMoreRef.current || !hasMoreRef.current || error) return;
        void loadMoreRecipes();
      },
      {
        rootMargin: "300px 0px"
      }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [error, isModalOpen, loadMoreRecipes]);

  useEffect(() => {
    if (isModalOpen) return;

    function handleWindowPositionChange() {
      if (error) return;
      maybeLoadMoreRecipes();
    }

    window.addEventListener('scroll', handleWindowPositionChange, { passive: true });
    window.addEventListener('resize', handleWindowPositionChange);
    handleWindowPositionChange();

    return () => {
      window.removeEventListener('scroll', handleWindowPositionChange);
      window.removeEventListener('resize', handleWindowPositionChange);
    };
  }, [error, isModalOpen, maybeLoadMoreRecipes, results]);

  async function handleSubmit(e) {
    e.preventDefault();
    startSearch(query, { onlyMine, onlySaved, recipeType, sortBy });
  }

  return (
    <div className="flex w-full flex-col gap-8 pb-10 pt-2">
      <h1 className="sr-only">OM System Recipes</h1>
      <Card className="overflow-hidden border-border/60 bg-card/80">
        <CardContent className="flex flex-col gap-4 p-4 sm:p-5">
          <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-3">
            <Input
              type="text"
              name="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search recipes..."
              className="min-w-[200px] flex-1"
            />
            <Button type="submit">Search</Button>
            <div className="flex items-center gap-2">
              <label htmlFor="recipe-sort-by" className="text-sm font-medium text-muted-foreground">
                Sort
              </label>
              <Select value={sortBy} onValueChange={(value) => setSortBy(value || DEFAULT_RECIPE_SORT)}>
                <SelectTrigger id="recipe-sort-by" aria-label="Sort recipes" className="w-[180px] justify-between">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RECIPE_SORT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </form>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <FilterGroup label="View">
              <div aria-labelledby="recipe-image-group-label" className="flex flex-wrap items-center gap-2">
                <span id="recipe-image-group-label" className="sr-only">
                  Image view
                </span>
                <TogglePill
                  checked={selectedImageOption === SAMPLE_IMAGE_SELECTION}
                  label="Author sample"
                  onClick={() => setSelectedImageOption(SAMPLE_IMAGE_SELECTION)}
                />
                {imageOptions.length === 2 ? (
                  <TogglePill
                    checked={selectedImageOption === imageOptions[1].value}
                    label={imageOptions[1].label}
                    onClick={() => setSelectedImageOption(imageOptions[1].value)}
                  />
                ) : imageOptions.length > 2 ? (
                  <Select
                    value={selectedImageOption !== SAMPLE_IMAGE_SELECTION ? selectedImageOption : ""}
                    onValueChange={(val) => setSelectedImageOption(val || SAMPLE_IMAGE_SELECTION)}
                  >
                    <SelectTrigger
                      className={cn(
                        "w-[190px]",
                        selectedImageOption !== SAMPLE_IMAGE_SELECTION ? "border-primary ring-4 ring-primary/20" : ""
                      )}
                    >
                      <SelectValue placeholder="Comparison image" />
                    </SelectTrigger>
                    <SelectContent>
                      {imageOptions.slice(1).map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
              </div>
            </FilterGroup>

            <FilterGroup label="Type">
              <div role="radiogroup" aria-labelledby="recipe-type-filter-label" className="flex flex-wrap gap-2">
                <span id="recipe-type-filter-label" className="sr-only">
                  Recipe type filter
                </span>
                <TogglePill
                  checked={recipeType === RECIPE_TYPE_FILTER_VALUES.ALL}
                  label="All types"
                  onClick={() => setRecipeType(RECIPE_TYPE_FILTER_VALUES.ALL)}
                />
                <TogglePill
                  checked={recipeType === RECIPE_TYPE_FILTER_VALUES.COLOR}
                  label="Color"
                  onClick={() => setRecipeType(RECIPE_TYPE_FILTER_VALUES.COLOR)}
                />
                <TogglePill
                  checked={recipeType === RECIPE_TYPE_FILTER_VALUES.MONO}
                  label="Monochrome"
                  onClick={() => setRecipeType(RECIPE_TYPE_FILTER_VALUES.MONO)}
                />
              </div>
            </FilterGroup>

            <FilterGroup label="Library">
              <div role="radiogroup" aria-labelledby="recipe-filter-group-label" className="flex flex-wrap gap-2">
                <span id="recipe-filter-group-label" className="sr-only">
                  Recipe filter
                </span>
                <TogglePill
                  checked={!onlyMine && !onlySaved}
                  label="All"
                  onClick={() => {
                    setOnlyMine(false);
                    setOnlySaved(false);
                  }}
                />
                <TogglePill
                  checked={onlyMine}
                  label="Mine"
                  onClick={() => {
                    setOnlyMine(true);
                    setOnlySaved(false);
                  }}
                />
                <TogglePill
                  checked={onlySaved}
                  label="Saved"
                  onClick={() => {
                    setOnlySaved(true);
                    setOnlyMine(false);
                  }}
                />
              </div>
            </FilterGroup>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isModalOpen} onOpenChange={(open) => (!open ? closeModal() : null)}>
        <DialogContent className="max-w-[min(96vw,84rem)] overflow-hidden p-0">
          <div className="relative flex max-h-[88vh] flex-col">
            <div className="flex items-center justify-between gap-3 border-b border-border/70 bg-card/90 px-5 py-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Badge variant="outline">Recipe Detail</Badge>
                <span>Use left and right arrow keys to browse.</span>
              </div>
              <div className="flex items-center gap-2">
                {selectedRecipeIndex > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Previous recipe"
                    onClick={() => openRecipeAtIndex(selectedRecipeIndex - 1)}
                  >
                    ←
                  </Button>
                ) : null}
                {(Array.isArray(results) && selectedRecipeIndex < results.length - 1) || hasMore ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Next recipe"
                    onClick={() => {
                      void openNextRecipe();
                    }}
                  >
                    →
                  </Button>
                ) : null}
                <Button type="button" variant="ghost" size="icon" aria-label="Close recipe dialog" onClick={closeModal}>
                  ×
                </Button>
              </div>
            </div>
            <div className="overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
              <div className="mb-4 flex items-center justify-end">
                {(() => {
                  const id = getRecipeId(selectedRecipe);
                  if (!id) return null;
                  return (
                    <Link
                      href={getRecipePath(selectedRecipe)}
                      className={buttonVariants({ variant: 'ghost', className: 'no-underline' })}
                    >
                      Open full recipe page
                    </Link>
                  );
                })()}
              </div>
              <RecipeCard
                recipe={selectedRecipe}
                onSavedChange={handleSavedChange}
                selectedImageOption={selectedImageOption}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className="w-full">
        {loading ? <div className="text-center text-muted-foreground">Searching...</div> : null}
        {error ? <div className="text-center text-destructive">{error}</div> : null}
        {!loading && !error && results.length === 0 && (query || onlyMine || onlySaved || recipeType !== RECIPE_TYPE_FILTER_VALUES.ALL) ? (
          <Card className="mx-auto max-w-xl border-dashed bg-card/75">
            <CardContent className="p-8 text-center text-muted-foreground">No recipes found.</CardContent>
          </Card>
        ) : null}
        {!loading && !error && results.length > 0 ? (
          <ul className="grid w-full grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {results.map((r, i) => (
              <li key={getRecipeListKey(r, i)} className="p-0">
                {(() => {
                  const id = getRecipeId(r);
                  if (!id) {
                    return (
                      <div className="block cursor-not-allowed opacity-60" title="Recipe is missing uuid/slug">
                        <RecipeSimpleCard recipe={r} selectedImageOption={selectedImageOption} priority={i === 0} />
                      </div>
                    );
                  }

                  return (
                    <div
                      role="button"
                      tabIndex={0}
                      className="block w-full text-left"
                      onClick={() => openRecipeAtIndex(i)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openRecipeAtIndex(i);
                        }
                      }}
                    >
                      <RecipeSimpleCard recipe={r} selectedImageOption={selectedImageOption} priority={i === 0} />
                    </div>
                  );
                })()}
              </li>
            ))}
          </ul>
        ) : null}
        {!loading && !error && results.length > 0 ? (
          <div ref={loadMoreSentinelRef} className="flex flex-col items-center gap-3 py-8 text-sm text-muted-foreground">
            <div>{loadingMore ? "Loading more recipes..." : hasMore ? "Scroll for more recipes" : "All recipes loaded"}</div>
            {hasMore && !loadingMore ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void loadMoreRecipes();
                }}
              >
                Load more
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
