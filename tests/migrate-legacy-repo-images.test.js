import { describe, expect, it, vi } from 'vitest';

describe('migrate-legacy-repo-images helpers', () => {
    it('maps legacy /images/ URLs to local files and canonical object keys', async () => {
        const { buildMigrationPlanRow } = await import('../scripts/migrate-legacy-repo-images.mjs');

        expect(
            buildMigrationPlanRow({
                image: {
                    id: 9,
                    smallUrl: '/images/Isaac%20Mitropoulos/Portra%20400/lighthouse.jpg',
                    fullSizeUrl: '/images/Isaac%20Mitropoulos/Portra%20400/lighthouse.jpg'
                },
                recipe: {
                    slug: 'portra-400',
                    authorUuid: 'author-uuid'
                },
                repoRoot: '/repo'
            })
        ).toMatchObject({
            absolutePath: '/repo/public/images/Isaac Mitropoulos/Portra 400/lighthouse.jpg',
            objectKey: 'authors/author-uuid/recipes/portra-400/lighthouse.jpg'
        });
    });

    it('uses the legacy-backed URL when only smallUrl points at the repo image', async () => {
        const { buildMigrationPlanRow } = await import('../scripts/migrate-legacy-repo-images.mjs');

        expect(
            buildMigrationPlanRow({
                image: {
                    id: 9,
                    fullSizeUrl: 'https://images.om-recipes.com/original/authors/a/recipes/r/lighthouse.jpg',
                    smallUrl: '/images/Isaac%20Mitropoulos/Portra%20400/lighthouse.jpg'
                },
                recipe: {
                    slug: 'portra-400',
                    authorUuid: 'author-uuid'
                },
                repoRoot: '/repo'
            })
        ).toMatchObject({
            absolutePath: '/repo/public/images/Isaac Mitropoulos/Portra 400/lighthouse.jpg',
            objectKey: 'authors/author-uuid/recipes/portra-400/lighthouse.jpg'
        });
    });

    it('maps comparison labels into comparison object keys', async () => {
        const { buildMigrationPlanRow } = await import('../scripts/migrate-legacy-repo-images.mjs');

        expect(
            buildMigrationPlanRow({
                image: {
                    id: 11,
                    smallUrl: '/images/Isaac%20Mitropoulos/Portra%20400/watch%20hill.jpg'
                },
                recipe: {
                    slug: 'portra-400',
                    authorUuid: 'author-uuid'
                },
                comparisonLabel: 'Watch Hill',
                repoRoot: '/repo'
            })
        ).toMatchObject({
            absolutePath: '/repo/public/images/Isaac Mitropoulos/Portra 400/watch hill.jpg',
            objectKey: 'authors/author-uuid/recipes/portra-400/comparisons/watch-hill.jpg'
        });
    });

    it('rejects invalid or traversal-style legacy paths', async () => {
        const { buildMigrationPlanRow } = await import('../scripts/migrate-legacy-repo-images.mjs');

        expect(() =>
            buildMigrationPlanRow({
                image: {
                    id: 12,
                    smallUrl: '/images/../../etc/passwd'
                },
                recipe: {
                    slug: 'portra-400',
                    authorUuid: 'author-uuid'
                },
                repoRoot: '/repo'
            })
        ).toThrow('Refusing traversal or malformed legacy image path');

        expect(() =>
            buildMigrationPlanRow({
                image: {
                    id: 13,
                    smallUrl: '/assets/images/not-legacy.jpg'
                },
                recipe: {
                    slug: 'portra-400',
                    authorUuid: 'author-uuid'
                },
                repoRoot: '/repo'
            })
        ).toThrow('Expected a legacy repo-backed /images/ URL');
    });

    it('updates rows only when prepared_object_key is still null', async () => {
        const sql = vi.fn().mockResolvedValue([]);
        const { defaultUpdatePreparedObjectKey } = await import('../scripts/migrate-legacy-repo-images.mjs');

        await defaultUpdatePreparedObjectKey(sql, {
            imageId: 9,
            objectKey: 'authors/author-uuid/recipes/portra-400/lighthouse.jpg'
        });

        expect(sql).toHaveBeenCalledTimes(1);
        expect(sql.mock.calls[0][0].join(' ')).toContain('AND prepared_object_key IS NULL');
        expect(sql.mock.calls[0].slice(1)).toEqual([
            'authors/author-uuid/recipes/portra-400/lighthouse.jpg',
            9
        ]);
    });

    it('discovers legacy repo-backed sample and comparison image rows from the database', async () => {
        const sql = vi.fn()
            .mockResolvedValueOnce([
                {
                    image_id: 10,
                    full_size_url: '/images/Isaac%20Mitropoulos/Portra%20400/lighthouse.jpg',
                    small_url: '/images/Isaac%20Mitropoulos/Portra%20400/lighthouse.jpg',
                    prepared_object_key: null
                },
                {
                    image_id: 11,
                    full_size_url: null,
                    small_url: '/images/Isaac%20Mitropoulos/Portra%20400/watch%20hill.jpg',
                    prepared_object_key: null
                }
            ])
            .mockResolvedValueOnce([
                {
                    image_id: 11,
                    recipe_id: 3,
                    recipe_slug: 'portra-400',
                    author_uuid: 'author-uuid',
                    comparison_label: 'Watch Hill'
                }
            ])
            .mockResolvedValueOnce([
                {
                    image_id: 10,
                    recipe_id: 3,
                    recipe_slug: 'portra-400',
                    author_uuid: 'author-uuid'
                }
            ]);

        const { fetchLegacyRepoImageRows } = await import('../scripts/migrate-legacy-repo-images.mjs');
        const rows = await fetchLegacyRepoImageRows(sql);

        expect(sql).toHaveBeenCalledTimes(3);
        expect(sql.mock.calls[0][0].join(' ')).toContain('FROM images');
        expect(sql.mock.calls[0][0].join(' ')).toContain('prepared_object_key IS NULL');
        expect(sql.mock.calls[0][0].join(' ')).toContain("LIKE '/images/%'");
        expect(sql.mock.calls[1][0].join(' ')).toContain('FROM recipe_comparison_images');
        expect(sql.mock.calls[1][0].join(' ')).toContain('WHERE rci.image_id = ANY');
        expect(sql.mock.calls[2][0].join(' ')).toContain('FROM recipe_sample_images');
        expect(sql.mock.calls[2][0].join(' ')).toContain('WHERE rsi.image_id = ANY');

        expect(rows).toEqual([
            {
                image: {
                    id: 10,
                    fullSizeUrl: '/images/Isaac%20Mitropoulos/Portra%20400/lighthouse.jpg',
                    smallUrl: '/images/Isaac%20Mitropoulos/Portra%20400/lighthouse.jpg',
                    preparedObjectKey: null
                },
                recipe: {
                    id: 3,
                    slug: 'portra-400',
                    authorUuid: 'author-uuid'
                },
                comparisonLabel: null
            },
            {
                image: {
                    id: 11,
                    fullSizeUrl: null,
                    smallUrl: '/images/Isaac%20Mitropoulos/Portra%20400/watch%20hill.jpg',
                    preparedObjectKey: null
                },
                recipe: {
                    id: 3,
                    slug: 'portra-400',
                    authorUuid: 'author-uuid'
                },
                comparisonLabel: 'Watch Hill'
            }
        ]);
    });

    it('prefers the comparison association when one image is linked as both sample and comparison', async () => {
        const sql = vi.fn()
            .mockResolvedValueOnce([
                {
                    image_id: 10,
                    full_size_url: '/images/Isaac%20Mitropoulos/Portra%20400/lighthouse.jpg',
                    small_url: null,
                    prepared_object_key: null
                }
            ])
            .mockResolvedValueOnce([
                {
                    image_id: 10,
                    recipe_id: 3,
                    recipe_slug: 'portra-400',
                    author_uuid: 'author-uuid',
                    comparison_label: 'Watch Hill'
                }
            ])
            .mockResolvedValueOnce([
                {
                    image_id: 10,
                    recipe_id: 3,
                    recipe_slug: 'portra-400',
                    author_uuid: 'author-uuid'
                }
            ]);

        const { fetchLegacyRepoImageRows } = await import('../scripts/migrate-legacy-repo-images.mjs');
        const rows = await fetchLegacyRepoImageRows(sql);

        expect(rows).toEqual([
            {
                image: {
                    id: 10,
                    fullSizeUrl: '/images/Isaac%20Mitropoulos/Portra%20400/lighthouse.jpg',
                    smallUrl: null,
                    preparedObjectKey: null
                },
                recipe: {
                    id: 3,
                    slug: 'portra-400',
                    authorUuid: 'author-uuid'
                },
                comparisonLabel: 'Watch Hill'
            }
        ]);
    });

    it('throws when one image is linked to multiple comparison recipes', async () => {
        const sql = vi.fn()
            .mockResolvedValueOnce([
                {
                    image_id: 10,
                    full_size_url: '/images/Isaac%20Mitropoulos/Portra%20400/lighthouse.jpg',
                    small_url: null,
                    prepared_object_key: null
                }
            ])
            .mockResolvedValueOnce([
                {
                    image_id: 10,
                    recipe_id: 3,
                    recipe_slug: 'portra-400',
                    author_uuid: 'author-uuid',
                    comparison_label: 'Watch Hill'
                },
                {
                    image_id: 10,
                    recipe_id: 4,
                    recipe_slug: 'ektar-100',
                    author_uuid: 'author-uuid',
                    comparison_label: 'Watch Hill'
                }
            ])
            .mockResolvedValueOnce([]);

        const { fetchLegacyRepoImageRows } = await import('../scripts/migrate-legacy-repo-images.mjs');

        await expect(fetchLegacyRepoImageRows(sql)).rejects.toThrow(
            'Ambiguous comparison associations for image_id 10'
        );
    });

    it('warns and skips images with missing recipe associations while continuing', async () => {
        const sql = vi.fn()
            .mockResolvedValueOnce([
                {
                    image_id: 9,
                    full_size_url: '/images/Isaac%20Mitropoulos/Portra%20400/missing.jpg',
                    small_url: null,
                    prepared_object_key: null
                },
                {
                    image_id: 10,
                    full_size_url: '/images/Isaac%20Mitropoulos/Portra%20400/lighthouse.jpg',
                    small_url: null,
                    prepared_object_key: null
                }
            ])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([
                {
                    image_id: 10,
                    recipe_id: 3,
                    recipe_slug: 'portra-400',
                    author_uuid: 'author-uuid'
                }
            ]);
        const warn = vi.fn();

        const { fetchLegacyRepoImageRows } = await import('../scripts/migrate-legacy-repo-images.mjs');
        const rows = await fetchLegacyRepoImageRows(sql, { warn });

        expect(rows).toEqual([
            {
                image: {
                    id: 10,
                    fullSizeUrl: '/images/Isaac%20Mitropoulos/Portra%20400/lighthouse.jpg',
                    smallUrl: null,
                    preparedObjectKey: null
                },
                recipe: {
                    id: 3,
                    slug: 'portra-400',
                    authorUuid: 'author-uuid'
                },
                comparisonLabel: null
            }
        ]);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain('Missing recipe association for legacy repo image_id 9');
    });

    it('runs the migration script path by loading env, fetching candidates, migrating, and printing JSON', async () => {
        const sql = vi.fn();
        const createSql = vi.fn(() => sql);
        const fetchLegacyRepoImageRows = vi.fn().mockResolvedValue([
            {
                image: {
                    id: 10,
                    smallUrl: '/images/Isaac%20Mitropoulos/Portra%20400/lighthouse.jpg',
                    preparedObjectKey: null
                },
                recipe: { id: 3, slug: 'portra-400', authorUuid: 'author-uuid' },
                comparisonLabel: null
            }
        ]);
        const migrateLegacyRepoImages = vi.fn().mockResolvedValue({
            processed: 1,
            migrated: 1,
            skipped: 0
        });
        const log = vi.fn();
        const loadEnv = vi.fn();

        const { main } = await import('../scripts/migrate-legacy-repo-images.mjs');
        const summary = await main({
            argv: ['--dry-run'],
            env: { NETLIFY_DATABASE_URL: 'postgres://example' },
            cwd: '/repo',
            repoRoot: '/repo',
            createSql,
            fetchLegacyRepoImageRows,
            migrateLegacyRepoImages,
            loadEnv,
            log
        });

        expect(loadEnv).toHaveBeenCalledWith({ path: '/repo/.env.local' });
        expect(createSql).toHaveBeenCalledWith('postgres://example');
        expect(fetchLegacyRepoImageRows).toHaveBeenCalledWith(sql);
        expect(migrateLegacyRepoImages).toHaveBeenCalledWith({
            rows: await fetchLegacyRepoImageRows.mock.results[0].value,
            repoRoot: '/repo',
            sql,
            dryRun: true
        });
        expect(summary).toEqual({
            processed: 1,
            migrated: 1,
            skipped: 0,
            candidates: 1,
            dryRun: true
        });
        expect(JSON.parse(log.mock.calls[0][0])).toEqual(summary);
    });

    it('publishes with OCI buckets, backfills prepared_object_key, and reports a resumable summary', async () => {
        const publishManualImageAsset = vi.fn().mockResolvedValue({
            objectKey: 'authors/author-uuid/recipes/portra-400/lighthouse.jpg',
            verifiedObjects: 6
        });
        const updatePreparedObjectKey = vi.fn().mockResolvedValue({});
        const sql = vi.fn().mockResolvedValue([]);

        const { migrateLegacyRepoImages } = await import('../scripts/migrate-legacy-repo-images.mjs');
        const summary = await migrateLegacyRepoImages({
            rows: [
                {
                    image: { id: 9, preparedObjectKey: 'authors/already/set.jpg' },
                    recipe: { slug: 'skip', authorUuid: 'author-uuid' }
                },
                {
                    image: {
                        id: 10,
                        smallUrl: '/images/Isaac%20Mitropoulos/Portra%20400/lighthouse.jpg'
                    },
                    recipe: { slug: 'portra-400', authorUuid: 'author-uuid' }
                }
            ],
            repoRoot: '/repo',
            sql,
            dryRun: false,
            publishManualImageAsset,
            updatePreparedObjectKey
        });

        expect(summary).toEqual({
            processed: 2,
            migrated: 1,
            skipped: 1
        });
        expect(publishManualImageAsset).toHaveBeenCalledTimes(1);
        expect(publishManualImageAsset).toHaveBeenCalledWith({
            absolutePath: '/repo/public/images/Isaac Mitropoulos/Portra 400/lighthouse.jpg',
            objectKey: 'authors/author-uuid/recipes/portra-400/lighthouse.jpg',
            originalBucket: process.env.OCI_IMAGES_ORIGINAL_BUCKET,
            processedBucket: process.env.OCI_IMAGES_PROCESSED_BUCKET
        });
        expect(updatePreparedObjectKey).toHaveBeenCalledTimes(1);
        expect(updatePreparedObjectKey).toHaveBeenCalledWith(sql, {
            imageId: 10,
            objectKey: 'authors/author-uuid/recipes/portra-400/lighthouse.jpg'
        });
        expect(sql).not.toHaveBeenCalled();
    });

    it('skips publish and update work during dry run', async () => {
        const publishManualImageAsset = vi.fn().mockResolvedValue({});
        const updatePreparedObjectKey = vi.fn().mockResolvedValue({});
        const sql = vi.fn();

        const { migrateLegacyRepoImages } = await import('../scripts/migrate-legacy-repo-images.mjs');
        const summary = await migrateLegacyRepoImages({
            rows: [
                {
                    image: {
                        id: 10,
                        smallUrl: '/images/Isaac%20Mitropoulos/Portra%20400/lighthouse.jpg'
                    },
                    recipe: { slug: 'portra-400', authorUuid: 'author-uuid' }
                }
            ],
            repoRoot: '/repo',
            sql,
            dryRun: true,
            publishManualImageAsset,
            updatePreparedObjectKey
        });

        expect(summary).toEqual({
            processed: 1,
            migrated: 1,
            skipped: 0
        });
        expect(publishManualImageAsset).not.toHaveBeenCalled();
        expect(updatePreparedObjectKey).not.toHaveBeenCalled();
        expect(sql).not.toHaveBeenCalled();
    });

    it('skips rows that already have prepared_object_key and reports a resumable summary', async () => {
        const publishManualImageAsset = vi.fn().mockResolvedValue({
            objectKey: 'authors/author-uuid/recipes/portra-400/lighthouse.jpg',
            verifiedObjects: 6
        });
        const updatePreparedObjectKey = vi.fn().mockResolvedValue({});
        const sql = vi.fn().mockResolvedValue([]);

        const { migrateLegacyRepoImages } = await import('../scripts/migrate-legacy-repo-images.mjs');
        const summary = await migrateLegacyRepoImages({
            rows: [
                {
                    image: { id: 9, preparedObjectKey: 'authors/already/set.jpg' },
                    recipe: { slug: 'skip', authorUuid: 'author-uuid' }
                },
                {
                    image: {
                        id: 10,
                        smallUrl: '/images/Isaac%20Mitropoulos/Portra%20400/lighthouse.jpg'
                    },
                    recipe: { slug: 'portra-400', authorUuid: 'author-uuid' }
                }
            ],
            repoRoot: '/repo',
            sql,
            dryRun: false,
            publishManualImageAsset,
            updatePreparedObjectKey
        });

        expect(summary).toEqual({
            processed: 2,
            migrated: 1,
            skipped: 1
        });
    });
});
