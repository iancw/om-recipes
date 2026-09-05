import { resolveRecipeIndexEntry } from '../../../lib/public-recipe-catalog.js';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const identifier = String(searchParams.get('recipe') ?? '').trim();

    if (!identifier) {
        return Response.json({ error: 'missing_identifier' }, { status: 400 });
    }

    const entry = await resolveRecipeIndexEntry(identifier);
    if (!entry) {
        return Response.json({ error: 'not_found' }, { status: 404 });
    }

    return Response.json({ canonical: entry.slug });
}
