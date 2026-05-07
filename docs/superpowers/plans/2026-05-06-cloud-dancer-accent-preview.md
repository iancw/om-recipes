# Cloud Dancer Accent Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current `Cloud Dancer` preview trio with accent-led `Cloud Dancer Coral`, `Cloud Dancer Terracotta`, and `Cloud Dancer Ink` variants while keeping `Default` and `Cool Neutral`.

**Architecture:** Keep the existing temporary header switcher and helper API intact, but replace the supported preview ids and labels with the new accent-led set. Reuse the existing semantic theme tokens so shared buttons and links pick up the accent changes through `--color-primary`, `--color-primary-foreground`, and `--color-ring`, while the Cloud Dancer near-white surface tokens remain stable across all three variants.

**Tech Stack:** Next.js App Router, React 19, Tailwind CSS v4 theme tokens, Vitest, ESLint

---

## File Structure

- Modify: `lib/theme-preview.js` — replace the three current `Cloud Dancer` preview ids and labels with the accent-led set while keeping normalization and fallback logic unchanged.
- Modify: `styles/globals.css` — replace the current `cloud-dancer`, `cloud-dancer-steel`, and `cloud-dancer-mist` blocks with `cloud-dancer-coral`, `cloud-dancer-terracotta`, and `cloud-dancer-ink`, keeping the shared Cloud Dancer neutral foundation and adding new semantic accent tokens.
- Modify: `tests/theme-preview.test.js` — update helper expectations to the new ids, labels, and attribute behavior.
- Modify: `tests/theme-preview-render.test.js` — update the rendered switcher expectations to the new label order in the shared header.

### Task 1: Update the supported preview modes

**Files:**
- Modify: `lib/theme-preview.js`
- Modify: `tests/theme-preview.test.js`
- Test: `tests/theme-preview.test.js`

- [ ] **Step 1: Write the failing helper expectations**

```js
it('exposes the expected default mode and Cloud Dancer accent preview options', () => {
    expect(DEFAULT_THEME_PREVIEW_MODE).toBe('default');
    expect(THEME_PREVIEW_OPTIONS.map((option) => option.id)).toEqual([
        'default',
        'cool-neutral',
        'cloud-dancer-coral',
        'cloud-dancer-terracotta',
        'cloud-dancer-ink'
    ]);
    expect(THEME_PREVIEW_OPTIONS.slice(2).map((option) => option.label)).toEqual([
        'Cloud Dancer Coral',
        'Cloud Dancer Terracotta',
        'Cloud Dancer Ink'
    ]);
});

it('normalizes unsupported preview modes back to the default mode', () => {
    expect(normalizeThemePreviewMode('cloud-dancer-coral')).toBe('cloud-dancer-coral');
    expect(normalizeThemePreviewMode('sepia')).toBe(DEFAULT_THEME_PREVIEW_MODE);
    expect(normalizeThemePreviewMode(undefined)).toBe(DEFAULT_THEME_PREVIEW_MODE);
});
```

- [ ] **Step 2: Run the helper test to verify it fails**

Run: `npm test -- tests/theme-preview.test.js`
Expected: FAIL because `lib/theme-preview.js` still exports `cloud-dancer`, `cloud-dancer-steel`, and `cloud-dancer-mist`.

- [ ] **Step 3: Update the helper and explicit attribute assertions**

```js
export const THEME_PREVIEW_OPTIONS = [
    { id: 'default', label: 'Default' },
    { id: 'cool-neutral', label: 'Cool Neutral' },
    { id: 'cloud-dancer-coral', label: 'Cloud Dancer Coral' },
    { id: 'cloud-dancer-terracotta', label: 'Cloud Dancer Terracotta' },
    { id: 'cloud-dancer-ink', label: 'Cloud Dancer Ink' }
];
```

```js
applyThemePreview(root, 'cloud-dancer-coral');
expect(root.getAttribute(THEME_PREVIEW_ATTRIBUTE)).toBe('cloud-dancer-coral');

applyThemePreview(root, 'default');
expect(root.getAttribute(THEME_PREVIEW_ATTRIBUTE)).toBeNull();

applyThemePreview(root, 'cloud-dancer-ink');
clearThemePreview(root);
expect(root.getAttribute(THEME_PREVIEW_ATTRIBUTE)).toBeNull();
```

- [ ] **Step 4: Run the helper test to verify it passes**

Run: `npm test -- tests/theme-preview.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/theme-preview.js tests/theme-preview.test.js
git commit -m "Update Cloud Dancer preview mode options"
```

### Task 2: Update the rendered switcher labels and order

**Files:**
- Modify: `tests/theme-preview-render.test.js`
- Test: `tests/theme-preview-render.test.js`

- [ ] **Step 1: Update the render expectation to the accent-led option set**

```js
const optionLabels = THEME_PREVIEW_OPTIONS.map((option) => option.label);

expect(optionLabels).toEqual([
    'Default',
    'Cool Neutral',
    'Cloud Dancer Coral',
    'Cloud Dancer Terracotta',
    'Cloud Dancer Ink'
]);
```

