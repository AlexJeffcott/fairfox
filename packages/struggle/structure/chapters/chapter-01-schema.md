# Chapter 1 Schema

The schema defines the structure. The prose file contains the actual text. The HTML engine assembles them.

---

## Opening (linear, no choices)

| ID | Content summary | Subjects |
|----|----------------|----------|
| 002 | The Corridor. Dark passage, bones underfoot, thinning. The hollow. Sleep. | observation, memory-techniques (spatial memory), probability (no information, just go) |
| 010 | Waking. Grey light. The chamber. The bracer. | observation |

After 010, the hub opens.

---

## Hub: The Cave Chamber

The reader can explore these in any order. Each block has:
- **Description**: what the reader sees
- **Interaction**: what they can do
- **Link type**: inspection (right panel, stay in place) or navigation (move to a new passage)
- **Reward**: engraving, information, or state change
- **Dependencies**: what must happen first

**From the hub, the links are:**
- "The metal on the forearm" → **inspection** (right panel — she looks at her arm)
- "The niche in the wall" → **navigation** (moves to 020)
- "The shallow place in the floor" → **navigation** (moves to 030)
- "The marks on the wall" → **navigation** (moves to 040)
- "The far end, where the air moves" → **navigation** (moves to 050)

### 011: The Bracer

| Field | Value |
|-------|-------|
| Description | The bracer on her forearm. Intricate channels and recesses. |
| Interaction | Inspect — opens in right panel. No choice. |
| Reward | None. Establishes the bracer. |
| Dependencies | None |
| Subjects | observation (close examination), memory-techniques (the bracer as external record) |

Bracer inspection is always available from any hub passage. The text changes as engravings accumulate.

### 020: The Ledge (flint, steel, tinder)

| Field | Value |
|-------|-------|
| Description | Objects in a niche. Dark stone, grey metal bar, dry fibres. Worn smooth from use. |
| Interaction | **Micro challenge.** Three options: (a) strike stone on metal, (b) arrange fibres then strike, (c) take and move on. |
| Reward | Fire engraving. Unlocks 030 and 050. Ceiling soot revealed. |
| Dependencies | None |
| Failure | Option (a): sparks die on stone. Returns to choice. Teaches that sparks need fuel. |
| Success | Option (b): fire. Light fills the chamber. Bracer surface changes — new lines appear. |
| Defer | Option (c): can carry objects but passage won't open without the engraving. Must return. |
| Subjects | empiricism (hypothesis → test → result), observation (sparks need fuel), decision-making (three options, different outcomes) |

### 030: The Basin

| Field | Value |
|-------|-------|
| Description | Shallow depression in the floor. Dry. Mineral tidemark. |
| Interaction | None before fire. After fire: water wells up. She drinks. |
| Reward | Water (narrative). Establishes the transactional rule. |
| Dependencies | 020 success (fire) |
| Subjects | empiricism (causation: fire → water), logic (if/then relationship), epistemology (the Torus responds — what does that imply?) |

### 040: The Wall Marks

| Field | Value |
|-------|-------|
| Description | Layers of scratches, handprints, tally marks, drawings. Among them, a deliberate litany. |
| Interaction | Read the litany (inspection, right panel). Optionally explore other marks. |
| Reward | First litany (Gendlin). World-building through optional marks. |
| Dependencies | None |
| Subjects | epistemology (Gendlin — wanting truth), emotional-intelligence (the handprint — another person was here), algebra (tally marks — different counting systems), memory-techniques (the wall as external memory, litanies as compressed wisdom) |

**Litany text:**
> What is true is already so.
> Saying it doesn't make it worse.
> Not saying it doesn't make it go away.
> And if it is true, I want to know.

**Optional sub-blocks — all inspection (right panel, stay at the wall):**
- 041: The tally marks (long sequence — someone counting days?)
- 042: The small handprint
- 043: A crude drawing (of what? The passage? The basin? Another room?)

The litany text also appears in the left panel (memory palace) when read.

### 050: The Passage

| Field | Value |
|-------|-------|
| Description | Opening at the far end. Air moves through it. |
| Interaction | Approach. Bracer responds — new lines in the engraving. Passage extends. |
| Reward | Access to killing challenge. |
| Dependencies | 020 success (fire engraving) |
| Subjects | stoicism (dichotomy of control — can't know what's ahead), decision-making (irreversible choice to leave), emotional-intelligence (managing fear of the unknown) |

---

## Killing Challenge: The Balance Room

Entered from 050. Linear, not a hub.

| ID | Type | Content |
|----|------|---------|
| 100 | prose | The room. Angular, high ceiling. A mechanism in the centre. |
| KC-clue | environment | The scratched equation on the wall: ⚫⚫ = ⚪ |
| KC-choice | choice | Four options (see below) |
| 110 | prose | The way opens. Bracer engraving deepens. She steps through. |
| 101 | prose | Four dark stones: beam levels, nothing happens, resets. Returns to choice. |
| 103 | prose | Three pale stones: beam tips, ceiling shifts, death. Restart chapter. |
| 102 | prose | One pale stone: beam tips left, resets. Returns to choice. |

**Choice options:**
1. Four dark stones → soft fail (returns to choice)
2. Two pale stones → success
3. One pale stone → soft fail (returns to choice)
4. Three pale stones → death (restart chapter)

**Concept taught:** Substitution and equivalence. 2 dark = 1 pale. Therefore 4 dark = 2 pale. The mechanism wants equivalence, not identity.

**Subjects:** algebra (substitution, equivalence), logic (reading the clue as a premise and applying it), decision-making (four options — one kills, two teach, one succeeds), probability (risk assessment — which option to try first)

---

## State Changes

| Event | State change |
|-------|-------------|
| Fire made | `fire_engraving = true`, 030 unlocked, 050 unlocked |
| Water drunk | Narrative only |
| Litany read | `litanies_found += gendlin` |
| Passage opened | Access to killing challenge |
| Balance solved | `chapter_1_complete = true`, balance engraving added |
| Death | Restart chapter. Death count +1 |

---

## Sketch → Prose Mapping

Each ID above (002, 010, 011, 100, etc.) corresponds to a passage in the chapter JSON. The chapter JSON contains the actual text for each ID. The HTML engine looks up IDs and assembles the reading experience.
