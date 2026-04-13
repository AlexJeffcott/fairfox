# Story Variables

## Bracer State
The bracer tracks engravings, not boolean flags. Each challenge leaves a mark. The engraving state determines:
- Which passages are open (the bracer is a key)
- What the inspection text shows (the bracer is a record)
- How far through the Torus she's been (the bracer is a map)

Current implementation uses simple flags per engraving. Future: richer pattern state.

- `fire_engraving`: earned from making fire (ENV-02)
- `balance_engraving`: earned from the balance room killing challenge

## Progress
- Current chapter
- Death count per chapter
- Overall depth through Torus (which chapter)

## Memory Palace
- Litanies found (array of IDs)
- Places visited (array of passage IDs per chapter)
- Chapter completion flags

## Key Moments
- First fire — the Torus's first transaction
- First litany — someone was here before
- First killing challenge — death as real consequence
- First bones — implied but not narrated (corridor opening)
- The wear stops — first untouched chamber (future chapter)
- First Settler encounter (late)

## Open
- Full branching structure TBD beyond chapter 1
- Whether death count affects anything narratively
- Memory-text system for cross-chapter recollection
- Bracer inspection text variants keyed to engraving state
