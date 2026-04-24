'use client';

import { useTransition } from 'react';
import { getRecipePath } from '../lib/recipe-url.js';
import SaturationWheel from './SaturationWheel.jsx';
import { Button } from './ui/button.jsx';

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

export default function SlotRow({ slotNumber, assignment, modePosition, clearAction }) {
    const [isPending, startTransition] = useTransition();

    const handleClear = () => {
        startTransition(async () => {
            await clearAction(modePosition, slotNumber);
        });
    };

    return (
        <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
            <span className="w-16 shrink-0 text-xs font-medium text-muted-foreground">
                Color {slotNumber}
            </span>

            {!assignment ? (
                <span className="flex-1 text-sm text-muted-foreground/60 italic">Empty</span>
            ) : assignment.recipeNotFound ? (
                <>
                    <span className="flex-1 text-sm text-muted-foreground/60 italic">Recipe not found</span>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={isPending}
                        onClick={handleClear}
                        className="shrink-0 text-xs text-muted-foreground hover:text-destructive"
                    >
                        {isPending ? '…' : 'Clear'}
                    </Button>
                </>
            ) : (
                <>
                    {/* Color wheel thumbnail */}
                    <div className="shrink-0 overflow-hidden" style={{ width: 32, height: 32 }}>
                        <div style={{ transform: `scale(${32 / 260})`, transformOrigin: 'top left', width: 260, height: 260 }}>
                            <SaturationWheel values={assignment.colorWheelValues ?? []} />
                        </div>
                    </div>
                    {/* WB amber/green offset thumbnail */}
                    <WbThumbnail
                        amber={Number(assignment.whiteBalanceAmberOffset ?? 0)}
                        green={Number(assignment.whiteBalanceGreenOffset ?? 0)}
                    />
                    <div className="min-w-0 flex-1">
                        {assignment.recipeSlug ? (
                            <a
                                href={getRecipePath({ slug: assignment.recipeSlug })}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="truncate block text-sm font-medium hover:underline"
                                onClick={(e) => e.stopPropagation()}
                            >
                                {assignment.recipeName}
                            </a>
                        ) : (
                            <div className="truncate text-sm font-medium">{assignment.recipeName}</div>
                        )}
                        <div className="truncate text-xs text-muted-foreground">{assignment.authorName}</div>
                    </div>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={isPending}
                        onClick={handleClear}
                        className="shrink-0 text-xs text-muted-foreground hover:text-destructive"
                    >
                        {isPending ? '…' : 'Unassign'}
                    </Button>
                </>
            )}
        </div>
    );
}
