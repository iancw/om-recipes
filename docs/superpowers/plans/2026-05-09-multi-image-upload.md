# Multi-Image Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow `/upload` to accept multiple JPGs, group them by exact recipe match, and render one independent recipe section per group with isolated create-or-attach submission.

**Architecture:** Keep the server actions largely intact and move the new complexity into two pure client-side seams: one helper that groups parsed upload candidates into exact-match sections, and one helper that orchestrates sequential section submission. Refactor the current single-file `RecipeUpload` component into a page-level dropzone/review shell plus section-level cards so text inputs do not rerender the heavy preview and detection UI on every keypress.

**Tech Stack:** Next.js App Router, React 19 client components, `react-dropzone`, `@uswriting/exiftool`, Vitest

---

## File Structure

### New files

- `app/upload/group-upload-candidates.js`
  Builds exact-match recipe groups from parsed file candidates and exposes a stable section model for the page.
- `app/upload/submit-upload-section.js`
  Runs sequential prepare/direct-upload/finalize steps for one section with injected dependencies so orchestration can be tested without rendering React.
- `app/upload/RecipeUploadSection.jsx`
  Owns one section's local metadata form, match messaging, section submit state, and success/error summary.
- `app/upload/InvalidUploadFilesCard.jsx`
  Renders invalid files outside valid recipe groups so review-only drops still show failures clearly.
- `tests/group-upload-candidates.test.js`
  Covers exact-match grouping and invalid-file separation.
- `tests/submit-upload-section.test.js`
  Covers create-first-then-attach behavior, exact-match attach behavior, and stop-on-failure behavior.

### Modified files

- `app/upload/RecipeUpload.jsx`
  Refactor from one-file state into page-level drop handling, candidate parsing, section rendering, and no-redirect success behavior.
- `app/upload/render-boundaries.js`
  Add comparison helpers for section boundaries so tests can lock in that text edits do not invalidate heavy preview/detection props.
- `tests/upload-render-boundaries.test.js`
  Extend current render-boundary tests to cover section form isolation.

## Task 1: Add Exact-Match Grouping Helper

**Files:**
- Create: `app/upload/group-upload-candidates.js`
- Test: `tests/group-upload-candidates.test.js`

- [ ] **Step 1: Write the failing grouping tests**

```js
import { describe, expect, it } from 'vitest';

import { buildUploadSections } from '../app/upload/group-upload-candidates.js';

describe('buildUploadSections', () => {
    it('groups files with the same exact fingerprint into one section', () => {
        const recipe = { hasColorProfileSettings: true, yellow: 1, blue: -1 };
        const candidates = [
            {
                id: 'a',
                fileName: 'one.jpg',
                status: 'parsed',
                recipeSettings: recipe,
                exactFingerprint: 'fp-1'
            },
            {
                id: 'b',
                fileName: 'two.jpg',
                status: 'parsed',
                recipeSettings: recipe,
                exactFingerprint: 'fp-1'
            }
        ];

        const result = buildUploadSections(candidates, { initialAuthor: 'Ian' });

        expect(result.sections).toHaveLength(1);
        expect(result.sections[0]).toMatchObject({
            exactFingerprint: 'fp-1',
            fileIds: ['a', 'b'],
            form: {
                author: 'Ian',
                name: 'one',
                notes: '',
                sourceUrl: ''
            }
        });
    });

    it('splits files from different exact fingerprints into separate sections', () => {
        const result = buildUploadSections(
            [
                { id: 'a', fileName: 'one.jpg', status: 'parsed', recipeSettings: { yellow: 1 }, exactFingerprint: 'fp-1' },
                { id: 'b', fileName: 'two.jpg', status: 'parsed', recipeSettings: { yellow: 2 }, exactFingerprint: 'fp-2' }
            ],
            { initialAuthor: 'Ian' }
        );

        expect(result.sections.map((section) => section.exactFingerprint)).toEqual(['fp-1', 'fp-2']);
    });

    it('keeps invalid files out of valid sections', () => {
        const result = buildUploadSections(
            [
                { id: 'a', fileName: 'ok.jpg', status: 'parsed', recipeSettings: { yellow: 1 }, exactFingerprint: 'fp-1' },
                { id: 'b', fileName: 'bad.jpg', status: 'invalid', error: 'No recipe found' }
            ],
            { initialAuthor: 'Ian' }
        );

        expect(result.sections).toHaveLength(1);
        expect(result.invalidFiles).toEqual([
            expect.objectContaining({ id: 'b', fileName: 'bad.jpg', error: 'No recipe found' })
        ]);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/group-upload-candidates.test.js`
