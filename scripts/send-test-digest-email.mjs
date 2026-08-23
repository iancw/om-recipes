import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function fail(message) {
    throw new Error(message);
}

export function parseArgs(argv) {
    const args = { saves: 3, sampleImages: 2, newRecipes: 1 };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--help' || arg === '-h') return { help: true };
        if (arg === '--to') args.to = argv[++i];
        else if (arg === '--saves') args.saves = Number(argv[++i]);
        else if (arg === '--sample-images') args.sampleImages = Number(argv[++i]);
        else if (arg === '--new-recipes') args.newRecipes = Number(argv[++i]);
        else fail(`Unknown argument: ${arg}`);
    }
    if (!args.to) fail('Missing required --to <email>');
    return args;
}

export async function main() {
    dotenv.config({ path: path.join(REPO_ROOT, '.env.local') });

    const { help, to, saves, sampleImages, newRecipes } = parseArgs(process.argv.slice(2));
    if (help) {
        console.log(
            'Usage: node scripts/send-test-digest-email.mjs --to <email> ' +
            '[--saves N] [--sample-images N] [--new-recipes N]'
        );
        return;
    }

    const { buildDigestEmail } = await import('../lib/notifications.js');
    const { sendEmail } = await import('../lib/oci/emailDelivery.js');

    const counts = {
        recipe_saved: saves,
        sample_image_added: sampleImages,
        new_recipe: newRecipes
    };
    const email = buildDigestEmail({ counts, uuid: 'test-preview-uuid' });

    await sendEmail({ to, ...email });
    console.log(`Sent test digest email to ${to}`);
    console.log(JSON.stringify(email, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error(error.message || error);
        process.exitCode = 1;
    });
}
