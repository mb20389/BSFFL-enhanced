// lib/teams.js
//
// Team/manager display metadata, resolved from a league's users + rosters.

/**
 * Build a roster_id → display metadata lookup.
 *
 * @param {Array} users - /league/{id}/users
 * @param {Array} rosters - /league/{id}/rosters
 * @returns {(rosterId: string|number) => object}
 */
export function buildTeamMeta(users = [], rosters = []) {
  const byOwner = new Map((users || []).map((u) => [u.user_id, u]));
  const byRoster = new Map((rosters || []).map((r) => [String(r.roster_id), r]));

  return function teamMeta(rosterId) {
    const roster = byRoster.get(String(rosterId));
    const owner = roster ? byOwner.get(roster.owner_id) : null;

    return {
      sleeper_display_name: owner?.display_name || "Unknown",
      custom_team_name:
        owner?.metadata?.team_name || owner?.display_name || `Roster ${rosterId}`,
      manager_name:
        owner?.metadata?.team_nickname ||
        `${owner?.metadata?.first_name || ""} ${owner?.metadata?.last_name || ""}`.trim() ||
        owner?.display_name ||
        null,
      avatar: owner?.avatar ? `https://sleepercdn.com/avatars/${owner.avatar}` : null,
    };
  };
}
