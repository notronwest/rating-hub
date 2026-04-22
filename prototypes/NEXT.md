# Where we left off — resume tomorrow

## To continue this work on another machine
```bash
git pull
open prototypes/review-points-aligned.html      # pick up here — Variant E is the chosen direction
```
Then tell the next Claude session: "Continuing the Review Points work — Variant E from `prototypes/review-points-aligned.html` is the target. Build it for real under the Analyze page video."

---

## What already shipped this session

### Navigation overhaul
- New `web/src/components/GameHeader.tsx` — unified bar used by Game Stats, Analyze, and Coach Review pages.
- Session chip (← back), prev/next game arrows within session, "Game N" title, clickable player chips (Variant 2b), 3-tab toggle (Game Stats / Analyze / Review), status chip, optional drill chip for player focus.
- Old `GameWorkspaceHeader.tsx` deleted.
- `SessionDetailPage.tsx`: RLS auth bug fixed (review-status fetch now waits for auth).
- Review status: solid vs outlined "Review Started / Not Started" buttons on the session page.

### Analyze page polish
- `PlayerFocusBar` hidden.
- `TeamStatsBlock` removed from Analyze (lives on Game Stats tab only).
- Red shot-type colors replaced (drive → `#5e35b1` purple, smash → `#303f9f` indigo, speedup → `#ef6c00` deep orange, putaway → `#455a64` blue-grey) across all four files that had the palette.
- Playing shot's left border removed (background tint alone now).
- `END` tag removed from shot list (redundant — every rally ends).
- Fault-ending shot correctly gated on `is_final` (not any shot with `err`).
- "Mark insignificant" action on fault rows → writes to `game_analyses.dismissed_loss_keys`.
- Rally-click clears `activeSequenceId` (bugfix).
- In-video shot tag overlay → toggle, off by default.
- Rally loop button gone — loops always on.
- Flag → sequence promotion with ±2 / ±3 window (reuses existing sequence editor via `?sequence=<id>`).

### Visual consistency
- Rally strip: team colors `#1a73e8` / `#f59e0b`. Scores split-colored per team. Fault = red bottom stripe (inset box-shadow). Sequence/flag icon colors purple/slate (not team-matching).
- Kitchen Arrival bars: 90px fixed name width so bars start at the same x.
- Saved-sequence shots: purple left stripe + purple `▤` badge (dropped yellow bg + red bg).
- Inline shot-chain removed from Coach Review.

---

## Still to build — Review Points panel (Variant E)

Goal: ONE unified panel below the Analyze video that replaces the separate stacking of sequences, flags, faults. See [prototypes/review-points-aligned.html](review-points-aligned.html) — Variant E is the chosen layout.

**Visual summary:**
- Top: counts header (`N review points · N reviewed · N untouched`) — Option C from [prototypes/below-video-panels.html](below-video-panels.html).
- Below: filter chips `All · Needs review · ⚑ Coach · ● Auto · With drill`.
- Below: list of two-line rows:
  - Row top line: player name (prominent) + context/drill chips right-aligned.
  - Row middle line: optional coach note.
  - Row bottom line: muted `time · shot-type · rally N`.
  - Left rail: source glyph (⚑ coach flag / ● auto fault).
  - Right rail: action button (Review / Open / Restore).
- Fixed-width columns so alignment holds whether or not an item has chips.

**Data model decision pending:**
Either (a) compute a unified `review_points[]` at render time by merging `flags`, `sequences`, and fault-detected `is_final` shots; or (b) migrate to a real `review_points` table. Start with (a) — don't migrate until the UX is proven.

**Open questions to answer before coding** (user to decide tomorrow):
1. Source glyph (⚑ / ●) — keep in each row, move to filter chips only, or drop?
2. Blue left stripe for "needs review" — keep, or rely purely on chip absence?
3. FPTM — user said they don't care about it anymore; confirm we can strip FPTM display from this panel entirely. (FPTM input fields in the edit panel can stay for now unless you say otherwise.)

---

## Other open threads

- **Right-edge stripes on the shot list** — chosen Variant 3 from [prototypes/shot-indicators-v2.html](shot-indicators-v2.html) but NOT yet built. Sequences → purple right stripe; faults → red right stripe; flags stay as row icon. Do alongside the Review Points work so the shot list and the panel below share the same language.
- **Rally strip congruence** — after the shot list + Review Points use the new language, mirror the same palette onto the rally strip cards so the whole Analyze tab reads consistently.

---

## Prototypes in this folder
- `workspace-nav.html` — variants for the game header (Variant 2b was picked)
- `shot-indicators.html` — first attempt at consistent shot indicators (superseded)
- `shot-indicators-v2.html` — Variant 3 picked (red right stripe for faults)
- `below-video-panels.html` — Option C (counts header) picked
- `below-video-c-states.html` — per-type build/view/edit states (kept for reference)
- `review-points-unified.html` — the unified model essay (Variant A / B / C)
- `review-points-aligned.html` — **final direction: Variant E**
