import { beforeEach, describe, expect, it, vi } from 'vitest';

let reconcileAllDirtyUserStatesMock;
let scheduledHandler;

vi.mock('@netlify/functions', () => ({
    schedule: (cron, handler) => {
        scheduledHandler = handler;
        return handler;
    }
}));

vi.mock('../lib/user-state-flush.js', () => ({
    reconcileAllDirtyUserStates: (...args) => reconcileAllDirtyUserStatesMock(...args)
}));

vi.mock('../lib/user-state-store.js', () => ({
    hasNetlifyBlobsContext: () => false
}));

describe('state-cache-flush scheduled function', () => {
    beforeEach(async () => {
        vi.resetModules();
        reconcileAllDirtyUserStatesMock = vi.fn(() => Promise.resolve({ reconciled: 3, failed: 0 }));
        await import('../netlify/functions/state-cache-flush.js');
    });

    it('reconciles all dirty users and returns a 200 with the summary', async () => {
        const response = await scheduledHandler();

        expect(reconcileAllDirtyUserStatesMock).toHaveBeenCalled();
        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toEqual({ reconciled: 3, failed: 0 });
    });
});
