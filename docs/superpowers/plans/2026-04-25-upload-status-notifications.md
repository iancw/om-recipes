# Upload Status Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make upload progress clearly visible for both new recipe uploads and community sample attachments.

**Architecture:** Keep the upload workflow unchanged and elevate the existing client-side phase state into a persistent inline alert in the upload UI. Cover the behavior with a focused component test that drives the phase transitions through mocked upload actions.

**Tech Stack:** Next.js App Router, React 19, Vitest

---

### Task 1: Add a failing UI test for upload progress messaging

**Files:**
- Create: `tests/recipe-upload-status.test.jsx`
- Modify: none
- Test: `tests/recipe-upload-status.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
it('shows a visible upload status alert for each upload phase', async () => {
  // Render RecipeUpload with mocked dropzone + upload actions.
  // Start an upload and assert the inline alert shows:
  // 1. Preparing upload…
  // 2. Uploading JPG to storage…
  // 3. Finalizing recipe upload…
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/recipe-upload-status.test.jsx`
Expected: FAIL because the inline upload status alert does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```jsx
const uploadStatusMessage = getUploadStatusMessage(uploadPhase);
{uploadStatus === 'uploading' && (
  <Alert>
    <div>{uploadStatusMessage.title}</div>
    <div>{uploadStatusMessage.body}</div>
  </Alert>
)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/recipe-upload-status.test.jsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/recipe-upload-status.test.jsx app/upload/RecipeUpload.jsx
git commit -m "Add visible upload progress status"
```

### Task 2: Verify the final upload UI behavior

**Files:**
- Modify: `app/upload/RecipeUpload.jsx`
- Test: `tests/recipe-upload-status.test.jsx`

- [ ] **Step 1: Run targeted tests**

Run: `npm test -- tests/recipe-upload-status.test.jsx`
Expected: PASS

- [ ] **Step 2: Run the related upload action tests for regression coverage**

Run: `npm test -- tests/prepare-recipe-upload.test.js tests/finalize-resize.test.js`
Expected: PASS

- [ ] **Step 3: Inspect the diff**

Run: `git diff -- app/upload/RecipeUpload.jsx tests/recipe-upload-status.test.jsx docs/superpowers/specs/2026-04-25-upload-status-notifications-design.md docs/superpowers/plans/2026-04-25-upload-status-notifications.md`
Expected: Only the planned upload-status UI/test/doc changes are present.

- [ ] **Step 4: Commit**

```bash
git add app/upload/RecipeUpload.jsx tests/recipe-upload-status.test.jsx docs/superpowers/specs/2026-04-25-upload-status-notifications-design.md docs/superpowers/plans/2026-04-25-upload-status-notifications.md
git commit -m "Document and verify upload status notifications"
```
