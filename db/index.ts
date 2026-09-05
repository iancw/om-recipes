import { neon } from '@netlify/neon';
import { drizzle } from 'drizzle-orm/neon-http';

import * as schema from './schema';

// Netlify Neon uses Drizzle's neon-http driver here.
// Important: neon-http does not support db.transaction().
// Keep multi-step writes idempotent, or switch drivers before adding transactions.
// TEMPORARY: logger prints every query to stdout, for a local sanity check
// that getSession() isn't hitting the DB on repeated logged-in page views.
// Remove before committing.
export const db = drizzle({
    schema,
    client: neon(),
    logger: true
});
