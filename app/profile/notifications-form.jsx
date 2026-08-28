'use client';

import { useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from 'components/ui/button';

const FIELD_NAMES = ['notifyNewRecipe', 'notifySampleImage', 'notifySave', 'notifyComment', 'emailDigestEnabled'];

function getValuesFromFormData(formData) {
    return FIELD_NAMES.reduce((values, name) => {
        values[name] = formData.get(name) != null;
        return values;
    }, {});
}

function hasChanges(form, savedValues) {
    if (!form) return false;

    const values = getValuesFromFormData(new FormData(form));
    return FIELD_NAMES.some((name) => values[name] !== Boolean(savedValues[name]));
}

function NotificationSubmitButton({ isDirty }) {
    const { pending } = useFormStatus();

    return (
        <Button type="submit" disabled={!isDirty || pending}>
            {pending ? 'Saving...' : 'Save notification preferences'}
        </Button>
    );
}

export function NotificationPreferencesForm({ action, initialValues }) {
    const formRef = useRef(null);
    const [savedValues, setSavedValues] = useState(initialValues);
    const [isDirty, setIsDirty] = useState(false);

    const handleInput = () => {
        setIsDirty(hasChanges(formRef.current, savedValues));
    };

    const handleSubmit = async (formData) => {
        await action(formData);
        setSavedValues(getValuesFromFormData(formData));
        setIsDirty(false);
    };

    return (
        <form ref={formRef} action={handleSubmit} className="flex flex-col gap-4" onInput={handleInput}>
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
                <NotificationSubmitButton isDirty={isDirty} />
            </div>
        </form>
    );
}
