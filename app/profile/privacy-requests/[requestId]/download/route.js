import { NextResponse } from 'next/server';
import { getSession } from '../../../../../lib/auth.js';
import { getDownloadablePrivacyExport } from '../../../../../lib/privacy.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseRequestUuid(value) {
    return typeof value === 'string' && UUID_PATTERN.test(value) ? value : null;
}

export async function GET(_request, { params }) {
    const session = await getSession();
    if (!session?.user) {
        return new NextResponse('Not authenticated', { status: 401 });
    }

    const resolvedParams = await params;
    const requestUuid = parseRequestUuid(resolvedParams?.requestId);
    if (!requestUuid) {
        return new NextResponse('Invalid request id', { status: 400 });
    }

    const artifact = await getDownloadablePrivacyExport({
        requestUuid,
        userId: session.user.id
    });

    if (!artifact) {
        return new NextResponse('Export not found', { status: 404 });
    }

    return new NextResponse(artifact.buffer, {
        status: 200,
        headers: {
            'cache-control': 'private, no-store, max-age=0',
            'content-type': artifact.contentType,
            'content-disposition': `attachment; filename="${artifact.fileName}"`
        }
    });
}
