/**
 * Effective privileges and why a role has them.
 *
 * Whether a role holds a privilege always comes from PostgreSQL's own
 * has_*_privilege functions. The explanation (owner, direct grant, PUBLIC, a
 * chain of memberships, a predefined role) is then worked out here from the
 * object's ACL and the membership graph, so the two can never disagree about
 * the answer, only about the reason.
 */
import { reachableRoles, type Reachable } from "../../core/graph";
import type {
  AccessContext,
  EffectivePrivileges,
  Membership,
  ObjectAccess,
  ObjectPrivileges,
  ObjectRef,
  PrivilegeCell,
  PrivilegeSource,
  RunQuery,
  ServerInfo,
} from "../types";
import { PG16, objectType } from "./capabilities";
import { rows } from "./catalog";
import { aclJson, objectsSql, source } from "./objects";
import { PUBLIC, bool, json, quoteLiteral, str } from "./sql";

export interface AclItem {
  grantee: string;
  grantor?: string;
  privilege: string;
  grantable: boolean;
}

/** Predefined roles that hold a privilege on every object of a type. */
export function predefinedRolesFor(type: string, privilege: string, server: ServerInfo): string[] {
  const roles: string[] = [];
  if (server.version >= 140000) {
    if (type === "table" && privilege === "SELECT") roles.push("pg_read_all_data");
    if (type === "table" && ["INSERT", "UPDATE", "DELETE"].includes(privilege)) roles.push("pg_write_all_data");
    if (type === "sequence" && ["SELECT", "USAGE"].includes(privilege)) roles.push("pg_read_all_data");
    if (type === "sequence" && ["UPDATE", "USAGE"].includes(privilege)) roles.push("pg_write_all_data");
    if (type === "schema" && privilege === "USAGE") roles.push("pg_read_all_data", "pg_write_all_data");
  }
  if (server.version >= 170000 && type === "table" && privilege === "MAINTAIN") roles.push("pg_maintain");
  return roles;
}

/**
 * The memberships that count when explaining privileges. The owner of the
 * current database is an implicit member of pg_database_owner (PostgreSQL 14+).
 */
export function effectiveMemberships(memberships: Membership[], server: ServerInfo): Membership[] {
  const owner = server.settings.databaseOwner;
  if (server.version < 140000 || !owner) return memberships;
  return [
    ...memberships,
    { role: "pg_database_owner", member: owner, options: { admin: false, inherit: true, set: false } },
  ];
}

export function reachFor(principal: string, ctx: AccessContext, server: ServerInfo): Map<string, Reachable> {
  return reachableRoles(principal, effectiveMemberships(ctx.memberships, server), {
    inherits: (m) => m.options.inherit !== false,
    settable: (m) => (server.version >= PG16 ? m.options.set !== false : true),
  });
}

export function isSuperuser(principal: string, ctx: AccessContext): boolean {
  return ctx.principals.find((p) => p.name === principal)?.attributes.superuser === true;
}

export interface ExplainInput {
  principal: string;
  /** From has_*_privilege. */
  allowed: boolean;
  privilege: string;
  acl: AclItem[];
  owner?: string;
  reach: Map<string, Reachable>;
  superuser: boolean;
  predefined: string[];
}

/** Every reason `principal` holds (or could hold, after SET ROLE) a privilege. */
export function explainPrivilege(input: ExplainInput): PrivilegeCell {
  const { principal, privilege, owner, reach } = input;
  const sources: PrivilegeSource[] = [];

  if (input.superuser) sources.push({ kind: "superuser", via: [principal] });

  for (const item of input.acl) {
    if (item.privilege !== privilege) continue;
    const isOwner = owner !== undefined && item.grantee === owner;
    if (item.grantee === PUBLIC) {
      sources.push({ kind: "public", grantee: PUBLIC, grantable: item.grantable, via: [principal] });
    } else if (item.grantee === principal) {
      sources.push({ kind: isOwner ? "owner" : "direct", grantee: principal, grantable: item.grantable, via: [principal] });
    } else {
      const r = reach.get(item.grantee);
      if (r) {
        sources.push({
          kind: isOwner ? "owner" : "inherited",
          grantee: item.grantee,
          grantable: item.grantable,
          via: r.path,
          needsSetRole: !r.inherited,
        });
      }
    }
  }

  for (const role of input.predefined) {
    const r = reach.get(role);
    if (r) sources.push({ kind: "predefined", grantee: role, via: r.path, needsSetRole: !r.inherited });
  }

  if (!input.allowed) {
    // Only switching role could help; anything else would mean has_*_privilege
    // disagrees with the ACL.
    return { allowed: false, sources: sources.filter((s) => s.needsSetRole) };
  }
  if (!sources.some((s) => !s.needsSetRole)) {
    sources.push({ kind: "unknown", note: "Granted in a way this view can't trace" });
  }
  // Most direct reason first.
  const order = ["superuser", "owner", "direct", "inherited", "predefined", "public", "unknown"];
  sources.sort((a, b) => Number(a.needsSetRole ?? false) - Number(b.needsSetRole ?? false) || order.indexOf(a.kind) - order.indexOf(b.kind));
  return { allowed: true, sources };
}

