import { schedule } from '@netlify/functions';
import { reconcileAllDirtyUserStates } from '../../lib/user-state-flush.js';

export const handler = schedule('@hourly', async () => {
    const summary = await reconcileAllDirtyUserStates();
    console.log('[state-cache-flush]', summary);

    return { statusCode: 200, body: JSON.stringify(summary) };
});