Expected: FAIL with `Cannot find module '../app/upload/group-upload-candidates.js'`

- [ ] **Step 3: Write the minimal grouping helper**

```js
function defaultSectionName(fileName) {
    return String(fileName || '').replace(/\.[a-z0-9]+$/i, '').trim();
}

export function buildUploadSections(candidates, { initialAuthor = '' } = {}) {
    const sectionsByFingerprint = new Map();
    const invalidFiles = [];

    for (const candidate of candidates) {
        if (candidate?.status !== 'parsed' || !candidate?.exactFingerprint || !candidate?.recipeSettings) {
            if (candidate?.status === 'invalid') {
                invalidFiles.push(candidate);
            }
            continue;
        }

        if (!sectionsByFingerprint.has(candidate.exactFingerprint)) {
            sectionsByFingerprint.set(candidate.exactFingerprint, {
                id: `section-${candidate.exactFingerprint}`,
                exactFingerprint: candidate.exactFingerprint,
                recipeSettings: candidate.recipeSettings,
                fileIds: [],
                form: {
                    author: initialAuthor,
                    name: defaultSectionName(candidate.fileName),
                    notes: '',
                    sourceUrl: ''
                }
            });
        }

        sectionsByFingerprint.get(candidate.exactFingerprint).fileIds.push(candidate.id);
    }

    return {
        sections: Array.from(sectionsByFingerprint.values()),
        invalidFiles
    };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/group-upload-candidates.test.js`
Expected: PASS with `3 passed`

- [ ] **Step 5: Commit**

```bash
git add app/upload/group-upload-candidates.js tests/group-upload-candidates.test.js
git commit -m "test: add upload grouping helper"
```

## Task 2: Add Section Submission Orchestration Helper

**Files:**
- Create: `app/upload/submit-upload-section.js`
- Test: `tests/submit-upload-section.test.js`

- [ ] **Step 1: Write the failing orchestration tests**

