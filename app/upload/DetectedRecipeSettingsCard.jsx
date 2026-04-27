import React, { memo } from 'react';

import RecipeSettings from 'components/RecipeSettings';
import { Card, CardContent, CardHeader, CardTitle } from 'components/ui/card';

import { areDetectedRecipeSettingsPropsEqual } from './render-boundaries.js';

function DetectedRecipeSettingsCard({ recipe }) {
    if (!recipe) return null;

    return (
        <Card className="mt-6 overflow-hidden border-border/70 bg-card/75">
            <CardHeader className="pb-3">
                <CardTitle className="text-lg">Detected Recipe Settings</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
                <RecipeSettings recipe={recipe} />
            </CardContent>
        </Card>
    );
}

export default memo(DetectedRecipeSettingsCard, areDetectedRecipeSettingsPropsEqual);
