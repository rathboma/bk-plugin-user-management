import type { Membership } from "../engines/types";

/** A role reachable from a principal through memberships. */
export interface Reachable {
  role: string;
  /** Membership chain from the principal to the role, both included. */
  path: string[];
  /** Every link passes privileges on automatically. */
  inherited: boolean;
  /** The principal can switch to the role (SET ROLE). */
  settable: boolean;
  /** Number of links. */
  depth: number;
}

export interface EdgeRules {
  /** Whether a membership passes the role's privileges to the member. */
  inherits(membership: Membership): boolean;
  /** Whether the member may switch to the role. */
  settable(membership: Membership): boolean;
}

const ALWAYS: EdgeRules = { inherits: () => true, settable: () => true };

/**
 * Every role `principal` belongs to, directly or through other roles, with
 * the shortest chain. A chain counts as inherited only when every link
 * inherits; when several chains exist, an inherited one wins.
 */
export function reachableRoles(
  principal: string,
  memberships: Membership[],
  rules: EdgeRules = ALWAYS
): Map<string, Reachable> {
  const byMember = new Map<string, Membership[]>();
  for (const m of memberships) {
    if (!byMember.has(m.member)) byMember.set(m.member, []);
    byMember.get(m.member)!.push(m);
  }

  const result = new Map<string, Reachable>();
  // Two passes: first along inheriting links only, so those chains win, then
  // along every link for roles that are only reachable with SET ROLE.
  for (const inheritedOnly of [true, false]) {
    const queue: Reachable[] = [{ role: principal, path: [principal], inherited: true, settable: true, depth: 0 }];
    const seen = new Set([principal]);
    while (queue.length) {
      const current = queue.shift()!;
      for (const m of byMember.get(current.role) ?? []) {
        const inherits = current.inherited && rules.inherits(m);
        if (inheritedOnly && !inherits) continue;
        if (seen.has(m.role)) continue;
        seen.add(m.role);
        const next: Reachable = {
          role: m.role,
          path: [...current.path, m.role],
          inherited: inherits,
          settable: current.settable && rules.settable(m),
          depth: current.depth + 1,
        };
        if (!result.has(m.role) && m.role !== principal) result.set(m.role, next);
        else if (m.role !== principal) {
          const existing = result.get(m.role)!;
          if (!existing.settable && next.settable && existing.inherited === next.inherited) result.set(m.role, next);
        }
        queue.push(next);
      }
    }
  }
  return result;
}

/** Every principal that belongs to `role`, directly or through other roles. */
export function allMembers(role: string, memberships: Membership[]): Map<string, string[]> {
  const byRole = new Map<string, Membership[]>();
  for (const m of memberships) {
    if (!byRole.has(m.role)) byRole.set(m.role, []);
    byRole.get(m.role)!.push(m);
  }
  const result = new Map<string, string[]>();
  const queue: string[][] = [[role]];
  while (queue.length) {
    const path = queue.shift()!;
    for (const m of byRole.get(path[path.length - 1]) ?? []) {
      if (m.member === role || result.has(m.member)) continue;
      const next = [...path, m.member];
      result.set(m.member, next);
      queue.push(next);
    }
  }
  return result;
}

/** Whether adding `member` to `role` would create a loop. */
export function wouldCreateCycle(role: string, member: string, memberships: Membership[]): boolean {
  if (role === member) return true;
  return reachableRoles(role, memberships).has(member);
}
