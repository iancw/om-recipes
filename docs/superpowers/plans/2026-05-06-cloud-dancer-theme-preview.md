# Cloud Dancer Theme Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the temporary gray-card preview variants with near-white Cloud Dancer variants while keeping `Default` and `Cool Neutral`.

**Architecture:** Keep the existing temporary header switcher and helper API intact, but replace the supported preview ids, labels, and CSS token blocks with a new Cloud Dancer set. Reuse the current helper/render tests so the switcher behavior stays covered while the palette set changes.

**Tech Stack:** Next.js App Router, React 19, Tailwind CSS v4 theme tokens, Vitest

---

## File Structure

- Modify: `lib/theme-preview.js` — replace the three gray-card preview ids and labels with the Cloud Dancer set while keeping normalization and fallback logic intact.
- Modify: `styles/globals.css` — keep `cool-neutral`, remove the gray-card CSS blocks, and add `cloud-dancer`, `cloud-dancer-steel`, and `cloud-dancer-mist` token overrides.
- Modify: `tests/theme-preview.test.js` — update helper expectations to the new option ids and explicit mode behavior.
- Modify: `tests/theme-preview-render.test.js` — update static render expectations to the new option labels/order.

### Task 1: Update the supported preview modes

**Files:**
- Modify: `lib/theme-preview.js`
- Modify: `tests/theme-preview.test.js`
- Test: `tests/theme-preview.test.js`

- [ ] **Step 1: Write the failing helper test**

```js
it('exposes the expected default mode and Cloud Dancer preview options', () => {
    expect(DEFAULT_THEME_PREVIEW_MODE).toBe('default');
    expect(THEME_PREVIEW_OPTIONS.map((option) => option.id)).toEqual([
        'default',
        'cool-neutral',
        'cloud-dancer',
        'cloud-dancer-steel',
        'cloud-dancer-mist'
    ]);
});

it('normalizes unsupported preview modes back to the default mode', () => {
    expect(normalizeThemePreviewMode('cloud-dancer')).toBe('cloud-dancer');
    expect(normalizeThemePreviewMode('sepia')).toBe(DEFAULT_THEME_PREVIEW_MODE);
    expect(normalizeThemePreviewMode(undefined)).toBe(DEFAULT_THEME_PREVIEW_MODE);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/theme-preview.test.js`
Expected: FAIL because `lib/theme-preview.js` still exposes `gray-card` and `warm-gray`.

- [ ] **Step 3: Write the minimal helper update**

```js
export const THEME_PREVIEW_OPTIONS = [
    { id: 'default', label: 'Default' },
    { id: 'cool-neutral', label: 'Cool Neutral' },
    { id: 'cloud-dancer', label: 'Cloud Dancer' },
    { id: 'cloud-dancer-steel', label: 'Cloud Dancer Steel' },
    { id: 'cloud-dancer-mist', label: 'Cloud Dancer Mist' }
];
```

```js
applyThemePreview(root, 'cloud-dancer');
expect(root.getAttribute(THEME_PREVIEW_ATTRIBUTE)).toBe('cloud-dancer');

applyThemePreview(root, 'cloud-dancer-mist');
clearThemePreview(root);
expect(root.getAttribute(THEME_PREVIEW_ATTRIBUTE)).toBeNull();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/theme-preview.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/theme-preview.js tests/theme-preview.test.js
git commit -m "Update theme preview modes for Cloud Dancer"
```

### Task 2: Replace the palette token blocks

**Files:**
- Modify: `styles/globals.css`
- Modify: `tests/theme-preview.test.js`
- Test: `tests/theme-preview.test.js`

- [ ] **Step 1: Keep the helper expectations aligned with the CSS selector ids**

```js
expect(THEME_PREVIEW_OPTIONS.slice(2).map((option) => option.id)).toEqual([
    'cloud-dancer',
    'cloud-dancer-steel',
    'cloud-dancer-mist'
]);
```

- [ ] **Step 2: Run test to verify the selector expectations fail if ids are not updated**

Run: `npm test -- tests/theme-preview.test.js`
Expected: FAIL until the helper ids and CSS selector plan are aligned.

- [ ] **Step 3: Replace the CSS preview blocks**

