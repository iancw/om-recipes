import { runPrivacyRetentionCleanup } from '../lib/privacy.js';

async function main() {
    const summary = await runPrivacyRetentionCleanup();
    console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