```js
import { describe, expect, it, vi } from 'vitest';

import { submitUploadSection } from '../app/upload/submit-upload-section.js';

describe('submitUploadSection', () => {
    it('creates the recipe from the first image and attaches the rest', async () => {
        const prepare = vi
            .fn()
            .mockResolvedValueOnce({ ok: true, shouldCreateRecipe: true, imageId: 10, parUrl: 'https://upload/1', slug: 'recipe-a', recipeUuid: 'uuid-a' })
            .mockResolvedValueOnce({ ok: true, shouldCreateRecipe: false, imageId: 11, parUrl: 'https://upload/2', matchedRecipe: { id: 77, slug: 'recipe-a', uuid: 'uuid-a' } });
        const directUpload = vi.fn().mockResolvedValue({ ok: true });
        const finalize = vi.fn().mockResolvedValue({ ok: true });

        const result = await submitUploadSection({
            section: {
                mode: 'create',
                form: { author: 'Ian', name: 'Recipe A', notes: '', sourceUrl: '' },
                recipeSettings: { yellow: 1 },
                files: [
                    { name: 'first.jpg', type: 'image/jpeg', size: 10 },
                    { name: 'second.jpg', type: 'image/jpeg', size: 20 }
                ]
            },
            prepare,
            directUpload,
            finalize
        });

        expect(prepare).toHaveBeenCalledTimes(2);
        expect(result).toMatchObject({
            ok: true,
            createdRecipe: { slug: 'recipe-a', uuid: 'uuid-a' },
            uploadedCount: 2,
            failedFile: null
        });
    });

    it('attaches every image when the section already matches an existing recipe', async () => {
        const prepare = vi.fn().mockResolvedValue({
            ok: true,
            shouldCreateRecipe: false,
            imageId: 10,
            parUrl: 'https://upload/1',
            matchedRecipe: { id: 77, slug: 'recipe-a', uuid: 'uuid-a' }
        });
        const directUpload = vi.fn().mockResolvedValue({ ok: true });
        const finalize = vi.fn().mockResolvedValue({ ok: true });

        const result = await submitUploadSection({
            section: {
                mode: 'attach',
                form: { author: 'Ian', name: 'Recipe A', notes: '', sourceUrl: '' },
                recipeSettings: { yellow: 1 },
                files: [
                    { name: 'first.jpg', type: 'image/jpeg', size: 10 },
                    { name: 'second.jpg', type: 'image/jpeg', size: 20 }
                ]
            },
            prepare,
            directUpload,
            finalize
        });

        expect(result).toMatchObject({
            ok: true,
            matchedRecipe: { slug: 'recipe-a', uuid: 'uuid-a' },
            uploadedCount: 2
        });
    });

    it('stops the section on the first failed finalize and reports the failed file', async () => {
        const prepare = vi
            .fn()
            .mockResolvedValueOnce({ ok: true, shouldCreateRecipe: false, imageId: 10, parUrl: 'https://upload/1', matchedRecipe: { id: 77, slug: 'recipe-a', uuid: 'uuid-a' } })
            .mockResolvedValueOnce({ ok: true, shouldCreateRecipe: false, imageId: 11, parUrl: 'https://upload/2', matchedRecipe: { id: 77, slug: 'recipe-a', uuid: 'uuid-a' } });
        const directUpload = vi.fn().mockResolvedValue({ ok: true });
        const finalize = vi
            .fn()
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ ok: false, error: 'duplicate image' });

        const result = await submitUploadSection({
            section: {
                mode: 'attach',
                form: { author: 'Ian', name: 'Recipe A', notes: '', sourceUrl: '' },
                recipeSettings: { yellow: 1 },
                files: [
                    { name: 'first.jpg', type: 'image/jpeg', size: 10 },
                    { name: 'second.jpg', type: 'image/jpeg', size: 20 },
                    { name: 'third.jpg', type: 'image/jpeg', size: 30 }
                ]
            },
            prepare,
            directUpload,
            finalize
        });

        expect(prepare).toHaveBeenCalledTimes(2);
        expect(result).toMatchObject({
            ok: false,
            uploadedCount: 1,
            failedFile: 'second.jpg',
            failedStage: 'finalize'
        });
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/submit-upload-section.test.js`
Expected: FAIL with `Cannot find module '../app/upload/submit-upload-section.js'`

- [ ] **Step 3: Write the minimal orchestration helper**

```js
async function uploadOneFile({ file, section, prepare, directUpload, finalize }) {
    const prep = await prepare({
        author: section.form.author,
        name: section.form.name,
        notes: section.form.notes,
        sourceUrl: section.form.sourceUrl,
        imageMeta: { name: file.name, type: file.type, size: file.size },
        recipeSettings: section.recipeSettings
    });
    if (!prep?.ok) {
        return { ok: false, stage: 'prepare', error: prep?.error || 'Prepare failed' };
    }

    await directUpload({ file, parUrl: prep.parUrl });

    const fin = await finalize({
        imageId: prep.imageId,
        originalFileSize: file.size
    });
    if (!fin?.ok) {
        return { ok: false, stage: 'finalize', error: fin?.error || 'Finalize failed', prep };
    }

    return { ok: true, prep, fin };
}

export async function submitUploadSection({ section, prepare, directUpload, finalize }) {
    const successes = [];
    let createdRecipe = null;
    let matchedRecipe = section.matchedRecipe ?? null;

    for (const file of section.files) {
        const result = await uploadOneFile({ file, section, prepare, directUpload, finalize });

        if (!result.ok) {
            return {
                ok: false,
                uploadedCount: successes.length,
                failedFile: file.name,
                failedStage: result.stage,
                error: result.error,
                createdRecipe,
                matchedRecipe
            };
        }

        if (result.prep.shouldCreateRecipe) {
            createdRecipe = { slug: result.prep.slug, uuid: result.prep.recipeUuid };
        }
        matchedRecipe = result.prep.matchedRecipe ?? matchedRecipe;
        successes.push(file.name);
    }

    return {
        ok: true,
        uploadedCount: successes.length,
        failedFile: null,
        createdRecipe,
        matchedRecipe
    };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/submit-upload-section.test.js`
Expected: PASS with `3 passed`

- [ ] **Step 5: Commit**

```bash
git add app/upload/submit-upload-section.js tests/submit-upload-section.test.js
git commit -m "test: add section upload orchestrator"
```

