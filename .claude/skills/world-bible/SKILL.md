---
name: world-bible
description: Create, update, and query the canonical world bible for a visual novel / interactive fiction project. Manages characters, locations, factions, lore, timeline, and variable/flag definitions in the world/ directory. Use when building or updating world elements, adding characters, defining locations, establishing lore, tracking story variables, or when any other skill needs to look up canonical project details. Triggers on requests to create characters, define locations, build lore, establish timeline, add world elements, or manage story flags/variables.
---

# World Bible

Maintain the canonical source of truth for the project in the `world/` directory at the project root.

## Directory Structure

```
world/
├── characters/       # One file per character
├── locations/        # One file per location
├── factions/         # One file per faction or group
├── lore/             # Thematic lore documents
├── timeline/         # Chronological event records
├── variables.md      # Story flags, relationship values, state tracking
└── glossary.md       # Terms, naming conventions, shorthand
```

## Character Files

Use this template for `world/characters/<name>.md`:

```markdown
# Character Name

## Core
- **Role**: (protagonist / antagonist / supporting / minor)
- **Age**:
- **Occupation**:
- **First appearance**: (scene/chapter reference)

## Personality
- **Defining traits**: (3-5 key traits)
- **Motivation**:
- **Fear/weakness**:
- **Speech pattern**: (formal/casual, verbal tics, vocabulary level, sentence rhythm)

## Relationships
- **[Other Character]**: (nature of relationship, dynamic, tension)

## Arc
- **Starting state**:
- **Key turning points**:
- **Potential endings**: (list by branch/route if applicable)

## Voice Notes
Specific guidance for writing this character's dialogue. Include example lines that capture their voice.
```

## Location Files

Use this template for `world/locations/<name>.md`:

```markdown
# Location Name

## Description
(Sensory details: what you see, hear, smell, feel)

## Significance
(Why this place matters to the story)

## Scenes Set Here
- (list of scenes/chapters that take place here)

## Connected Locations
- (adjacency, travel routes)
```

## Variables & Flags

Track all story state in `world/variables.md`:

```markdown
# Story Variables

## Relationship Values
- `rel_character_name`: Range 0-100, default 50. Affected by: [list choices]

## Story Flags
- `flag_name`: boolean. Set when: [condition]. Checked by: [scenes]

## Route Locks
- `route_name_available`: Requires [conditions]
```

## Operations

**Creating new entries**: Write the file using the appropriate template. Fill every section — leave nothing as TODO or TBD. If information is unknown, state what needs to be decided.

**Updating entries**: Read the existing file first. Make targeted edits. Never overwrite sections with less information than they had before.

**Querying**: When other skills need world information, read the relevant files from `world/`. For broad queries, use Grep to search across the world directory.

## Model Guidance

- Use the **Task tool with `model: "opus"`** when creating or substantially expanding characters, lore, or world systems — these require deep creative thinking.
- Use the **Task tool with `model: "haiku"`** for quick lookups, consistency checks, or simple queries against existing world files.
