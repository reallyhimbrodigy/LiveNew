// Display-truncates a user-typed goal so it fits cleanly anywhere it renders.
// Verbose multi-clause goals (the common shape from old free-text onboarding)
// would otherwise overflow goal cards on Today, Progress, and Account.
const MAX_GOAL_LENGTH = 60;

export function truncateGoal(goal) {
  if (typeof goal !== 'string') return '';
  const trimmed = goal.trim();
  if (trimmed.length <= MAX_GOAL_LENGTH) return trimmed;
  // Cut at the last word boundary before the limit so we don't slice mid-word
  const slice = trimmed.slice(0, MAX_GOAL_LENGTH);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > 30 ? slice.slice(0, lastSpace) : slice;
  return cut.replace(/[.,;:]+$/, '') + '…';
}
