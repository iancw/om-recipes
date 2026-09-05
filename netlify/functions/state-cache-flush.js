import { schedule } from '@netlify/functions';
import { reconcileAllDirtyUserStates } from '../../lib/user-state-flush.js';
import { hasNetlifyBlobsContext } from '../../lib/user-state-store.js';

export const handler = schedule('@hourly', async () => {
    console.log('[state-cache-flush] backend', hasNetlifyBlobsContext() ? 'blobs' : 'local-fs');

    const summary = await reconcileAllDirtyUserStates();
    console.log('[state-cache-flush]', summary);

    return { statusCode: 200, body: JSON.stringify(summary) };
});
