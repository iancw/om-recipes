'use client';

import { useMemo, useState, useTransition } from 'react';
import SaturationWheel from './SaturationWheel.jsx';
import { getRecipePath } from '../lib/recipe-url.js';
import SlotRow from './SlotRow.jsx';
import { Button } from './ui/button.jsx';
import { Input } from './ui/input.jsx';

const SLOT_NUMBERS = [1, 2, 3, 4];
const WB_MAX = 7;

function WbThumbnail({ amber = 0, green = 0 }) {
    const size = 32;
    const half = size / 2;
    const norm = (v) => Math.max(-WB_MAX, Math.min(WB_MAX, v)) / WB_MAX;
    const cx = half + norm(amber) * (half - 3);
    const cy = half - norm(green) * (half - 3);
    return (
        <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            className="shrink-0 rounded"
            style={{ background: '#323232' }}
            aria-label="WB offset"
        >
            <rect x="0" y="0" width={size} height="2" fill="#4ebe62" />
            <rect x="0" y={size - 2} width={size} height="2" fill="#cc47a0" />
            <rect x={size - 2} y="0" width="2" height={size} fill="#ffc540" />
            <rect x="0" y="0" width="2" height={size} fill="#3586d8" />
            <line x1={half} y1="0" x2={half} y2={size} stroke="#555" strokeWidth="0.8" />
            <line x1="0" y1={half} x2={size} y2={half} stroke="#555" strokeWidth="0.8" />
            <circle cx={cx} cy={cy} r="3" fill="#ddd" />
        </svg>
    );
}