```js
expect(html).toContain('Cloud Dancer Coral');
expect(html).toContain('Cloud Dancer Terracotta');
expect(html).toContain('Cloud Dancer Ink');
```

- [ ] **Step 2: Run the render test to verify the shared header still renders the updated option set**

Run: `npm test -- tests/theme-preview-render.test.js`
Expected: PASS once the test expectations match the new label set, because the shared header already renders `THEME_PREVIEW_OPTIONS`.

- [ ] **Step 3: Update the render assertions to the accent-led set**

```js
const html = renderToStaticMarkup(createElement(Header));
const optionIndexes = THEME_PREVIEW_OPTIONS.map((option) => html.indexOf(option.label));

expect(optionLabels).toEqual([
    'Default',
    'Cool Neutral',
    'Cloud Dancer Coral',
    'Cloud Dancer Terracotta',
    'Cloud Dancer Ink'
]);
expect(optionIndexes.every((index) => index >= 0)).toBe(true);
expect(optionIndexes).toEqual([...optionIndexes].sort((left, right) => left - right));
expect(html).toContain('Cloud Dancer Terracotta');
expect(html).toContain('Cloud Dancer Ink');
expect(html).toContain('aria-pressed="true"');
expect(html.indexOf(THEME_PREVIEW_OPTIONS[0].label)).toBeLessThan(html.indexOf('Header Nav'));
```

- [ ] **Step 4: Run the render test to verify it passes**

Run: `npm test -- tests/theme-preview-render.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/theme-preview-render.test.js
git commit -m "Update Cloud Dancer preview switcher labels"
```

### Task 3: Replace the Cloud Dancer preview token blocks with accent-led variants

**Files:**
- Modify: `styles/globals.css`
- Test: `tests/theme-preview.test.js`
- Test: `tests/theme-preview-render.test.js`

- [ ] **Step 1: Replace the three existing Cloud Dancer CSS blocks with accent-led variants**

```css
:root[data-theme-preview='cloud-dancer-coral'] {
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
    --color-primary: #b85f4d;
    --color-primary-foreground: #fff8f5;
    --color-ring: #b85f4d;
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
}

:root[data-theme-preview='cloud-dancer-terracotta'] {
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
    --color-primary: #935544;
    --color-primary-foreground: #fff8f4;
    --color-ring: #935544;
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
}

:root[data-theme-preview='cloud-dancer-ink'] {
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
    --color-primary: #355c7d;
    --color-primary-foreground: #f7fbff;
    --color-ring: #355c7d;
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
}
```

- [ ] **Step 2: Verify the targeted preview tests still pass after the CSS update**

Run: `npm test -- tests/theme-preview.test.js tests/theme-preview-render.test.js`
Expected: PASS

- [ ] **Step 3: Run lint after the CSS changes**

Run: `npm run lint`
Expected: PASS, with only any pre-existing unrelated warnings.

- [ ] **Step 4: Commit**

```bash
git add styles/globals.css
git commit -m "Add accent-led Cloud Dancer preview palettes"
```

### Task 4: Run final verification, including an in-app visual pass

**Files:**
- Modify: none
- Test: `tests/theme-preview.test.js`
- Test: `tests/theme-preview-render.test.js`

- [ ] **Step 1: Run the focused automated checks**

Run: `npm test -- tests/theme-preview.test.js tests/theme-preview-render.test.js && npm run lint`
Expected: PASS

- [ ] **Step 2: Start the app locally for a manual review**

Run: `npm run dev`
Expected: Next.js dev server starts and prints a local URL.

- [ ] **Step 3: Verify the three accent-led variants in the UI**

Check these conditions in the running app:

```text
1. The header switcher shows Default, Cool Neutral, Cloud Dancer Coral, Cloud Dancer Terracotta, and Cloud Dancer Ink in that order.
2. Primary buttons change accent color in each Cloud Dancer variant.
3. Outline buttons keep neutral fills while their focus rings use the current accent family.
4. Ghost buttons keep the neutral hover fills and remain legible against the Cloud Dancer background.
5. Any link-style buttons or elements using `text-primary` render in the active accent color and still read clearly against near-white surfaces.
```

- [ ] **Step 4: Inspect the final diff**

Run: `git diff -- lib/theme-preview.js styles/globals.css tests/theme-preview.test.js tests/theme-preview-render.test.js docs/superpowers/specs/2026-05-06-cloud-dancer-accent-preview-design.md docs/superpowers/plans/2026-05-06-cloud-dancer-accent-preview.md`
Expected: Only the planned accent preview helper, CSS, test, and plan/spec changes are present.

- [ ] **Step 5: Commit the final verified state**

```bash
git add lib/theme-preview.js styles/globals.css tests/theme-preview.test.js tests/theme-preview-render.test.js docs/superpowers/specs/2026-05-06-cloud-dancer-accent-preview-design.md docs/superpowers/plans/2026-05-06-cloud-dancer-accent-preview.md
git commit -m "Finish Cloud Dancer accent preview"
```
