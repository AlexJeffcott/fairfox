---
name: story-architect
description: Design narrative structure for a visual novel / interactive fiction project. Plan story arcs, branching paths, choice architecture, scene sequences, route structures, and pacing. Use when outlining plot, designing branching narratives, mapping choice consequences, planning routes, structuring chapters or acts, or organizing scenes. Triggers on requests to outline, plan, structure, map, architect, or design story flow, branching, routes, or narrative arcs.
---

# Story Architect

Design the narrative structure — arcs, branches, scenes, and choice architecture — for a visual novel / interactive fiction project.

## Core Concepts

**Route**: A major narrative path determined by player choices. Each route has its own arc but shares the common world.

**Branch point**: A choice that determines which scenes follow. Can be explicit (player picks) or implicit (accumulated flags/values).

**Common route**: Shared opening before routes diverge.

**Scene**: The atomic unit of narrative. One continuous sequence in one location with a defined set of characters.

## Structure Documents

Store all structure docs in a `structure/` directory at the project root.

### Route Map (`structure/routes.md`)

```markdown
# Route Map

## Common Route
Scenes: [list]
Branch point: [choice or condition that splits routes]

## Route: [Name]
- **Theme**:
- **Central relationship**:
- **Key tension**:
- **Scenes**: [ordered list]
- **Endings**: [list with conditions]

## Route Unlock Conditions
- [Route]: requires [flags/values]
```

### Scene List (`structure/scenes/`)

One file per scene:

```markdown
# Scene: [ID] — [Title]

## Context
- **Route(s)**: (which routes include this scene)
- **Location**:
- **Characters present**:
- **Prerequisites**: (flags/values required to reach this scene)

## Purpose
(What this scene accomplishes narratively — why it exists)

## Beats
1. (opening beat)
2. (rising tension / development)
3. (key moment / choice)
4. (resolution / transition)

## Choices
- **[Choice text]** → sets [flags], leads to [scene ID]
- **[Choice text]** → sets [flags], leads to [scene ID]

## Variables Affected
- [variable]: [change]
```

### Flow Diagram

When visualizing branching, produce a Mermaid flowchart:

```markdown
graph TD
    S1[Scene 1: Opening] --> C1{Choice}
    C1 -->|Option A| S2[Scene 2a]
    C1 -->|Option B| S3[Scene 2b]
    S2 --> S4[Scene 3: Merge]
    S3 --> S4
```

## Operations

**Designing a new route**: Read `world/` for character and setting context. Create the route entry in `structure/routes.md` and individual scene files in `structure/scenes/`.

**Adding a branch point**: Identify which scene the branch occurs in. Define the choice, its consequences (flags set, relationship changes), and which scenes follow each option. Update `world/variables.md` with any new flags.

**Checking structure integrity**: Verify every scene is reachable, no dead ends exist, all referenced flags are defined in `world/variables.md`, and all referenced characters/locations exist in `world/`.

## Choice Design Principles

1. **No false choices** — every option must lead to meaningfully different content or consequences
2. **Telegraph consequences** — the player should have a reasonable sense of what they're choosing, even if surprised by specifics
3. **Accumulation matters** — small choices should build toward larger consequences via flags and relationship values
4. **Respect player intelligence** — avoid "obviously correct" options

## Model Guidance

- Use **Task tool with `model: "opus"`** for route design, thematic arc planning, and choice architecture — these require deep narrative thinking.
- Use **Task tool with `model: "sonnet"`** for structural validation, consistency checks, and scene list maintenance.