## Task 3: Refactor the Upload UI into Page Shell + Section Cards

**Files:**
- Create: `app/upload/RecipeUploadSection.jsx`
- Create: `app/upload/InvalidUploadFilesCard.jsx`
- Modify: `app/upload/RecipeUpload.jsx`

- [ ] **Step 1: Write the render-boundary tests before the refactor**

```js
import { describe, expect, it } from 'vitest';

import {
    areSectionPreviewPropsEqual,
    areSectionFormPropsEqual
} from '../app/upload/render-boundaries.js';

describe('upload render boundaries', () => {
    it('ignores section form edits when preview props are unchanged', () => {
        const previewProps = {
            fileNames: ['one.jpg', 'two.jpg'],
            previewUrls: ['blob:1', 'blob:2'],
            disablePreview: false,
            isPreparingPreview: false,
            recipeId: 'section-fp-1'
        };

        expect(
            areSectionPreviewPropsEqual(previewProps, {
                ...previewProps,
                author: 'New Author',
                name: 'New Recipe Name',
                notes: 'New Notes'
            })
        ).toBe(true);
    });

    it('rerenders the form subtree when section metadata changes', () => {
        expect(
            areSectionFormPropsEqual(
                { author: 'Ian', name: 'Recipe A', notes: '', sourceUrl: '' },
                { author: 'Ian', name: 'Recipe B', notes: '', sourceUrl: '' }
            )
        ).toBe(false);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/upload-render-boundaries.test.js`
Expected: FAIL with `areSectionPreviewPropsEqual is not exported`

- [ ] **Step 3: Implement the render-boundary helpers**

```js
export function areSectionPreviewPropsEqual(prevProps, nextProps) {
    return prevProps.recipeId === nextProps.recipeId
        && JSON.stringify(prevProps.fileNames) === JSON.stringify(nextProps.fileNames)
        && JSON.stringify(prevProps.previewUrls) === JSON.stringify(nextProps.previewUrls)
        && prevProps.disablePreview === nextProps.disablePreview
        && prevProps.isPreparingPreview === nextProps.isPreparingPreview;
}

export function areSectionFormPropsEqual(prevProps, nextProps) {
    return prevProps.author === nextProps.author
        && prevProps.name === nextProps.name
        && prevProps.notes === nextProps.notes
        && prevProps.sourceUrl === nextProps.sourceUrl
        && prevProps.submitState === nextProps.submitState;
}
```

- [ ] **Step 4: Refactor `RecipeUpload.jsx` to page-level drop/review state**

```jsx
const [candidates, setCandidates] = useState([]);
const [sections, setSections] = useState([]);
const [invalidFiles, setInvalidFiles] = useState([]);

const onDrop = async (acceptedFiles) => {
    const parsedCandidates = await Promise.all(
        acceptedFiles.map(async (file) => {
            try {
                const recipeSettings = await parseExif(file);
                if (!recipeSettings?.hasColorProfileSettings) {
                    return {
                        id: crypto.randomUUID(),
                        file,
                        fileName: file.name,
                        status: 'invalid',
                        error: 'No recipe found. Upload straight out of camera JPGs from OM-3, Pen-F, or E-P7 cameras.'
                    };
                }

                return {
                    id: crypto.randomUUID(),
                    file,
                    fileName: file.name,
                    status: 'parsed',
                    recipeSettings,
                    exactFingerprint: computeRecipeFingerprint(recipeSettings)
                };
            } catch (error) {
                return {
                    id: crypto.randomUUID(),
                    file,
                    fileName: file.name,
                    status: 'invalid',
                    error: `EXIF read error: ${error?.message || String(error)}`
                };
            }
        })
    );

    const grouped = buildUploadSections(parsedCandidates, { initialAuthor });
    setCandidates(parsedCandidates);
    setSections(grouped.sections);
    setInvalidFiles(grouped.invalidFiles);
};
```

- [ ] **Step 5: Add a self-contained `RecipeUploadSection` form component**

