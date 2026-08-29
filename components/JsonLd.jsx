/**
 * Renders a <script type="application/ld+json"> tag for the given structured
 * data object. Angle brackets in the serialized JSON are escaped so that
 * user-supplied strings (recipe names, descriptions) cannot terminate the
 * script element. Renders nothing when `data` is null/undefined.
 */
export function JsonLd({ data }) {
    if (!data) return null;

    const json = JSON.stringify(data).replace(/</g, '\\u003c');

    return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
