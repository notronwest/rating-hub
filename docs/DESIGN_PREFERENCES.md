# Design Preferences

Running notes on UI conventions for the rating hub. When a rule here
contradicts an ad-hoc styling choice in code, the code is wrong — bring it
back in line with this doc. Additions come from iterative feedback; date
entries when you add new ones.

---

## Destructive-action confirmations *(added 2026-04-22)*

**Rule.** Every "are you sure?" prompt goes through
`components/ConfirmModal.tsx` — **never** `window.confirm()` /
`window.alert()` / `window.prompt()`.

**Why.**
- Native browser dialogs look like OS chrome, which breaks the app's visual
  language mid-flow.
- They block the JS event loop; in-app modals don't.
- They can't carry rich copy, multiple paragraphs, checkboxes, or secondary
  affordances (e.g. a "don't show again" toggle later).
- Some browsers throttle or auto-dismiss native confirms in
  iframes/background tabs.
- They're unstyled on mobile PWAs.

**Implementation pattern.**
```tsx
const [show, setShow] = useState(false);
...
<button onClick={() => setShow(true)}>Delete</button>
{show && (
  <ConfirmModal
    title="Delete this sequence?"
    body="It'll be removed from the review queue."
    confirmLabel="Delete"
    onCancel={() => setShow(false)}
    onConfirm={async () => {
      await deleteIt();
      setShow(false);
    }}
  />
)}
```

Use `destructive={false}` for non-destructive confirms (accept a change,
apply a migration, etc.) to flip the primary button from red to blue.

**Do not** reach for `confirm()` "just for a second" — every one we've ever
written ends up needing richer copy within a week.

**Migration status.** The dismiss-topic confirmation in
`WmpcAnalysisPanel.tsx` and the unflag confirmation in `CoachReviewPage.tsx`
both route through `ConfirmModal`. Remaining `confirm()` calls in
`SequenceManager.tsx` / `NotesPanel.tsx` / `CoachReviewPage.tsx` (sequence
delete) should be migrated opportunistically as those flows get touched.

---

## Aligned row indicators *(added 2026-04-22)*

**Rule.** When a list shows **conditional status icons per row** (flags,
dismiss buttons, tags, etc.), reserve a **fixed-width slot** for each
possible icon so icons line up vertically across rows, regardless of
which ones apply to a given row.

**Why.** Unaligned icons — where icon X appears further right on one row
than on another because the row before it had fewer icons — is visually
noisy. The eye loses the ability to scan a single column for presence /
absence of a given indicator.

**Implementation pattern.**
- Use a flex container of equal-width `<div>` slots.
- Each slot renders either the icon button OR an empty placeholder of the
  same width.
- Keep the slot ORDER stable across all rows.
- Icon buttons themselves share size via a helper (e.g. `iconBtnStyle`).

**Example** — Analyze page shot row icon rail (`ShotSequence.tsx`):
```
[ ⊘ not-significant | ✎ note pencil | 🚩 flag ]
```
All three slots are always present. `⊘` renders only on rally-ending
fault shots, `✎` only on flagged shots, `🚩` always. The empty slots
still occupy 28px so the next shown icon on a sibling row sits in the
exact same column.

**Do not** render icons as `{cond && <Icon/>}{cond2 && <Icon/>}...` inside
a plain flex container — that's what collapses alignment across rows.

---

## Icon button sizing *(added 2026-04-22)*

All inline status-icon buttons in list rows use **22×22 px** with a 28px
slot (gives a 3px gutter on each side). Single-character glyph at 12–14
px for icons, `1px solid` border with semantic color. Full spec:
`iconBtnStyle()` in `ShotSequence.tsx` — reuse that function if you add
more slots of the same species.

---

## States for review decisions *(added 2026-04-22)*

A rally-ending fault, a flagged shot, and a saved sequence each have one
of three mutually-exclusive states per coach action:

| State | Meaning | Visual |
|---|---|---|
| Pending | Default; auto-shows in Rally Losses queue | Red (`#ef4444`) bottom stripe on rally strip; red ⊘ dismiss button in shot-row icon rail |
| Will review (🚩 flagged) | Coach wants to revisit | **Gray (`#9ca3af`) bottom stripe** (same as dismissed — the coach has committed, so the rally shouldn't keep shouting for attention); flag icon filled amber; ⊘ dismiss button hidden in icon rail (mutually exclusive) |
| Won't review (⊘ dismissed) | Coach decided it's not worth coaching | **Gray (`#9ca3af`) bottom stripe**; ⊘ icon filled gray with ✓ |

*Note — 2026-04-22 update:* flagged and dismissed both use the same gray stripe. The amber palette still flags the shot icon itself + the flag-note popover (so "has a note" reads at a glance), but the rally strip is the "what still needs attention" view, and once a fault-ending shot has been triaged either way it's no longer pending.

**Mutual exclusion is enforced in app logic**, not schema: flipping one
state silently clears the other. See `handleToggleFlag` +
`handleToggleDismissFault` in `AnalyzePage.tsx`.

---

## Amber = flag / note-to-self *(added 2026-04-22)*

The "flagged for review / note from the coach" family uses the amber palette:
- Background: `#fffbeb` / `#fef3c7`
- Border: `#fde68a`
- Text: `#92400e` / `#7a5d00`
- Flag icon: `#d97706`

When a flag has a saved note, its pencil indicator fills with that
palette — empty state uses neutral gray (`#9ca3af` text, `#e2e2e2`
border). Keeps "has note" / "no note" distinguishable at a glance.

---

## Review/Analyze label parity *(added 2026-04-22)*

Game numbering on the **Session page**, the **GameHeader** workspace
bar, and anywhere else games are listed MUST order by the `gm-N` suffix
on `session_name`, falling back to `played_at` only when the suffix is
missing. Never order by `played_at` alone — PB Vision's upload order
can invert the actual game sequence.

Helper: `extractGameIdx(session_name)` in `SessionDetailPage.tsx` and
`GameHeader.tsx` — same regex, keep them synced.