```jsx
export default function RecipeUploadSection({
    section,
    onSectionChange,
    onSubmitSection
}) {
    return (
        <Card className="w-full border-border/70 bg-card/80">
            <CardHeader className="pb-3">
                <CardTitle className="text-lg">{section.form.name || 'Detected recipe'}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
                <SectionPreview section={section} />
                <DetectedRecipeSettingsCard recipe={section.recipeSettings} />
                <form
                    className="flex flex-col gap-4"
                    onSubmit={(event) => {
                        event.preventDefault();
                        onSubmitSection(section.id);
                    }}
                >
                    <Input value={section.form.author} onChange={(event) => onSectionChange(section.id, 'author', event.target.value)} />
                    <Input value={section.form.name} onChange={(event) => onSectionChange(section.id, 'name', event.target.value)} />
                    <Textarea value={section.form.notes} onChange={(event) => onSectionChange(section.id, 'notes', event.target.value)} />
                    <Input value={section.form.sourceUrl} onChange={(event) => onSectionChange(section.id, 'sourceUrl', event.target.value)} />
                    <Button type="submit" disabled={section.submitState === 'uploading'}>
                        {section.mode === 'attach' ? 'Attach all images' : 'Create recipe and upload images'}
                    </Button>
                </form>
            </CardContent>
        </Card>
    );
}
```

- [ ] **Step 6: Add an invalid-files card and remove redirect-on-success**

```jsx
function InvalidUploadFilesCard({ invalidFiles }) {
    if (!invalidFiles.length) return null;

    return (
        <Card className="border-border/60 bg-card/70">
            <CardHeader className="pb-3">
                <CardTitle className="text-base">Invalid files</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
                {invalidFiles.map((file) => (
                    <Alert key={file.id} type="error">
                        {file.fileName}: {file.error}
                    </Alert>
                ))}
            </CardContent>
        </Card>
    );
}
```

- [ ] **Step 7: Run the render-boundary test to verify it passes**

Run: `npm test -- tests/upload-render-boundaries.test.js`
Expected: PASS with new section-boundary assertions passing

- [ ] **Step 8: Commit**

```bash
git add app/upload/RecipeUpload.jsx app/upload/RecipeUploadSection.jsx app/upload/InvalidUploadFilesCard.jsx app/upload/render-boundaries.js tests/upload-render-boundaries.test.js
git commit -m "feat: split upload page into grouped sections"
```

## Task 4: Wire Existing-Recipe Matching and Section Submission into the UI

**Files:**
- Modify: `app/upload/RecipeUpload.jsx`
- Modify: `app/upload/RecipeUploadSection.jsx`
- Modify: `app/upload/actions.js`
- Test: `tests/prepare-recipe-upload.test.js`

- [ ] **Step 1: Add the failing server-action test for exact-match attach defaults**

```js
it('returns an existing exact-match recipe so the section can default to attach mode', async () => {
    selectResults = [[
        {
            id: 321,
            uuid: 'matched-recipe-uuid',
            slug: 'existing-recipe',
            recipeName: 'Existing Recipe',
            authorName: 'Existing Author'
        }
    ]];

    insertHandlers = [
        () => ({
            values: vi.fn((values) => ({
                returning: vi.fn(() => Promise.resolve([{ id: 888, uuid: 'image-uuid-1' }]))
            }))
        })
    ];

    const { prepareRecipeUploadAction } = await loadActionsModule();

    const result = await prepareRecipeUploadAction({
        parameters: {
            author: 'Author',
            name: 'Recipe Name',
            notes: '',
            sourceUrl: '',
            imageMeta: {
                name: 'photo.jpg',
                type: 'image/jpeg',
                size: 2048
            },
            recipeSettings: {
                hasColorProfileSettings: true,
                hasToneLevel: true
            }
        }
    });

    expect(result).toMatchObject({
        ok: true,
        shouldCreateRecipe: false,
        matchedRecipe: {
            slug: 'existing-recipe',
            uuid: 'matched-recipe-uuid'
        }
    });
});
```

- [ ] **Step 2: Run the targeted server-action tests**

Run: `npm test -- tests/prepare-recipe-upload.test.js`
Expected: PASS or reveal any missing action contract needed by the section UI

- [ ] **Step 3: Load exact-match state per section and default section mode in the client**

