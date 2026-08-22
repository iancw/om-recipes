import { schedule } from '@netlify/functions';
import { isSixPmEastern, runDailyDigest } from '../../lib/notifications.js';

export const handler = schedule('@hourly', async () => {
    if (!isSixPmEastern(new Date())) {
        return { statusCode: 200, body: 'skip: not 6pm Eastern' };
    }

    const summary = await runDailyDigest();
    console.log('[notification-digest]', summary);

    return { statusCode: 200, body: JSON.stringify(summary) };
});
