import { and, asc, desc, eq, gt, inArray } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { authors, comments, recipes } from '../db/schema.ts';

export const COMMENT_MAX_LENGTH = 2000;
export const COMMENT_COOLDOWN_MS = 15_000;

function normalizeBody(body) {
    return String(body ?? '').trim();
}

export async function getCommentsForRecipe(recipeId) {
    return db
        .select({
            id: comments.id,
            uuid: comments.uuid,
            body: comments.body,
            createdAt: comments.createdAt,
            authorId: comments.authorId,
            authorName: authors.name
        })
        .from(comments)
        .leftJoin(authors, eq(authors.id, comments.authorId))
        .where(eq(comments.recipeId, recipeId))
        .orderBy(asc(comments.createdAt));
}

export async function addComment({ recipeId, authorId, body }) {
    const normalized = normalizeBody(body);
    if (!normalized) throw new Error('Comment cannot be empty');
    if (normalized.length > COMMENT_MAX_LENGTH) {
        throw new Error(`Comment must be ${COMMENT_MAX_LENGTH} characters or fewer`);
    }

    const cooldownCutoff = new Date(Date.now() - COMMENT_COOLDOWN_MS);
    const recent = await db
        .select({ id: comments.id })
        .from(comments)
        .where(and(eq(comments.authorId, authorId), gt(comments.createdAt, cooldownCutoff)))
        .limit(1);
    if (recent.length > 0) {
        throw new Error('Please wait a moment before posting another comment');
    }

    const inserted = await db
        .insert(comments)
        .values({ recipeId, authorId, body: normalized })
        .returning({ id: comments.id, uuid: comments.uuid, createdAt: comments.createdAt });

    return inserted[0];
}

export async function deleteComment({ commentId, requestingAuthorIds, recipeAuthorId }) {
    const rows = await db
        .select({ id: comments.id, authorId: comments.authorId })
        .from(comments)
        .where(eq(comments.id, commentId))
        .limit(1);
    if (rows.length === 0) throw new Error('Comment not found');

    const comment = rows[0];
    const ids = requestingAuthorIds ?? [];
    const isCommentAuthor = ids.includes(comment.authorId);
    const isRecipeOwner = ids.includes(recipeAuthorId);
    if (!isCommentAuthor && !isRecipeOwner) throw new Error('Not authorized');

    await db.delete(comments).where(eq(comments.id, commentId));
}

export async function getCommentsPostedByAuthors(authorIds) {
    if (!authorIds || authorIds.length === 0) return [];

    return db
        .select({
            recipeId: comments.recipeId,
            recipeSlug: recipes.slug,
            recipeName: recipes.recipeName,
            body: comments.body,
            createdAt: comments.createdAt
        })
        .from(comments)
        .innerJoin(recipes, eq(recipes.id, comments.recipeId))
        .where(inArray(comments.authorId, authorIds))
        .orderBy(desc(comments.createdAt));
}
