---
name: narrative-draft
description: Draft prose for a visual novel / interactive fiction project. Write dialogue, narration, scene descriptions, choice text, internal monologue, item/lore descriptions, and UI text. Use when writing any in-game text, drafting scenes, composing dialogue, writing narration, creating choice options, or producing any player-facing prose. Triggers on requests to write, draft, compose, or create scenes, dialogue, narration, prose, or any in-game text content.
---

# Narrative Draft

Write player-facing prose for The Struggle — an interactive fiction project delivered as an HTML book.

## Before Drafting

Always read these before writing any scene:

1. The schema file from `structure/chapters/` — for beats, purpose, and choice structure
2. Character files from `world/characters/` — for every character in the scene
3. The location file from `world/locations/` — for the scene's setting
4. `interface/reading-experience.md` — for chapter rhythm and world rules
5. `world/reference/knowledge-bank.md` — for what the challenges teach
6. `world/lore/inspirations.md` — for mythic resonance and thematic grounding
7. Any relevant entries from `world/variables.md` — for state-dependent content
8. Any existing drafts in `drafts/` — for consistency with what's already written

If any of these don't exist yet, flag it and ask whether to create them first or proceed with assumptions.

## The Torus: World Rules

These are non-negotiable and must be observed in all prose:

- **No doors.** Openings appear. Not mechanical — not sliding, not swinging, not grinding. Simply not there, then there. Look away, look back, and it exists. The Torus doesn't perform.
- **No visible mechanisms.** Technology so advanced it looks like physics. Water seeps through stone. The bracer's surface changes. Light comes from nowhere.
- **No rust, no decay.** The structure is eternal. The dirt is human — ash, skin, soot, grease. The surfaces underneath are intact.
- **Nothing is named or labelled.** The Torus doesn't explain itself. No signs, no instructions, no tutorials.
- **Transactional.** Demonstrate capability, receive what you need. The relationship is implicit — the prose never states "this is a trade."

## Output Format

Write scenes as plain prose in markdown files stored in `drafts/`:

```
drafts/
├── chapter-NN/      # Chapter drafts
└── fragments/       # Reusable text blocks
```

### Scene Structure

```markdown
# Chapter N

---

## [Beat ID]: [Beat Title]

[Prose — sensation and environment in plain text]

*[Inner voice in italics — self-talk, reasoning, goading]*

- [Choice text as link](#target-id)
- [Choice text as link](#target-id)

---
```

### State-Dependent Content

```markdown
<!-- IF flag == value -->
[Prose for this state]
<!-- ELSE -->
[Prose for other state]
<!-- END -->
```
