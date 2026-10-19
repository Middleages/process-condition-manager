# Bundled Pretendard

Unchanged original variable WOFF2 from official Pretendard **v1.3.9**,
commit `5c41199ea0024a9e0b2cb31735265056e5472d76`.

- Upstream: https://github.com/orioncactus/pretendard/tree/5c41199ea0024a9e0b2cb31735265056e5472d76
- Font: https://raw.githubusercontent.com/orioncactus/pretendard/5c41199ea0024a9e0b2cb31735265056e5472d76/packages/pretendard/dist/web/variable/woff2/PretendardVariable.woff2
- License: https://raw.githubusercontent.com/orioncactus/pretendard/5c41199ea0024a9e0b2cb31735265056e5472d76/packages/pretendard/dist/LICENSE.txt
- License terms: SIL Open Font License 1.1; original copyright and notice in `LICENSE.txt`.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| PretendardVariable.woff2 | 2057688 | `9599f12fd42fc0bce1cd50b47a0c022e108d7aa64dd0d1bb0ed44f3282d900b4` |
| LICENSE.txt | 4419 | `b04538c9abec39a3db75108cf0af0fd9c77032fe8aa2cf38345b4d250e98e38e` |

`styles.css` declares the variable face as Pretendard, normal, weights 100–900,
with `font-display: swap`. Current sans UI uses 400/500/600/700; one 2.06 MB
(1.96 MiB) file serves these weights and Korean/Latin glyphs without subsetting
or synthetic files. The full original costs more on a cold load than subsets;
it avoids derivative assets and multiple weight requests. It is fetched only
from `/fonts/pretendard/PretendardVariable.woff2` on the app origin, with no
runtime CDN or required OS font installation. Vite copies this public directory,
including the license and this provenance, to the distributed build.

Glide retains its 13px body and 600/13px headers. It renders with a readable
fallback while explicitly loading 400/600/700. After all resolve to actual
FontFace entries, its theme switches to Pretendard; the changed font string
provides fresh Glide text-measurement cache keys and triggers a redraw without
remounting the editor. A failed or empty load retains the fallback. Browser
font APIs are mocked in the focused adapter tests; real font response, usage,
and canvas behavior require browser verification.

Code, identifiers, and numeric editor roles retain the system monospace stack,
with Pretendard as the Korean fallback before generic monospace. Those Latin
monospace glyphs remain dependent on installed client fonts; uniform metrics
across operating systems are not guaranteed.

To verify downloaded bytes from the repository root:

```sh
sha256sum frontend/public/fonts/pretendard/PretendardVariable.woff2 frontend/public/fonts/pretendard/LICENSE.txt
```
