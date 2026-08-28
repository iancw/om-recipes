'use client';

import { SubmitButton } from 'components/submit-button';

export function NotificationPreferencesForm({ action, initialValues }) {
    return (
        <form action={action} className="flex flex-col gap-4">
            <label className="flex items-center gap-3 text-sm text-foreground">
                <input
                    type="checkbox"
                    name="notifyNewRecipe"
                    defaultChecked={initialValues.notifyNewRecipe}
                    className="h-4 w-4 rounded border-input"
                />
                Notify me about new recipes
            </label>
            <label className="flex items-center gap-3 text-sm text-foreground">
                <input
                    type="checkbox"
                    name="notifySampleImage"
                    defaultChecked={initialValues.notifySampleImage}
                    className="h-4 w-4 rounded border-input"
                />
                New sample images on my recipes
            </label>
            <label className="flex items-center gap-3 text-sm text-foreground">
                <input
                    type="checkbox"
                    name="notifySave"
                    defaultChecked={initialValues.notifySave}
                    className="h-4 w-4 rounded border-input"
                />
                Saves on my recipes
            </label>
            <label className="flex items-center gap-3 text-sm text-foreground">
                <input
                    type="checkbox"
                    name="notifyComment"
                    defaultChecked={initialValues.notifyComment}
                    className="h-4 w-4 rounded border-input"
                />
                Comments on my recipes
            </label>
            <label className="flex items-center gap-3 text-sm text-foreground">
                <input
                    type="checkbox"
                    name="emailDigestEnabled"
                    defaultChecked={initialValues.emailDigestEnabled}
                    className="h-4 w-4 rounded border-input"
                />
                Email me a daily digest
            </label>
            <div className="pt-2">
                <SubmitButton text="Save notification preferences" />
            </div>
        </form>
    );
}
