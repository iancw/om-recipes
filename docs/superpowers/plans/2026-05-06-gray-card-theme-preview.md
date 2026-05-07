# Gray-Card Theme Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a temporary header switcher that lets the app preview cool neutral, gray card, and warm gray background palettes in one local build.

**Architecture:** Keep the preview entirely client-side. A small header control will toggle a root `data-theme-preview` attribute, and `styles/globals.css` will override the shared theme tokens for each preview mode so the whole app updates without component-by-component restyling.

**Tech Stack:** Next.js App Router, React 19, Tailwind CSS v4 theme tokens, Vitest

---

## File Structure

- Create: `lib/theme-preview.js` — shared preview mode definitions and DOM helpers for applying/removing the root data attribute.
- Create: `components/ThemePreviewSwitch.jsx` — temporary client-side header pill that toggles preview modes without persistence.
- Create: `tests/theme-preview.test.js` — node-environment coverage for the preview mode metadata and root attribute helper functions.
- Modify: `components/header.jsx` — mount the temporary switcher in the shared header next to the existing navigation.
- Modify: `styles/globals.css` — add token overrides for the three preview palettes plus the flatter body background treatments they need.

### Task 1: Add a tested theme-preview helper

**Files:**
- Create: `lib/theme-preview.js`
- Create: `tests/theme-preview.test.js`
- Test: `tests/theme-preview.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, expect, it } from 'vitest';
import {
    DEFAULT_THEME_PREVIEW_MODE,
    THEME_PREVIEW_ATTRIBUTE,
    THEME_PREVIEW_OPTIONS,
    applyThemePreview,
    clearThemePreview
} from '../lib/theme-preview.js';

describe('theme preview helpers', () => {
    it('defines the three preview options in header order', () => {
        expect(DEFAULT_THEME_PREVIEW_MODE).toBe('default');
        expect(THEME_PREVIEW_OPTIONS.map((option) => option.id)).toEqual([
            'default',
            'cool-neutral',
            'gray-card',
            'warm-gray'
        ]);
    });

    it('applies and clears the root data attribute', () => {
        const root = {
            attrs: {},
            setAttribute(name, value) {
                this.attrs[name] = value;
            },
            removeAttribute(name) {
                delete this.attrs[name];
            }
        };

        applyThemePreview(root, 'gray-card');
        expect(root.attrs[THEME_PREVIEW_ATTRIBUTE]).toBe('gray-card');

        applyThemePreview(root, 'default');
        expect(root.attrs[THEME_PREVIEW_ATTRIBUTE]).toBeUndefined();

        applyThemePreview(root, 'warm-gray');
        clearThemePreview(root);
        expect(root.attrs[THEME_PREVIEW_ATTRIBUTE]).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/theme-preview.test.js`
Expected: FAIL because `lib/theme-preview.js` does not exist yet.

- [ ] **Step 3: Write the minimal helper implementation**

```js
export const THEME_PREVIEW_ATTRIBUTE = 'data-theme-preview';
export const DEFAULT_THEME_PREVIEW_MODE = 'default';
export const THEME_PREVIEW_OPTIONS = [
    { id: 'default', label: 'Default' },
    { id: 'cool-neutral', label: 'Cool Neutral' },
    { id: 'gray-card', label: 'Gray Card' },
    { id: 'warm-gray', label: 'Warm Gray' }
];

export function applyThemePreview(root, mode) {
    if (!root) return;
    if (!mode || mode === DEFAULT_THEME_PREVIEW_MODE) {
        root.removeAttribute(THEME_PREVIEW_ATTRIBUTE);
        return;
    }

    root.setAttribute(THEME_PREVIEW_ATTRIBUTE, mode);
}

export function clearThemePreview(root) {
    if (!root) return;
    root.removeAttribute(THEME_PREVIEW_ATTRIBUTE);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/theme-preview.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/theme-preview.js tests/theme-preview.test.js
git commit -m "Add theme preview helper"
```

### Task 2: Add the temporary header switcher

**Files:**
- Create: `components/ThemePreviewSwitch.jsx`
- Modify: `components/header.jsx`
- Modify: `lib/theme-preview.js`
- Test: `tests/theme-preview.test.js`

- [ ] **Step 1: Extend the helper test for invalid mode cleanup**

```js
it('clears the attribute for unknown preview ids', () => {
    const root = {
        attrs: {},
        setAttribute(name, value) {
            this.attrs[name] = value;
        },
        removeAttribute(name) {
            delete this.attrs[name];
        }
    };

    applyThemePreview(root, 'gray-card');
    applyThemePreview(root, 'not-a-real-mode');
    expect(root.attrs[THEME_PREVIEW_ATTRIBUTE]).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/theme-preview.test.js`
Expected: FAIL because `applyThemePreview()` still writes unknown ids directly to the DOM attribute.

- [ ] **Step 3: Implement the temporary switcher and header mount**

