import { beforeEach, describe, expect, it, vi } from 'vitest';

let selectMock;
const cacheState = vi.hoisted(() => ({ entries: new Map() }));

vi.mock('next/cache', () => ({
    unstable_cache: (fn, keyParts = []) => async (...args) => {
        const key = JSON.stringify([keyParts, args]);
        if (!cacheState.entries.has(key)) cacheState.entries.set(key, fn(...args));
        return cacheState.entries.get(key);
    }
}));

vi.mock('../db/index.ts', () => ({
    db: {
        select: (...args) => selectMock(...args)
    }
}));

vi.mock('../app/HomeCatalog.jsx', () => ({
    default: () => ({ type: 'div', props: { 'data-testid': 'home-catalog' } })
}));

vi.mock('next/link', () => ({
    default: ({ href, children }) => ({ type: 'a', props: { href, children } })
}));

function renderToTree(node) {
    if (node == null || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(renderToTree);
    const props = node.props ?? {};
    const children = props.children == null ? [] : [].concat(props.children).map(renderToTree);
    return { type: node.type, props: { ...props, children } };
}

function collect(node, predicate, acc = []) {
    if (node == null || typeof node !== 'object') return acc;
    if (Array.isArray(node)) {
        node.forEach((child) => collect(child, predicate, acc));
        return acc;
    }
    if (predicate(node)) acc.push(node);
    collect(node.props?.children, predicate, acc);
    return acc;
}

describe('home page crawlable recipe index', () => {
    beforeEach(() => {
        vi.resetModules();
        cacheState.entries.clear();

        globalThis.React = {
            createElement: (type, props, ...children) => {
                const resolvedProps = {
                    ...(props ?? {}),
                    ...(children.length > 0 ? { children: children.length === 1 ? children[0] : children } : {})
                };
                if (typeof type === 'function') return type(resolvedProps);
                return { type, props: resolvedProps };
            }
        };

        selectMock = vi.fn(() => ({
            from: vi.fn(() => ({
                orderBy: vi.fn(() =>
                    Promise.resolve([
                        { slug: 'portra-400', recipeName: 'Portra 400', authorName: 'Ada', type: 'COLOR' },
                        { slug: 'tri-x', recipeName: 'Tri-X', authorName: 'Bea', type: 'MONO' },
                        { slug: null, recipeName: 'No Slug', authorName: 'Cy', type: 'COLOR' }
                    ])
                )
            }))
        }));
    });

    it('server-renders an anchor to every slugged recipe', async () => {
        const { default: Page } = await import('../app/page.jsx');
        const tree = renderToTree(await Page());

        const anchors = collect(tree, (node) => node.type === 'a');
        const hrefs = anchors.map((node) => node.props.href);

        expect(hrefs).toEqual(['/recipes/portra-400', '/recipes/tri-x']);
    });

    it('renders the interactive catalog above the static index', async () => {
        const { default: Page } = await import('../app/page.jsx');
        const tree = renderToTree(await Page());

        const catalog = collect(tree, (node) => node.props?.['data-testid'] === 'home-catalog');
        const nav = collect(tree, (node) => node.type === 'nav' && node.props?.['aria-label'] === 'All recipes');

        expect(catalog).toHaveLength(1);
        expect(nav).toHaveLength(1);
    });

    it('caches the recipe link index across calls', async () => {
        const { getRecipeLinkIndex } = await import('../lib/public-recipe-catalog.js');

        await getRecipeLinkIndex();
        await getRecipeLinkIndex();

        expect(selectMock).toHaveBeenCalledTimes(1);
    });
});
