'use client';

import { useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from 'components/ui/button';
import { Input } from 'components/ui/input';

const FIELD_NAMES = ['name', 'instagramLink', 'flickrLink', 'website', 'kofiLink'];

function getValuesFromFormData(formData) {
    return {
        name: String(formData.get('name') ?? ''),
        instagramLink: String(formData.get('instagramLink') ?? ''),
        flickrLink: String(formData.get('flickrLink') ?? ''),
        website: String(formData.get('website') ?? ''),
        kofiLink: String(formData.get('kofiLink') ?? '')
    };
}

function hasChanges(form, initialValues) {
    if (!form) return false;

    const values = getValuesFromFormData(new FormData(form));
    return FIELD_NAMES.some((name) => values[name] !== initialValues[name]);
}

function ProfileSubmitButton({ isDirty }) {
    const { pending } = useFormStatus();

    return (
        <Button type="submit" disabled={!isDirty || pending}>
            {pending ? 'Saving...' : 'Update profile'}
        </Button>
    );
}

export function ProfileForm({ action, initialValues }) {
    const formRef = useRef(null);
    const [savedValues, setSavedValues] = useState(initialValues);
    const [isDirty, setIsDirty] = useState(false);

    const handleInput = () => {
        setIsDirty(hasChanges(formRef.current, savedValues));
    };

    const handleSubmit = async (formData) => {
        await action(formData);
        const nextSavedValues = getValuesFromFormData(formData);
        setSavedValues(nextSavedValues);
        setIsDirty(false);
    };

        return (
        <form ref={formRef} action={handleSubmit} className="flex flex-col gap-4" onInput={handleInput}>
            <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-foreground">Display name</span>
                <Input name="name" defaultValue={initialValues.name} required />
            </label>

            <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-foreground">Instagram link</span>
                <Input
                    name="instagramLink"
                    type="url"
                    defaultValue={initialValues.instagramLink}
                    placeholder="https://instagram.com/yourhandle"
                />
            </label>

            <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-foreground">Flickr link</span>
                <Input
                    name="flickrLink"
                    type="url"
                    defaultValue={initialValues.flickrLink}
                    placeholder="https://flickr.com/photos/..."
                />
            </label>

            <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-foreground">Website</span>
                <Input
                    name="website"
                    type="url"
                    defaultValue={initialValues.website}
                    placeholder="https://example.com"
                />
            </label>

            <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-foreground">Ko-fi link</span>
                <Input
                    name="kofiLink"
                    type="url"
                    defaultValue={initialValues.kofiLink}
                    placeholder="https://ko-fi.com/yourhandle"
                />
            </label>

            <div className="pt-2">
                <ProfileSubmitButton isDirty={isDirty} />
            </div>

            <p className="text-sm leading-6 text-muted-foreground">
                Privacy notice, export requests, and account deletion controls are available below this profile form.
            </p>
        </form>
    );
}