```jsx
'use client';

import { useEffect, useState } from 'react';
import {
    DEFAULT_THEME_PREVIEW_MODE,
    THEME_PREVIEW_OPTIONS,
    applyThemePreview,
    clearThemePreview,
    normalizeThemePreviewMode
} from 'lib/theme-preview.js';
import { cn } from 'lib/cn';

export default function ThemePreviewSwitch() {
    const [mode, setMode] = useState(DEFAULT_THEME_PREVIEW_MODE);

    useEffect(() => {
        const root = document.documentElement;
        applyThemePreview(root, mode);
        return () => clearThemePreview(root);
    }, [mode]);

    return (
        <div className="inline-flex items-center gap-1 rounded-full border border-border/80 bg-card/75 p-1">
            {THEME_PREVIEW_OPTIONS.map((option) => (
                <button
                    key={option.id}
                    type="button"
                    onClick={() => setMode(normalizeThemePreviewMode(option.id))}
                    className={cn(
                        'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                        mode === option.id
                            ? 'bg-foreground text-background'
                            : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                    )}
                >
                    {option.label}
                </button>
            ))}
        </div>
    );
}
```

```js
const THEME_PREVIEW_MODE_IDS = new Set(THEME_PREVIEW_OPTIONS.map((option) => option.id));

export function normalizeThemePreviewMode(mode) {
    return THEME_PREVIEW_MODE_IDS.has(mode) ? mode : DEFAULT_THEME_PREVIEW_MODE;
}

export function applyThemePreview(root, mode) {
    if (!root) return;

    const normalizedMode = normalizeThemePreviewMode(mode);
    if (normalizedMode === DEFAULT_THEME_PREVIEW_MODE) {
        root.removeAttribute(THEME_PREVIEW_ATTRIBUTE);
        return;
    }

    root.setAttribute(THEME_PREVIEW_ATTRIBUTE, normalizedMode);
}
```

```jsx
import ThemePreviewSwitch from 'components/ThemePreviewSwitch';

<nav className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 py-5">
    <Link href="/" className="no-underline">
        {/* existing brand block */}
    </Link>
    <div className="flex items-center gap-3">
        <ThemePreviewSwitch />
        <HeaderNav />
    </div>
</nav>
```

- [ ] **Step 4: Run the helper test to verify the shared DOM logic still passes**

Run: `npm test -- tests/theme-preview.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/ThemePreviewSwitch.jsx components/header.jsx lib/theme-preview.js tests/theme-preview.test.js
git commit -m "Add temporary header theme preview switcher"
```

### Task 3: Add the three gray-card palette overrides

**Files:**
- Modify: `styles/globals.css`
- Test: `tests/theme-preview.test.js`

- [ ] **Step 1: Implement the token overrides and flatter body backgrounds**

```css
:root[data-theme-preview='cool-neutral'] {
    --color-background: #d8dce0;
    --color-card: #eef1f3;
    --color-popover: #f3f5f6;
    --color-secondary: #c2c9cf;
    --color-accent: #d6dce0;
    --color-muted: #cfd5d8;
    --color-border: #aab2b8;
}

:root[data-theme-preview='gray-card'] {
    --color-background: #cfcfc9;
    --color-card: #e6e5e0;
    --color-popover: #ecebe6;
    --color-secondary: #bebdb6;
    --color-accent: #d8d7d1;
    --color-muted: #d0cfc9;
    --color-border: #aaa9a1;
}

:root[data-theme-preview='warm-gray'] {
    --color-background: #d6d0c8;
    --color-card: #ebe6df;
    --color-popover: #f1ebe5;
    --color-secondary: #c7bfb5;
    --color-accent: #dcd5cc;
    --color-muted: #d5cec5;
    --color-border: #afa69d;
}

body {
    background-image:
        radial-gradient(circle at top left, color-mix(in srgb, var(--color-secondary) 45%, white) 0, transparent 30%),
        linear-gradient(180deg, color-mix(in srgb, var(--color-background) 94%, white), var(--color-background));
}
```

- [ ] **Step 2: Run automated checks**

Run: `npm test -- tests/theme-preview.test.js && npm run lint`
Expected: PASS

- [ ] **Step 3: Run manual verification in the browser**

Run: `npm run dev`
Expected: The header pill appears on the main pages, resets on refresh, and each mode gives a distinct but coherent gray-card atmosphere without collapsing card contrast.

- [ ] **Step 4: Commit**

```bash
git add styles/globals.css components/ThemePreviewSwitch.jsx components/header.jsx lib/theme-preview.js tests/theme-preview.test.js
git commit -m "Add gray-card palette preview modes"
```

### Task 4: Final verification and cleanup

**Files:**
- Modify: none
- Test: `tests/theme-preview.test.js`

- [ ] **Step 1: Run the targeted test suite**

Run: `npm test -- tests/theme-preview.test.js`
Expected: PASS

- [ ] **Step 2: Run the full project test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 4: Inspect the final diff**

Run: `git diff -- components/header.jsx components/ThemePreviewSwitch.jsx lib/theme-preview.js styles/globals.css tests/theme-preview.test.js docs/superpowers/specs/2026-05-06-gray-card-theme-preview-design.md docs/superpowers/plans/2026-05-06-gray-card-theme-preview.md`
Expected: Only the planned gray-card preview UI, token, test, and doc changes are present.

- [ ] **Step 5: Commit the final verified state**

```bash
git add components/header.jsx components/ThemePreviewSwitch.jsx lib/theme-preview.js styles/globals.css tests/theme-preview.test.js docs/superpowers/specs/2026-05-06-gray-card-theme-preview-design.md docs/superpowers/plans/2026-05-06-gray-card-theme-preview.md
git commit -m "Finish gray-card theme preview"
```