const LIMIT = 1000;

interface FactsQuery {
  type: string;
  filter: { schema?: string; object?: ObjectRef };
  /** Roles to check; all non-system roles when absent. */
  roles?: string[];
  includeSystem?: boolean;
  limit?: number;
}

/** has_*_privilege for every (role, object, privilege), plus each object's owner and ACL. */
async function privilegeFacts(run: RunQuery, server: ServerInfo, query: FactsQuery) {
  const type = objectType(server, query.type);
  const fn = source(query.type).hasPrivilege;
  const checks = type.privileges
    .map((priv, i) => `${fn}(who.oid, o.oid, ${quoteLiteral(priv.id)}) AS p${i}`)
    .join(",\n         ");
  const who = query.roles
    ? `rolname IN (${query.roles.length ? query.roles.map(quoteLiteral).join(", ") : "NULL"})`
    : query.includeSystem
      ? "true"
      : "rolname !~ '^pg_'";
  const limit = query.limit ?? LIMIT;
  const list = await rows(
    run,
    `WITH o AS (${objectsSql(server, query.type, query.filter)} ORDER BY o.schema NULLS FIRST, o.name LIMIT ${limit + 1}),
          who AS (SELECT oid, rolname FROM pg_roles WHERE ${who})
     SELECT o.schema, o.name, o.signature, o.subtype, ow.rolname AS owner, who.rolname AS role,
         ${checks},
         ${aclJson("o.acl")} AS acl
     FROM o CROSS JOIN who
     LEFT JOIN pg_roles ow ON ow.oid = o.owner
     ORDER BY o.schema NULLS FIRST, o.name, o.signature, who.rolname`
  );
  return { type, list, limit };
}

function objectKey(row: Record<string, unknown>): string {
  return JSON.stringify([row.schema ?? null, row.name, row.signature ?? null]);
}

function cellsFor(
  row: Record<string, unknown>,
  type: ReturnType<typeof objectType>,
  principal: string,
  ctx: AccessContext,
  server: ServerInfo,
  reach: Map<string, Reachable>
): Record<string, PrivilegeCell> {
  const acl = json<AclItem[]>(row.acl, []);
  const owner = str(row.owner);
  const superuser = isSuperuser(principal, ctx);
  return Object.fromEntries(
    type.privileges.map((priv, i) => [
      priv.id,
      explainPrivilege({
        principal,
        allowed: bool(row[`p${i}`]),
        privilege: priv.id,
        acl,
        owner,
        reach,
        superuser,
        predefined: predefinedRolesFor(type.id, priv.id, server),
      }),
    ])
  );
}

function refFrom(row: Record<string, unknown>, type: string): ObjectRef {
  return { type, schema: str(row.schema), name: String(row.name), signature: str(row.signature), subtype: str(row.subtype) };
}

export async function effectivePrivileges(
  run: RunQuery,
  server: ServerInfo,
  ctx: AccessContext,
  principal: string,
  typeId: string,
  schema?: string
): Promise<EffectivePrivileges> {
  const { type, list, limit } = await privilegeFacts(run, server, { type: typeId, filter: { schema }, roles: [principal] });
  const reach = reachFor(principal, ctx, server);
  const result: ObjectPrivileges[] = list.slice(0, limit).map((row) => ({
    object: refFrom(row, typeId),
    owner: str(row.owner),
    cells: cellsFor(row, type, principal, ctx, server, reach),
  }));
  return { objectType: type, rows: result, truncated: list.length > limit };
}

/** Every role's privileges on one object. */
export async function objectPrivilegesByRole(
  run: RunQuery,
  server: ServerInfo,
  ctx: AccessContext,
  object: ObjectRef,
  roles?: string[]
): Promise<Omit<ObjectAccess, "notes">> {
  const { type, list } = await privilegeFacts(run, server, { type: object.type, filter: { object }, roles, limit: 1 });
  if (!list.length) throw new Error(`${type.label} ${object.schema ? `${object.schema}.` : ""}${object.name} not found.`);
  const first = list[0];
  // Every row is the same object, one per role.
  const sameObject = list.filter((row) => objectKey(row) === objectKey(first));
  return {
    object: refFrom(first, object.type),
    objectType: type,
    owner: str(first.owner),
    rows: sameObject.map((row) => {
      const principal = String(row.role);
      return { principal, cells: cellsFor(row, type, principal, ctx, server, reachFor(principal, ctx, server)) };
    }),
  };
}
