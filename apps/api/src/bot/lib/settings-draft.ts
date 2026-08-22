export interface DraftChange {
  key: string;
  from: unknown;
  to: unknown;
}

export interface SettingsDraft {
  changes: DraftChange[];
  rationale?: string;
  createdAt: number;
  /** The card's message, so it can be edited in place as rows are dropped. */
  messageId: number;
}

/** Long enough to read and think, short enough that intent is still current. */
export const DRAFT_TTL_MS = 10 * 60 * 1000;

export function isDraftExpired(draft: SettingsDraft, now: number): boolean {
  return now - draft.createdAt >= DRAFT_TTL_MS;
}

export function dropChange(draft: SettingsDraft, index: number): SettingsDraft {
  return { ...draft, changes: draft.changes.filter((_, i) => i !== index) };
}

export interface DriftedChange extends DraftChange {
  current: unknown;
}

/**
 * Finds changes whose recorded "before" no longer matches reality.
 *
 * Checked at confirm rather than at propose: between the two, the same admin
 * may have changed one of these through the menu, and applying the draft
 * blindly would silently discard that.
 *
 * Bun.deepEquals rather than JSON.stringify — object values like quietHours
 * would otherwise compare unequal on key order alone.
 */
export function detectDrift(
  draft: SettingsDraft,
  current: Record<string, unknown>,
): DriftedChange[] {
  return draft.changes
    .filter((change) => !Bun.deepEquals(change.from, current[change.key]))
    .map((change) => ({ ...change, current: current[change.key] }));
}

/** The change set that reverses an applied draft. Powers "Undo all". */
export function invert(changes: DraftChange[]): DraftChange[] {
  return changes.map((c) => ({ key: c.key, from: c.to, to: c.from }));
}
