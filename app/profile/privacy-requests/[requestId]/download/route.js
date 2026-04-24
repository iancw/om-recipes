import { NextResponse } from 'next/server';
import { getSession } from '../../../../../lib/auth.js';
import { getDownloadablePrivacyExport } from '../../../../../lib/privacy.js';

function parseRequestId(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(_request, { params }) {
    const session = await getSession();
    if (!session?.user) {
        return new NextResponse('Not authenticated', { status: 401 });
    }

    const resolvedParams = await params;
    const requestId = parseRequestId(resolvedParams?.requestId);
    if (!requestId) {
        return new NextResponse('Invalid request id', { status: 400 });
    }

    const artifact = await getDownloadablePrivacyExport({
        requestId,
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
