# XHP-007 UI Review

## Scope

- Campaign wizard dashboard flow at `/campaigns`
- Draft campaign creation through browser-use
- Scheduled campaign row display with Verify API and LINE handoff metadata
- Existing desktop sidebar and mobile collapsed navigation behavior

## Evidence

- Desktop: `docs/ui-review/xhp-007/campaigns-desktop-1280-full.png`
- Mobile: `docs/ui-review/xhp-007/campaigns-mobile-390-full.png`
- Browser-use interaction screenshot: `/tmp/xhp007-ui/campaigns-scheduled-visible.png`

## Result

- Desktop layout keeps the existing sidebar/nav pattern and shows wizard plus preview/rows in a two-column layout.
- Mobile layout stacks wizard, preview, draft row, and scheduled row without text overlap or nested-card regression.
- Validation and empty/loading/error surfaces were covered by component tests and browser interaction.
