# Project creation clarity — Chromium evidence

## Result

**PASS** on the accepted source commit
`9995aef5f2df6ab0cec4cb89f90ab72e9bdb24d4` (base
`583afefb7507f443cf6684b80afad4750fcc385a`). The production build was served only on
`127.0.0.1:15176` and every `/api/**` request was fulfilled by a deterministic Playwright
fixture.

- Captured: 2026-07-16 07:44 KST (`2026-07-15T22:44:19.640Z`)
- Playwright: 1.57.0, temporary install outside the repository
- Bundled Chromium: 143.0.7499.4
- Production `dist/index.html` SHA-256:
  `3c761c26e42bde9dc09a8aa592d48d237c5d2cdbe438e597eb39bd6e0ee81e39`
- Ephemeral assertion harness SHA-256:
  `f75992c6876975ca3d88f8126f17104ee9d98f8b87d0623455a4ac9eb08ecb37`

## Deterministic fixture

The route was opened directly at step 3 with Process `LINE-QA::PHOTO`, backbone project `17`,
14 Layer rows, 12 automatic matches, two unmatched Layers, 48 copied conditions, and 384 copied
cells. `device_type` and `project_category` were active, versioned ChoiceSets with two active
options each. The fixture handled only these contracts:

- `GET /api/processes` and `GET /api/processes/LINE-QA%3A%3APHOTO`
- `GET /api/projects/backbone-candidates` and `GET /api/projects/17`
- `POST /api/projects/backbone-preview`
- `GET /api/choice-sets/{device_type|project_category}` and their `/options` pages
- `POST /api/projects` was defined as a guarded success response but was not invoked

The browser made 31 fixture requests: 9 at 1024px, 13 at 1440px (including keyboard-driven
ChoiceSet refreshes), and 9 at 1920px. Every request returned 2xx; no unrecognized endpoint was
observed.

## Geometry observations

All values are CSS pixels measured at `scrollY = 0`.

| Viewport | Review columns | Work frame | Required panel | Create action `(x, y, w, h)` | Disabled reason `y/h` | Layer viewport / content | Body overflow |
| --- | --- | ---: | ---: | --- | --- | --- | --- |
| 1024×768 | 1 (`934`) | 976 | 934 | `62, 1111.3, 900, 36` — below fold as designed for the stacked flow | `1083.3 / 20` | `414 / 540`, internal vertical scroll | none (`1024 / 1024`) |
| 1440×900 | 2 (`894 + 420`) | 1376 | 420 | `984, 863.3, 386, 36` — fully inside initial viewport | `835.3 / 20` — inside | `414 / 540`, internal vertical scroll | none (`1440 / 1440`) |
| 1920×1080 | 2 (`958 + 420`) | 1440 | 420 | `1256, 863.3, 386, 36` — inside | `835.3 / 20` — inside | `414 / 540`, internal vertical scroll | none (`1920 / 1920`) |

The required panel remained within the approved 360–420px range. The 1920px page stopped at the
approved 1440px work frame. In every viewport, source order was verified as matching summary →
required information → Layer detail. Only the Layer detail owned an internal scrollbar; the page
retained normal vertical scrolling. Neither `documentElement` nor `body` had horizontal overflow.

## Keyboard and runtime observations

At 1440×900:

1. Activating `Process 선택` from the progress navigation moved focus to its `h2`.
2. Activating `매칭 검토 및 프로젝트 정보` moved focus back to that step's `h2`.
3. After selecting active ChoiceSet values, the required path was exactly
   `project-part-id` → `project-name` → `project-device-type` → `project-category` →
   `project-comment` → `project-create-action`.
4. The create action became enabled; the harness deliberately did not submit it.

Across all three contexts there were zero console warnings/errors, zero uncaught page errors,
zero failed static responses, and zero unexpected or failed API requests.

## Current-model review and rejected run

The first run against `ec90f9e46e6d04c6bbe9eba384e7cfc5bd1437cf` was rejected: at 1440×900
the required panel began at `y=393.3`, the disabled reason at `y=1003.3`, and the create action at
`y=1035.3`, so both primary decision elements were below the initial viewport. It also exposed
three nested identity cards inside the matching summary.

The accepted revision aligns the required panel with the review introduction, removes the repeated
body step counter, converts identity cards to one compact strip, and shortens only optional Comment
spacing/copy. Original-resolution inspection of the three accepted screenshots found no clipped
primary control, body overflow, unreadably wide input, repeated card wall, or incorrect responsive
order.

## Accepted screenshots

| File | SHA-256 |
| --- | --- |
| [`project-create-1024x768.png`](./project-create-1024x768.png) | `e96bfb6de6e290a52b1c56b83df75f1ecdef57316d4f30f86687696f521b555c` |
| [`project-create-1440x900.png`](./project-create-1440x900.png) | `e5fe74f8b03dc5176991ce0fc4ae98c2f60171503de8388fe2a4442db52a9a06` |
| [`project-create-1920x1080.png`](./project-create-1920x1080.png) | `b342342d47daed5f8166090bd124bbf80b4789b295fc62899a106d7256d07425` |

## Reproduction boundary

The checked-in `scripts/qa/phase26_browser_qa.mjs` remains the reference for loopback-only
Playwright capture. This bounded run used the same interception and assertion pattern but kept its
temporary Playwright install and one-off fixture outside the repository, as planned for this visual
slice. The evidence does not replace live-backend create/lock testing, Windows system-font visual
coverage, or the full frontend regression suite. At 1024px the create action intentionally follows
the stacked required-information section and therefore requires vertical scrolling.
