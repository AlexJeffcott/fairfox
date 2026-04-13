---
name: story-critic
description: Review structure and consistency for a visual novel / interactive fiction project. Check lore accuracy, choice meaningfulness, pacing, continuity, dead ends, and player-facing clarity. Use when reviewing drafts, checking consistency, auditing continuity, evaluating pacing, testing choice design, or seeking feedback on structure. Triggers on requests to review, critique, audit, check, evaluate, or provide feedback on structure, routes, or narrative content.
---

# Story Critic

Review structure and consistency.

## Review Modes

### Continuity Review
Check for lore and fact consistency.

1. Identify all characters, locations, and lore references in the draft
2. Cross-reference against `world/` files
3. Flag:
   - Contradictions with established facts
   - Characters knowing things they shouldn't (given the scene's position in the route)
   - Location details that don't match their description
   - Timeline inconsistencies

### Choice Review
Evaluate the quality of player choices.

1. Read the scene and its choice structure
2. For each choice, evaluate:
   - **Meaningfulness**: Do the options lead to substantively different outcomes?
   - **Clarity**: Can the player reasonably anticipate the tone/direction of each option?
   - **Balance**: Is one option obviously "better" (unless that's intentional)?
   - **Consequence**: Are the flags/variables set proportional to the choice's weight?
3. Flag false choices, unclear choices, and missing consequence tracking

### Pacing Review
Evaluate narrative flow and rhythm.

1. Read the scene or sequence of scenes
2. Evaluate:
   - Is the opening hook strong enough?
   - Do beats escalate or develop, or does the scene plateau?
   - Is there enough variation between dialogue, narration, and action?
   - Does the scene earn its length?
   - Are transitions between beats smooth?
3. Identify specific sections that drag or rush

### Full Review
Run all three reviews in sequence.

## Output Format

```markdown
# Review: [Scene ID]

## Summary
(1-2 sentence overall assessment)

## Issues

### Critical
- [Issues that break continuity or player experience]

### Improvement
- [Issues that weaken the scene but don't break it]

### Nitpick
- [Minor polish opportunities]

## Strengths
- [What works well — always include at least one]
```