```css
:root[data-theme-preview='cloud-dancer'] {
    --color-background: #f6f7f4;
    --color-foreground: #202423;
    --color-card: #ffffff;
    --color-card-foreground: #202423;
    --color-popover: #fdfdfb;
    --color-popover-foreground: #202423;
    --color-secondary: #e7ecea;
    --color-secondary-foreground: #202423;
    --color-accent: #eef2f0;
    --color-accent-foreground: #202423;
    --color-muted: #edf1ef;
    --color-muted-foreground: #69706d;
    --color-border: #cfd7d3;
    --color-ring: #285d50;
}

:root[data-theme-preview='cloud-dancer-steel'] {
    --color-background: #f3f6f8;
    --color-foreground: #1d2327;
    --color-card: #fcfeff;
    --color-card-foreground: #1d2327;
    --color-popover: #f9fbfd;
    --color-popover-foreground: #1d2327;
    --color-secondary: #e1e8ed;
    --color-secondary-foreground: #1d2327;
    --color-accent: #e9eff4;
    --color-accent-foreground: #1d2327;
    --color-muted: #e8edf1;
    --color-muted-foreground: #66707a;
    --color-border: #c8d2da;
    --color-ring: #285d50;
}

:root[data-theme-preview='cloud-dancer-mist'] {
    --color-background: #f5f7f8;
    --color-foreground: #202526;
    --color-card: #fbfcfc;
    --color-card-foreground: #202526;
    --color-popover: #f8faf9;
    --color-popover-foreground: #202526;
    --color-secondary: #e5ebea;
    --color-secondary-foreground: #202526;
    --color-accent: #edf1f1;
    --color-accent-foreground: #202526;
    --color-muted: #ecefef;
    --color-muted-foreground: #6a7270;
    --color-border: #d0d8d6;
    --color-ring: #285d50;
}
```

```css
--background-image-body-spotlight: radial-gradient(
    circle at 18% 10%,
    color-mix(in srgb, var(--color-card) 40%, white) 0,
    transparent 26%
);
--background-image-body-base: linear-gradient(
    180deg,
    color-mix(in srgb, var(--color-background) 98%, white),
    color-mix(in srgb, var(--color-background) 92%, var(--color-secondary))
);
```

- [ ] **Step 4: Run automated checks**

Run: `npm test -- tests/theme-preview.test.js && npm run lint`
Expected: PASS, with only any pre-existing unrelated lint warnings.

- [ ] **Step 5: Commit**

```bash
git add styles/globals.css tests/theme-preview.test.js
git commit -m "Replace gray-card preview palettes with Cloud Dancer variants"
```

### Task 3: Update the switcher render expectations

**Files:**
- Modify: `tests/theme-preview-render.test.js`
- Test: `tests/theme-preview-render.test.js`

- [ ] **Step 1: Write the failing render expectation**

```js
const optionLabels = THEME_PREVIEW_OPTIONS.map((option) => option.label);
expect(optionLabels).toEqual([
    'Default',
    'Cool Neutral',
    'Cloud Dancer',
    'Cloud Dancer Steel',
    'Cloud Dancer Mist'
]);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/theme-preview-render.test.js`
Expected: FAIL until the rendered switcher labels/order match the new option set.

- [ ] **Step 3: Update the render assertions**

```js
const html = renderToStaticMarkup(createElement(Header));
const optionIndexes = THEME_PREVIEW_OPTIONS.map((option) => html.indexOf(option.label));

expect(optionIndexes.every((index) => index >= 0)).toBe(true);
expect(optionIndexes).toEqual([...optionIndexes].sort((left, right) => left - right));
expect(html).toContain('Cloud Dancer Steel');
expect(html).toContain('Cloud Dancer Mist');
expect(html.indexOf(THEME_PREVIEW_OPTIONS[0].label)).toBeLessThan(html.indexOf('Header Nav'));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/theme-preview-render.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/theme-preview-render.test.js
git commit -m "Update theme preview render expectations"
```

### Task 4: Final verification

**Files:**
- Modify: none
- Test: `tests/theme-preview.test.js`
- Test: `tests/theme-preview-render.test.js`

- [ ] **Step 1: Run the targeted preview tests**

Run: `npm test -- tests/theme-preview.test.js tests/theme-preview-render.test.js`
Expected: PASS

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: PASS, with only any pre-existing unrelated warnings.

- [ ] **Step 4: Inspect the final diff**

Run: `git diff -- lib/theme-preview.js styles/globals.css tests/theme-preview.test.js tests/theme-preview-render.test.js docs/superpowers/specs/2026-05-06-cloud-dancer-theme-preview-design.md docs/superpowers/plans/2026-05-06-cloud-dancer-theme-preview.md`
Expected: Only the planned Cloud Dancer preview option, palette, test, and doc changes are present.

- [ ] **Step 5: Commit the final verified state**

```bash
git add lib/theme-preview.js styles/globals.css tests/theme-preview.test.js tests/theme-preview-render.test.js docs/superpowers/specs/2026-05-06-cloud-dancer-theme-preview-design.md docs/superpowers/plans/2026-05-06-cloud-dancer-theme-preview.md
git commit -m "Finish Cloud Dancer theme preview update"
```
