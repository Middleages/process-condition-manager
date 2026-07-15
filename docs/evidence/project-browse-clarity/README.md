# Project Browse Clarity Browser Evidence

- Build commit: `474b1a7844abc778c6fcb12f3a95102653831515`
- Browser: Playwright 1.57 / Chromium 143.0.7499.4
- Fixture: 8 list projects, 12 detail layers, backbone projects #41 and #44

| Route | Viewport | Body overflow | Table overflow | Frame width | Layer first row bottom |
| --- | ---: | ---: | ---: | ---: | ---: |
| `/projects` | 1024x768 | 0px | 0px | 976px | n/a |
| `/projects/42` | 1024x768 | 0px | n/a | 976px | 1019.3px |
| `/projects` | 1440x900 | 0px | 0px | 1376px | n/a |
| `/projects/42` | 1440x900 | 0px | n/a | 1376px | 797.3px |
| `/projects` | 1920x1080 | 0px | 0px | 1600px | n/a |
| `/projects/42` | 1920x1080 | 0px | n/a | 1600px | 777.3px |

- Filtered list browser Back: query, search draft, both managed-choice values, and project-link focus restored.
- Native details: closed initially; Enter opened; Space closed.
- Profile edit trigger: dialog opened and focus returned without console or network failure.
- Unexpected console errors: 0.
- Failed fixture/static requests: 0.

## Original-resolution review

- Reviewed all six committed captures at their original resolution.
- The 1024px list keeps all currently visible columns inside the table wrapper; search controls,
  inactive badges, status badges, and row actions do not overlap or clip.
- The 1440px detail shows the Layer heading, header, and first row in the initial viewport. A
  temporary open-state capture also confirmed the three advanced Profile groups and disclosure
  chevron render without nested cards or clipping.
- The 1920px routes stop at the approved 1600px work frame. The remaining canvas below short list
  results is intentional and is not filled with decorative KPI surfaces.
- At 1024px the core Profile groups stack and the Layer table begins below the initial viewport;
  the above-fold Layer acceptance target applies to 1440×900.

## Deferred common-shell observation

The route-entry focus outline still follows the existing whole-`PageHeader` contract. Its visual
weight and the App Shell/PageHeader hierarchy are intentionally owned by the next common-shell
clarity slice rather than changed locally on these two routes.
