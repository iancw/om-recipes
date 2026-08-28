'use client';

import { useCallback, useState, useSyncExternalStore, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from 'components/ui/button';
import { Textarea } from 'components/ui/textarea';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const RELATIVE_CUTOFF_MS = 30 * DAY_MS;

// `false` on the server and during the hydration render, `true` once hydration
// has finished — the same useSyncExternalStore approach SampleGallery.jsx uses
// for its client-only query-param snapshot. Nothing external to subscribe to,
// so the subscribe callback is a no-op.
const subscribeToNothing = () => () => {};
const getHydratedSnapshot = () => true;
const getHydratedServerSnapshot = () => false;

function toDate(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pluralize(count, unit) {
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}

// Rendered on the server and on the client's first paint. Locale- and
// timezone-independent so the two are byte-identical (no hydration mismatch).
function formatStableTimestamp(value) {
  const date = toDate(value);
  if (!date) return '';
  return date.toISOString().slice(0, 10);
}

function formatIsoTimestamp(value) {
  const date = toDate(value);
  if (!date) return undefined;
  return date.toISOString();
}

// Only used after hydration, so it is safe for it to depend on the viewer's
// clock and locale.
function formatRelativeTimestamp(value, now = Date.now()) {
  const date = toDate(value);
  if (!date) return '';

  const elapsed = now - date.getTime();
  if (elapsed < MINUTE_MS) return 'just now';
  if (elapsed < HOUR_MS) return pluralize(Math.floor(elapsed / MINUTE_MS), 'minute');
  if (elapsed < DAY_MS) return pluralize(Math.floor(elapsed / HOUR_MS), 'hour');
  if (elapsed < WEEK_MS) return pluralize(Math.floor(elapsed / DAY_MS), 'day');
  if (elapsed < RELATIVE_CUTOFF_MS) return pluralize(Math.floor(elapsed / WEEK_MS), 'week');
  return date.toLocaleDateString();
}

export default function CommentsSection({
  recipeId,
  recipePath = '/',
  comments,
  isLoggedIn,
  viewerAuthorIds = [],
  recipeAuthorId,
  addCommentAction,
  deleteCommentAction
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  // Timestamps stay on the locale-independent ISO string until after hydration,
  // then swap to the relative form. Deferring the swap this way keeps the server
  // HTML and the client's hydration render byte-identical, so there is no
  // hydration mismatch even though the relative string depends on the viewer's
  // clock and locale.
  const hasHydrated = useSyncExternalStore(subscribeToNothing, getHydratedSnapshot, getHydratedServerSnapshot);

  const canModerate = viewerAuthorIds.includes(recipeAuthorId);

  const handleSubmit = useCallback(
    (event) => {
      event.preventDefault();
      if (!body.trim()) return;

      setError('');
      startTransition(async () => {
        try {
          // Expected validation failures come back as data (`{ ok: false }`) so
          // the message survives Next.js's production error redaction.
          const result = await addCommentAction({ recipeId, body });
          if (result?.ok === false) {
            setError(result.error || 'Failed to post comment');
            return;
          }
          setBody('');
          router.refresh();
        } catch {
          // Genuinely unexpected: network failure, or a still-thrown error such
          // as 'Recipe not found'. Those messages are redacted in production, so
          // show a generic fallback.
          setError('Failed to post comment');
        }
      });
    },
    [addCommentAction, body, recipeId, router]
  );

  const handleDelete = useCallback(
    (commentId) => {
      setError('');
      startTransition(async () => {
        try {
          await deleteCommentAction({ recipeId, commentId });
          router.refresh();
        } catch (err) {
          setError(err?.message || 'Failed to delete comment');
        }
      });
    },
    [deleteCommentAction, recipeId, router]
  );

  return (
    <div className="space-y-4">
      <h2 className="text-2xl">Comments ({comments.length})</h2>

      {isLoggedIn ? (
        <form onSubmit={handleSubmit} className="space-y-2">
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Share your thoughts on this recipe..."
            maxLength={2000}
            disabled={isPending}
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" disabled={isPending || !body.trim()}>
            Post comment
          </Button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">
          <Link href={`/login?redirectTo=${encodeURIComponent(recipePath)}`} className="underline">
            Sign in
          </Link>{' '}
          to comment.
        </p>
      )}

      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments yet — be the first to say something.</p>
      ) : (
        <ul className="space-y-4">
          {comments.map((comment) => {
            const canDelete = canModerate || viewerAuthorIds.includes(comment.authorId);
            return (
              <li key={comment.id} className="rounded-lg border border-border/60 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{comment.authorName ?? 'Someone'}</span>
                  <time className="text-xs text-muted-foreground" dateTime={formatIsoTimestamp(comment.createdAt)}>
                    {hasHydrated
                      ? formatRelativeTimestamp(comment.createdAt)
                      : formatStableTimestamp(comment.createdAt)}
                  </time>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{comment.body}</p>
                {canDelete ? (
                  <button
                    type="button"
                    className="mt-2 text-xs text-muted-foreground underline"
                    disabled={isPending}
                    onClick={() => handleDelete(comment.id)}
                  >
                    Delete
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
