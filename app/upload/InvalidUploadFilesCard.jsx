import React from 'react';

import { Alert } from 'components/alert';
import { Card, CardContent, CardHeader, CardTitle } from 'components/ui/card';

export default function InvalidUploadFilesCard({ invalidFiles = [] }) {
    if (!invalidFiles.length) return null;

    return (
        <Card className="border-border/60 bg-card/70">
            <CardHeader className="pb-3">
                <CardTitle className="text-base">Invalid files</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
                {invalidFiles.map((file) => (
                    <Alert key={file.id || file.fileName} type="error">
                        {file.fileName}: {file.error}
                    </Alert>
                ))}
            </CardContent>
        </Card>
    );
}
