# Maxwell Inventory — interface system

Created using the installed UI/UX Pro Max skill and its flat-design, industrial-slate and inventory-green recommendations. Its generated landing-page patterns were unsuitable for an internal inventory tool; those were not adopted. No verified stack-search match was found; use the skill's web accessibility and responsive guidance with native HTML/CSS.

## Direction
A focused stock-management workspace. Navy navigation, a light neutral canvas, white surfaces, blue primary actions and green/amber/red semantic statuses. No marketing hero, fake notifications, placeholder settings, decorative charts or unavailable printing controls.

## Rules
- System sans-serif text (no external font request); tabular numbers and monospace inventory codes.
- 4/8px spacing scale. 14px desktop body, 16px form controls. 44px minimum main controls.
- One page title and primary task action. Sidebar on desktop; accessible drawer on smaller screens.
- Four truthful current-stock metrics. Inventory value is the sum of available units at the current product value. No misleading monthly totals.
- Tables paginate at 25 rows and become labeled cards on phones. Full codes remain copyable and wrap.
- Native dialogs own their backdrop, keyboard focus and Escape behavior. Visible labels, inline persistent errors, disabled busy controls, explicit saving text.
- Camera starts only on request; manual lookup is always available. Camera streams stop when the dialog closes.
- Display a last-refreshed timestamp; do not call a static snapshot live. Keep useful data on transient refresh failures while clearly warning it may be stale.
- Server rules remain the authority. Navigation and task controls follow the actual staff role.
- No motion except brief color transitions; honor reduced motion. Visible focus and non-color status labels.