```jsx
useEffect(() => {
    let cancelled = false;

    async function loadMatches() {
        const nextSections = await Promise.all(
            sections.map(async (section) => {
                const result = await findRecipeMatchAction({
                    parameters: { recipeSettings: section.recipeSettings }
                });

                if (!result?.ok) {
                    return {
                        ...section,
                        matchError: result?.error || 'Failed to check for existing recipes',
                        matchedRecipe: null,
                        mode: 'create'
                    };
                }

                return {
                    ...section,
                    matchedRecipe: result.full,
                    mode: result.full ? 'attach' : 'create',
                    matchError: ''
                };
            })
        );

        if (!cancelled) {
            setSections(nextSections);
        }
    }

    if (sections.length > 0) {
        void loadMatches();
    }

    return () => {
        cancelled = true;
    };
}, [sections.length]);
```

- [ ] **Step 4: Connect section submit buttons to the orchestration helper**

```jsx
const handleSubmitSection = async (sectionId) => {
    setSections((current) => current.map((section) => (
        section.id === sectionId
            ? { ...section, submitState: 'uploading', submitError: '', submitSummary: null }
            : section
    )));

    const target = sections.find((section) => section.id === sectionId);
    const result = await submitUploadSection({
        section: {
            ...target,
            files: candidates
                .filter((candidate) => target.fileIds.includes(candidate.id))
                .map((candidate) => candidate.file)
        },
        prepare: (parameters) => prepareRecipeUploadAction({ parameters }),
        directUpload: async ({ file, parUrl }) => {
            const response = await fetch(parUrl, {
                method: 'PUT',
                headers: { 'Content-Type': file.type || 'application/octet-stream' },
                body: file
            });
            if (!response.ok) {
                throw new Error(`Direct upload failed: ${response.status}`);
            }
        },
        finalize: (parameters) => finalizeRecipeUploadAction({ parameters })
    });

    setSections((current) => current.map((section) => (
        section.id !== sectionId
            ? section
            : {
                ...section,
                submitState: result.ok ? 'ok' : 'error',
                submitError: result.ok ? '' : result.error,
                submitSummary: result.ok
                    ? (result.createdRecipe
                        ? `Recipe created and ${result.uploadedCount} images uploaded`
                        : `${result.uploadedCount} images attached to existing recipe`)
                    : null
            }
    )));
};
```

- [ ] **Step 5: Run the relevant tests after wiring**

Run: `npm test -- tests/group-upload-candidates.test.js tests/submit-upload-section.test.js tests/prepare-recipe-upload.test.js tests/upload-render-boundaries.test.js`
Expected: PASS with grouping, orchestration, render boundaries, and prepare-action contract intact

- [ ] **Step 6: Commit**

```bash
git add app/upload/RecipeUpload.jsx app/upload/RecipeUploadSection.jsx app/upload/actions.js tests/prepare-recipe-upload.test.js
git commit -m "feat: wire grouped upload sections"
```

## Task 5: Run Full Verification and Finish the Issue

**Files:**
- Modify: `docs/superpowers/plans/2026-05-09-multi-image-upload.md`
- Modify: Beads issue `om-recipes-4xl`

- [ ] **Step 1: Run the focused upload test suite**

Run: `npm test -- tests/group-upload-candidates.test.js tests/submit-upload-section.test.js tests/prepare-recipe-upload.test.js tests/finalize-resize.test.js tests/upload-render-boundaries.test.js tests/upload-preview.test.js`
Expected: PASS with all upload-specific tests green

- [ ] **Step 2: Run the broader project quality gates**

Run: `npm test`
Expected: PASS with the full Vitest suite green

Run: `npm run lint`
Expected: PASS with no ESLint errors

- [ ] **Step 3: Update the plan checkboxes and close the beads issue**

```bash
bd close om-recipes-4xl
```

Expected: issue status changes to `closed`

- [ ] **Step 4: Commit any final cleanup**

```bash
git add docs/superpowers/plans/2026-05-09-multi-image-upload.md
git commit -m "docs: finalize multi-image upload plan execution"
```

## Self-Review Notes

- Spec coverage:
  - exact-match grouping: Task 1
  - isolated per-section submission: Tasks 2 and 4
  - review-only invalid-file visibility: Task 3
  - exact-match attach defaults: Task 4
  - no redirect-on-success: Task 3
  - performance boundary for small forms: Task 3
- Placeholder scan:
  - no placeholder markers or deferred implementation language remains
- Type consistency:
  - section uses `form`, `matchedRecipe`, `mode`, `submitState`, and `fileIds` consistently across helper and UI tasks
