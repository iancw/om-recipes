## 1. OES Generation

- [x] 1.1 Add filter color / film tone / grain mapping tables to `lib/oes.js`, derived from `Comparison Images/MonoOES` sample files
- [x] 1.2 Add a `MONO` branch to `makeOESXml` that emits `FinishingMode`, `ColorCreater Mode="Off"`, and `MonochroCreater` in place of `ColorCreater2`, reusing the shared tone/WB/contrast/sharpness elements
- [x] 1.3 Add `tests/oes-mono-mapping.test.js` locking the mapping against all 18 sample-derived cases plus default/clamp edge cases

## 2. Download Route And UI

- [x] 2.1 Remove the `409` monochrome block in `app/oes/[slug]/route.js`
- [x] 2.2 Set `supportsOesDownload: true` unconditionally in `lib/recipe-data.js`
- [x] 2.3 Enable the OES download link for monochrome recipes in `components/recipe-card.jsx` and remove the "not available yet" copy
- [x] 2.4 Update `tests/oes-route.test.js` to cover a successful monochrome download instead of the removed `409`
- [x] 2.5 Update `.oes` explainer copy on `app/how-to/page.jsx` to mention Monochrome Creator settings

## 3. Verification

- [x] 3.1 Validate the mapping tables against all 18 ground-truth `.oes` files in `Comparison Images/MonoOES` (byte-exact `MonochroCreater` attributes)
- [ ] 3.2 Manually generate an `.oes` file for a real monochrome recipe with non-default contrast/sharpness/tone/white-balance values, load it into OM Workspace against the matching `.ORF`, and confirm it applies as expected (validates decision #2's element composition, which has no direct sample coverage)
- [ ] 3.3 Run the full test suite (`npm test`) once dependencies are installed in an environment with registry access
