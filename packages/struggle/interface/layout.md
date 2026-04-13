# Layout

## Medium

An HTML book. Prose with text-link choices. Runs in a browser but reads like a book — no game UI, no status bars, no HUD. The experience is reading.

The HTML is the vessel. It allows branching, state tracking, and death.

## Three Panels

The centre holds the story. The margins hold context.

- **Centre**: The narrative prose. Navigation links at the bottom move you to a different place.
- **Right panel**: Inspection text. Inline links in the prose let you look more closely at something — the detail appears here without replacing the passage. Transient: disappears when you move on or inspect something else. Also used for paragraph-level feedback (annotation dots).
- **Left panel**: The memory palace. What she knows and remembers. Bracer state (inspection text, not a graphic), litanies found, concepts learned, places she's been. Persistent and growing.

## Two Kinds of Link

- **Inspection** (inline) — look closely. Stay where you are. Detail in the right panel.
- **Navigation** (bottom) — go somewhere. Leave this place. Prose changes entirely.

## Mobile

The side panels collapse into slide-out overlays. Left panel accessed via hamburger toggle. Right panel slides in when an inspection link or feedback dot is tapped.

## Feedback System

Subtle dots appear in the left margin of each paragraph on hover. Clicking opens a feedback form in the right panel. Annotations capture paragraph text, passage, chapter, and full game state. Stored as JSONL on the server, retrievable via `/api/feedback`.
