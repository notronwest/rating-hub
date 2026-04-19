import type { AssessmentTag } from "../types/coach";

/**
 * Predefined strength/weakness tags. Single source of truth for picker UI
 * and player-profile aggregation.
 *
 * "both" kind means the tag can appear as either strength or weakness
 * depending on context.
 */
export const ASSESSMENT_TAGS: AssessmentTag[] = [
  // -- Serve --
  { id: "powerful_serve", label: "Powerful serve", kind: "strength", category: "serve" },
  { id: "consistent_serve", label: "Consistent serve", kind: "strength", category: "serve" },
  { id: "deep_serve", label: "Deep serve", kind: "strength", category: "serve" },
  { id: "weak_serve", label: "Weak serve", kind: "weakness", category: "serve" },
  { id: "inconsistent_serve", label: "Inconsistent serve", kind: "weakness", category: "serve" },
  { id: "shallow_serve", label: "Shallow serve", kind: "weakness", category: "serve" },

  // -- Return --
  { id: "strong_return", label: "Strong return", kind: "strength", category: "return" },
  { id: "deep_return", label: "Deep return", kind: "strength", category: "return" },
  { id: "weak_return", label: "Weak return", kind: "weakness", category: "return" },
  { id: "shallow_return", label: "Shallow return", kind: "weakness", category: "return" },

  // -- Third shot --
  { id: "good_third_drop", label: "Good third-shot drop", kind: "strength", category: "third" },
  { id: "effective_third_drive", label: "Effective third-shot drive", kind: "strength", category: "third" },
  { id: "weak_third_shot", label: "Weak third shot", kind: "weakness", category: "third" },
  { id: "inconsistent_third_drop", label: "Inconsistent third-shot drop", kind: "weakness", category: "third" },

  // -- Dink --
  { id: "consistent_dinks", label: "Consistent dinks", kind: "strength", category: "dink" },
  { id: "attackable_dinks", label: "Creates attackable dinks", kind: "strength", category: "dink" },
  { id: "inconsistent_dinks", label: "Inconsistent dinks", kind: "weakness", category: "dink" },
  { id: "passive_dinks", label: "Passive dinks", kind: "weakness", category: "dink" },
  { id: "pop_up_dinks", label: "Pops up dinks", kind: "weakness", category: "dink" },

  // -- Court positioning --
  { id: "good_positioning", label: "Good court positioning", kind: "strength", category: "court" },
  { id: "strong_kitchen_play", label: "Strong kitchen play", kind: "strength", category: "court" },
  { id: "holds_line", label: "Holds the line well", kind: "strength", category: "court" },
  { id: "poor_positioning", label: "Poor court positioning", kind: "weakness", category: "court" },
  { id: "stays_back", label: "Stays back too often", kind: "weakness", category: "court" },
  { id: "exposes_middle", label: "Exposes the middle", kind: "weakness", category: "court" },

  // -- Movement --
  { id: "quick_feet", label: "Quick feet", kind: "strength", category: "movement" },
  { id: "fast_to_kitchen", label: "Fast to the kitchen", kind: "strength", category: "movement" },
  { id: "good_split_step", label: "Good split step", kind: "strength", category: "movement" },
  { id: "slow_to_kitchen", label: "Slow to the kitchen", kind: "weakness", category: "movement" },
  { id: "flat_footed", label: "Flat-footed / slow recovery", kind: "weakness", category: "movement" },
  { id: "poor_partner_sync", label: "Poor sync with partner", kind: "weakness", category: "movement" },

  // -- Mentality / decisions (both) --
  { id: "patient", label: "Patient — picks right shots", kind: "strength", category: "decisions" },
  { id: "smart_shot_selection", label: "Smart shot selection", kind: "strength", category: "decisions" },
  { id: "over_aggressive", label: "Over-aggressive", kind: "weakness", category: "decisions" },
  { id: "unforced_errors", label: "Many unforced errors", kind: "weakness", category: "decisions" },
  { id: "poor_shot_selection", label: "Poor shot selection", kind: "weakness", category: "decisions" },
];

export const CATEGORY_LABELS: Record<string, string> = {
  serve: "Serve",
  return: "Return",
  third: "Third Shot",
  dink: "Dink",
  court: "Court / Kitchen",
  movement: "Movement",
  decisions: "Decisions",
};

export function getTag(id: string): AssessmentTag | undefined {
  return ASSESSMENT_TAGS.find((t) => t.id === id);
}

export function tagsByCategory(
  kind: "strength" | "weakness",
): Record<string, AssessmentTag[]> {
  const out: Record<string, AssessmentTag[]> = {};
  for (const tag of ASSESSMENT_TAGS) {
    if (tag.kind !== kind && tag.kind !== "both") continue;
    if (!out[tag.category]) out[tag.category] = [];
    out[tag.category].push(tag);
  }
  return out;
}