function RecipeRow({ recipe, modePosition, onAssign, isPending }) {
    const [isSelected, setIsSelected] = useState(false);

    const handleAssign = (slotNum) => {
        onAssign(recipe.id, slotNum);
        setIsSelected(false);
    };

    const colorWheelValues = [
        Number(recipe.yellow ?? 0),
        Number(recipe.orange ?? 0),
        Number(recipe.orangeRed ?? 0),
        Number(recipe.red ?? 0),
        Number(recipe.magenta ?? 0),
        Number(recipe.violet ?? 0),
        Number(recipe.blue ?? 0),
        Number(recipe.blueCyan ?? 0),
        Number(recipe.cyan ?? 0),
        Number(recipe.greenCyan ?? 0),
        Number(recipe.green ?? 0),
        Number(recipe.yellowGreen ?? 0)
    ];

    return (
        <div className="rounded border border-border/40 bg-card">
            <button
                type="button"
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/30 transition-colors"
                onClick={() => setIsSelected((v) => !v)}
            >
                <div className="shrink-0 overflow-hidden" style={{ width: 32, height: 32 }}>
                    <div style={{ transform: 'scale(0.123)', transformOrigin: 'top left', width: 260, height: 260 }}>
                        <SaturationWheel values={colorWheelValues} />
                    </div>
                </div>
                <WbThumbnail
                    amber={Number(recipe.whiteBalanceAmberOffset ?? 0)}
                    green={Number(recipe.whiteBalanceGreenOffset ?? 0)}
                />
                <div className="min-w-0 flex-1">
                    {recipe.slug ? (
                        <a
                            href={getRecipePath(recipe)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="truncate inline text-sm font-medium hover:underline"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {recipe.recipeName}
                        </a>
                    ) : (
                        <div className="truncate text-sm font-medium">{recipe.recipeName}</div>
                    )}
                    <div className="truncate text-xs text-muted-foreground">{recipe.authorName}</div>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{isSelected ? '▲' : '▼'}</span>
            </button>

            {isSelected && (
                <div className="flex gap-2 border-t border-border/40 px-3 py-2">
                    <span className="self-center text-xs text-muted-foreground">Assign to:</span>
                    {SLOT_NUMBERS.map((num) => (
                        <Button
                            key={num}
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={isPending}
                            onClick={() => handleAssign(num)}
                            className="h-7 w-14 text-xs"
                        >
                            Color {num}
                        </Button>
                    ))}
                </div>
            )}
        </div>
    );
}

export default function SlotEditor({ modePosition, label, slots, allRecipes, upsertAction, clearAction }) {
    const [search, setSearch] = useState('');
    const [onlyCompatibleWb, setOnlyCompatibleWb] = useState(false);
    const [isPending, startTransition] = useTransition();

    // Build a composite WB key from all four WB fields so that recipes with the
    // same preset label but different temperature or amber/green offsets are treated
    // as distinct options.
    const wbKey = (r) => {
        if (!r.whiteBalance2) return null;
        const temp = r.whiteBalanceTemperature ?? '';
        const amber = r.whiteBalanceAmberOffset ?? 0;
        const green = r.whiteBalanceGreenOffset ?? 0;
        return `${r.whiteBalance2}|${temp}|${amber}|${green}`;
    };

    // Recipe IDs and WB keys of recipes currently assigned to this mode's slots.
    const { assignedRecipeIds, assignedWbKeys } = useMemo(() => {
        const recipeById = new Map(allRecipes.map((r) => [r.id, r]));
        const ids = new Set();
        const keys = new Set();
        for (const slot of Object.values(slots)) {
            if (slot?.recipeId) {
                ids.add(slot.recipeId);
                const recipe = recipeById.get(slot.recipeId);
                if (recipe) {
                    const key = wbKey(recipe);
                    if (key) keys.add(key);
                }
            }
        }
        return { assignedRecipeIds: ids, assignedWbKeys: keys };
    }, [slots, allRecipes]);

    const filteredRecipes = useMemo(() => {
        const q = search.trim().toLowerCase();
        return allRecipes.filter((r) => {
            if (assignedRecipeIds.has(r.id)) return false;
            const matchesSearch =
                !q ||
                r.recipeName.toLowerCase().includes(q) ||
                r.authorName.toLowerCase().includes(q);
            const matchesWb =
                !onlyCompatibleWb ||
                assignedWbKeys.size === 0 ||
                assignedWbKeys.has(wbKey(r));
            return matchesSearch && matchesWb;
        });
    }, [allRecipes, search, onlyCompatibleWb, assignedRecipeIds, assignedWbKeys]);

    const handleAssign = (recipeId, slotNum) => {
        startTransition(async () => {
            await upsertAction(modePosition, slotNum, recipeId);
        });
    };

    return (
        <div className="space-y-3">
            {/* Current slot assignments */}
            <div className="space-y-1.5">
                {SLOT_NUMBERS.map((num) => (
                    <SlotRow
                        key={num}
                        slotNumber={num}
                        assignment={slots[num] ?? null}
                        modePosition={modePosition}
                        clearAction={clearAction}
                    />
                ))}
            </div>

            {/* Search and WB filter */}
            <div className="space-y-2">
                <Input
                    type="search"
                    placeholder="Search recipes..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="h-8 text-sm"
                />
                <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                    <input
                        type="checkbox"
                        checked={onlyCompatibleWb}
                        onChange={(e) => setOnlyCompatibleWb(e.target.checked)}
                        disabled={assignedWbKeys.size === 0}
                        className="rounded"
                    />
                    <span className={assignedWbKeys.size === 0 ? 'text-muted-foreground' : ''}>
                        Only compatible white balance
                    </span>
                </label>
            </div>

            {/* Recipe list */}
            <div className="max-h-80 space-y-1 overflow-y-auto">
                {filteredRecipes.length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">No recipes found</p>
                ) : (
                    filteredRecipes.map((recipe) => (
                        <RecipeRow
                            key={recipe.id}
                            recipe={recipe}
                            modePosition={modePosition}
                            onAssign={handleAssign}
                            isPending={isPending}
                        />
                    ))
                )}
            </div>
        </div>
    );
}
