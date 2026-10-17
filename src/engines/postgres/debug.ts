/**
 * Diagnostics: can a role do something, why can't a user log in, and what
 * stands in the way of dropping a role.
 */
import { reachableRoles } from "../../core/graph";
import { plural } from "../../core/format";
import { describeSource } from "../../core/sources";
import type {
  AccessCheckRequest,
  AccessCheckResult,
  AccessContext,
  ChangePlan,
  Check,
  DropInfo,
  ObjectAccess,
  ObjectRef,
  Principal,
  PrivilegeCell,
  RunQuery,
  ServerInfo,
} from "../types";
import { PG16, objectType } from "./capabilities";
import { rows } from "./catalog";
import { planGrants, planMemberships } from "./ddl";
import { isSchemaScoped, objectLabel } from "./objects";
import { objectPrivilegesByRole, reachFor } from "./privileges";
import { PUBLIC, bool, json, num, quoteIdent, quoteLiteral, str } from "./sql";

const RLS_COMMANDS: Record<string, string[]> = {
  SELECT: ["r", "*"],
  INSERT: ["a", "*"],
  UPDATE: ["w", "*"],
  DELETE: ["d", "*"],
};

interface Policy {
  name: string;
  cmd: string;
  permissive: boolean;
  roles: string[];
}

interface TableFacts {
  rls: boolean;
  force: boolean;
  policies: Policy[];
  columnGrants: { column: string; grantee: string; privilege: string }[];
}

async function tableFacts(run: RunQuery, object: ObjectRef): Promise<TableFacts | undefined> {
  const [row] = await rows(
    run,
    `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
       (SELECT coalesce(json_agg(json_build_object(
           'name', p.polname, 'cmd', p.polcmd::text, 'permissive', p.polpermissive,
           'roles', (SELECT coalesce(json_agg(coalesce(r.rolname, 'public')), '[]'::json)
                     FROM unnest(p.polroles) pr LEFT JOIN pg_roles r ON r.oid = pr))), '[]'::json)
        FROM pg_policy p WHERE p.polrelid = c.oid) AS policies,
       (SELECT coalesce(json_agg(json_build_object('column', att.attname, 'grantee', coalesce(ge.rolname, 'public'),
           'privilege', a.privilege_type)), '[]'::json)
        FROM pg_attribute att, aclexplode(att.attacl) a LEFT JOIN pg_roles ge ON ge.oid = a.grantee
        WHERE att.attrelid = c.oid AND att.attacl IS NOT NULL AND NOT att.attisdropped) AS column_grants
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ${quoteLiteral(object.schema ?? "")} AND c.relname = ${quoteLiteral(object.name)}`
  );
  if (!row) return undefined;
  return {
    rls: bool(row.rls),
    force: bool(row.force),
    policies: json<Policy[]>(row.policies, []),
    columnGrants: json<TableFacts["columnGrants"]>(row.column_grants, []),
  };
}

function policyApplies(policy: Policy, principal: string, roles: Set<string>, privilege: string): boolean {
  if (!RLS_COMMANDS[privilege]?.includes(policy.cmd)) return false;
  return policy.roles.some((r) => r === PUBLIC || r === principal || roles.has(r));
}

function rlsCheck(
  facts: TableFacts,
  principal: Principal | undefined,
  owner: string | undefined,
  privilege: string,
  ctx: AccessContext,
  server: ServerInfo
): Check | undefined {
  if (!facts.rls || !RLS_COMMANDS[privilege] || !principal) return undefined;
  if (principal.attributes.superuser) return { id: "rls", label: "Row level security", status: "info", detail: "Superusers bypass row level security." };
  if (principal.attributes.bypassrls)
    return { id: "rls", label: "Row level security", status: "info", detail: `${principal.name} has BYPASSRLS, so policies don't apply.` };
  const reach = reachFor(principal.name, ctx, server);
  const inherited = new Set([...reach.values()].filter((r) => r.inherited).map((r) => r.role));
  const ownsTable = owner === principal.name || (owner !== undefined && inherited.has(owner));
  if (ownsTable && !facts.force)
    return { id: "rls", label: "Row level security", status: "info", detail: "Policies don't apply to the table owner (FORCE ROW LEVEL SECURITY is off)." };
  const applicable = facts.policies.filter((p) => policyApplies(p, principal.name, inherited, privilege));
  const permissive = applicable.filter((p) => p.permissive);
  if (!permissive.length) {
    return {
      id: "rls",
      label: "Row level security",
      status: "warn",
      detail:
        privilege === "SELECT" || privilege === "UPDATE" || privilege === "DELETE"
          ? `Row level security is on and no permissive policy applies to ${principal.name} for ${privilege}, so no rows are visible.`
          : `Row level security is on and no permissive policy applies to ${principal.name} for ${privilege}, so new rows are rejected.`,
    };
  }
  return {
    id: "rls",
    label: "Row level security",
    status: "info",
    detail: `Rows are limited by ${plural(applicable.length, "policy", "policies")}: ${applicable.map((p) => p.name).join(", ")}.`,
  };
}

/** Who can access an object, plus notes about row level security and column grants. */
export async function objectAccess(run: RunQuery, server: ServerInfo, ctx: AccessContext, object: ObjectRef): Promise<ObjectAccess> {
  const access = await objectPrivilegesByRole(run, server, ctx, object);
  const notes: Check[] = [];
  if (object.type === "table") {
    const facts = await tableFacts(run, access.object);
    if (facts?.rls) {
      notes.push({
        id: "rls",
        label: "Row level security",
        status: "info",
        detail: `On${facts.force ? " (forced for the owner too)" : ""}, with ${plural(facts.policies.length, "policy", "policies")}${facts.policies.length ? `: ${facts.policies.map((p) => p.name).join(", ")}` : ". Only the owner and roles with BYPASSRLS see rows"}.`,
      });
    }
    if (facts?.columnGrants.length) {
      const byRole = new Map<string, Set<string>>();
      for (const g of facts.columnGrants) {
        if (!byRole.has(g.grantee)) byRole.set(g.grantee, new Set());
        byRole.get(g.grantee)!.add(`${g.privilege} (${g.column})`);
      }
      notes.push({
        id: "columns",
        label: "Column privileges",
        status: "info",
        detail: [...byRole.entries()].map(([role, privs]) => `${role}: ${[...privs].join(", ")}`).join("; "),
      });
    }
  }
  return { ...access, notes };
}

function summarize(principal: string, privilege: string, label: string, cell: PrivilegeCell, blocked: Check[]): string {
  if (cell.allowed && !blocked.length) return `${principal} can ${privilege} on ${label}.`;
  if (cell.allowed) return `${principal} has ${privilege} on ${label}, but ${blocked.map((c) => c.label.toLowerCase()).join(" and ")} is missing.`;
  if (cell.sources.length) return `${principal} can only ${privilege} on ${label} after SET ROLE.`;
  return `${principal} can't ${privilege} on ${label}.`;
}

export async function checkAccess(
  run: RunQuery,
  server: ServerInfo,
  ctx: AccessContext,
  request: AccessCheckRequest
): Promise<AccessCheckResult> {
  const { principal, privilege } = request;
  const type = objectType(server, request.object.type);
  const access = await objectPrivilegesByRole(run, server, ctx, request.object, [principal]);
  const object = access.object;
  const label = objectLabel(object);
  const cell = access.rows[0]?.cells[privilege] ?? { allowed: false, sources: [] };
  const role = ctx.principals.find((p) => p.name === principal);

  const checks: Check[] = [];
  const fixes: ChangePlan[] = [];
  const grantFix = (target: ObjectRef, privileges: string[]): ChangePlan => ({
    ...planGrants([{ action: "grant", target: { kind: "object", object: target }, privileges, grantee: principal }], server),
    title: `Grant ${privileges.join(", ")} on ${objectLabel(target)}`,
  });

  checks.push({
    id: "privilege",
    label: `${privilege} on ${type.label.toLowerCase()} ${label}`,
    status: cell.allowed ? "ok" : cell.sources.length ? "warn" : "fail",
    detail: cell.sources.length ? cell.sources.map(describeSource).join("\n") : `No grant gives ${principal} ${privilege}.`,
    fix: cell.allowed ? undefined : grantFix(object, [privilege]),
  });

  const [facts] = await rows(
    run,
    `SELECT has_database_privilege(${quoteLiteral(principal)}::name, current_database(), 'CONNECT') AS connect,
       ${
         isSchemaScoped(object.type)
           ? `has_schema_privilege(${quoteLiteral(principal)}::name, (SELECT oid FROM pg_namespace WHERE nspname = ${quoteLiteral(object.schema ?? "")}), 'USAGE')`
           : "true"
       } AS schema_usage`
  );

  if (isSchemaScoped(object.type) && object.schema) {
    const ok = bool(facts?.schema_usage);
    checks.push({
      id: "schema",
      label: `USAGE on schema ${object.schema}`,
      status: ok ? "ok" : "fail",
      detail: ok ? "Needed to look up anything in the schema." : `Without it ${principal} can't see objects in ${object.schema}, whatever their own privileges.`,
      fix: ok ? undefined : grantFix({ type: "schema", name: object.schema }, ["USAGE"]),
    });
  }

  const connect = bool(facts?.connect);
  checks.push({
    id: "connect",
    label: `CONNECT on database ${server.database}`,
    status: connect ? "ok" : "fail",
    detail: connect ? undefined : `${principal} can't connect to ${server.database}.`,
    fix: connect ? undefined : grantFix({ type: "database", name: server.database }, ["CONNECT"]),
  });

  if (role && !role.attributes.login) {
    checks.push({
      id: "login",
      label: "Logging in",
      status: "info",
      detail: `${principal} can't log in itself. Users get its privileges by being members of it.`,
    });
  }

  if (object.type === "table") {
    const tf = await tableFacts(run, object);
    if (tf) {
      const rls = rlsCheck(tf, role, access.owner, privilege, ctx, server);
      if (rls) checks.push(rls);
      if (!cell.allowed && ["SELECT", "INSERT", "UPDATE", "REFERENCES"].includes(privilege)) {
        const reach = reachFor(principal, ctx, server);
        const columns = tf.columnGrants
          .filter(
            (g) =>
              g.privilege === privilege && (g.grantee === principal || g.grantee === PUBLIC || reach.get(g.grantee)?.inherited)
          )
          .map((g) => g.column);
        if (columns.length) {
          checks.push({
            id: "columns",
            label: "Column privileges",
            status: "warn",
            detail: `${privilege} is granted on some columns only: ${[...new Set(columns)].join(", ")}. Queries must name just those columns.`,
          });
        }
      }
    }
  }

  // A membership without INHERIT: the privilege is there after SET ROLE.
  const setRole = cell.sources.find((s) => s.needsSetRole && s.via && s.via.length > 1);
  if (!cell.allowed && setRole?.via) {
    const viaRole = setRole.via[1];
    const membership = ctx.memberships.find((m) => m.member === principal && m.role === viaRole);
    checks.push({
      id: "set-role",
      label: "Membership doesn't inherit",
      status: "warn",
      detail: `${principal} belongs to ${viaRole} without INHERIT, so it has to run SET ROLE ${viaRole} first.`,
      fix:
        server.version >= PG16 && membership
          ? {
              ...planMemberships([{ action: "update", membership, options: { ...membership.options, inherit: true } }], server),
              title: `Let ${principal} inherit from ${viaRole}`,
            }
          : server.version < PG16 && role && !role.attributes.inherit
            ? {
                title: `Let ${principal} inherit privileges`,
                statements: [{ sql: `ALTER ROLE ${quoteIdent(principal)} INHERIT` }],
                warnings: [`${principal} will inherit from every role it belongs to, not just ${viaRole}.`],
              }
            : undefined,
    });
  }

  const blocked = checks.filter((c) => c.status === "fail" && c.id !== "privilege");
  const allowed = cell.allowed && !blocked.length;
  if (!allowed) {
    // Either let an existing membership work, or grant everything missing directly.
    const inherit = checks.find((c) => c.id === "set-role")?.fix;
    if (inherit) fixes.push(inherit);
    const grants = checks.filter((c) => c.fix && c.status !== "ok" && ["privilege", "schema", "connect"].includes(c.id));
    if (grants.length === 1) fixes.push(grants[0].fix!);
    else if (grants.length > 1) {
      fixes.push({
        title: `Grant ${grants.length} missing privileges to ${principal}`,
        statements: grants.flatMap((c) => c.fix!.statements),
        warnings: [],
      });
    }
  }
  return { allowed, summary: summarize(principal, privilege, label, cell, blocked), cell, checks, fixes };
}

interface HbaRule {
  line: number;
  type: string;
  database: string[];
  users: string[];
  address?: string;
  netmask?: string;
  method?: string;
  error?: string;
}

function hbaUserMatch(entry: string, principal: string, groups: Set<string>): boolean | "unknown" {
  if (entry === "all" || entry === principal) return true;
  if (entry.startsWith("+")) return entry.slice(1) === principal || groups.has(entry.slice(1));
  if (entry.startsWith("@")) return "unknown";
  if (entry.startsWith("/")) {
    try {
      return new RegExp(entry.slice(1)).test(principal);
    } catch {
      return "unknown";
    }
  }
  return false;
}

function describeRule(rule: HbaRule): string {
  const address = rule.address ? ` ${rule.address}${rule.netmask ? `/${rule.netmask}` : ""}` : "";
  return `${rule.type} ${rule.database.join(",")} ${rule.users.join(",")}${address} ${rule.method ?? ""}`.trim();
}

export async function diagnoseLogin(run: RunQuery, server: ServerInfo, ctx: AccessContext, principal: Principal): Promise<Check[]> {
  const name = quoteLiteral(principal.name);
  const [[role], databases] = await Promise.all([
    rows(
      run,
      `SELECT r.rolcanlogin AS login, r.rolvaliduntil::text AS valid_until,
         (r.rolvaliduntil IS NOT NULL AND r.rolvaliduntil < now()) AS expired,
         (r.rolvaliduntil IS NOT NULL AND r.rolvaliduntil <> 'infinity' AND r.rolvaliduntil < now() + interval '7 days') AS expires_soon,
         r.rolconnlimit AS connection_limit,
         (SELECT count(*) FROM pg_stat_activity a WHERE a.usesysid = r.oid) AS sessions,
         current_setting('max_connections')::int AS max_connections,
         (SELECT count(*) FROM pg_stat_activity WHERE backend_type = 'client backend') AS total_sessions
       FROM pg_roles r WHERE r.rolname = ${name}`
    ),
    rows(
      run,
      `SELECT d.datname AS name, d.datallowconn AS allow, d.datconnlimit AS connection_limit,
         has_database_privilege(${name}::name, d.oid, 'CONNECT') AS connect
       FROM pg_database d WHERE NOT d.datistemplate ORDER BY d.datname`
    ),
  ]);
  if (!role) throw new Error(`Role ${principal.name} not found.`);
  const checks: Check[] = [];
  const alterRole = (title: string, sql: string): ChangePlan => ({ title, statements: [{ sql }], warnings: [] });
  const quoted = quoteIdent(principal.name);

  const login = bool(role.login);
  checks.push({
    id: "login",
    label: "LOGIN attribute",
    status: login ? "ok" : "fail",
    detail: login ? undefined : `${principal.name} is a role without LOGIN, so it can't log in.`,
    fix: login ? undefined : alterRole(`Let ${principal.name} log in`, `ALTER ROLE ${quoted} LOGIN`),
  });

  const expired = bool(role.expired);
  const validUntil = str(role.valid_until);
  checks.push({
    id: "expiry",
    label: "Password expiry",
    status: expired ? "fail" : bool(role.expires_soon) ? "warn" : "ok",
    detail: expired
      ? `The password expired at ${validUntil}. Password logins fail; other methods (certificates, peer) still work.`
      : validUntil && validUntil !== "infinity"
        ? `Expires at ${validUntil}.`
        : "Never expires.",
    fix: expired ? alterRole(`Remove the expiry of ${principal.name}`, `ALTER ROLE ${quoted} VALID UNTIL 'infinity'`) : undefined,
  });

  const state = principal.passwordState;
  if (state === "unknown" || state === undefined) {
    checks.push({ id: "password", label: "Password", status: "unknown", detail: "Only superusers can see whether a password is set." });
  } else if (state === "none") {
    checks.push({
      id: "password",
      label: "Password",
      status: "warn",
      detail: "No password is set. Password authentication always fails; trust, peer and certificate logins can still work.",
    });
  } else {
    checks.push({
      id: "password",
      label: "Password",
      status: state === "md5" && server.version >= 180000 ? "warn" : "ok",
      detail:
        state === "md5"
          ? `Stored as MD5${server.version >= 180000 ? ", which is deprecated" : ""}. scram-sha-256 rules in pg_hba.conf reject it; set the password again to store it as SCRAM.`
          : `Stored as ${state === "set" ? "a password" : state.toUpperCase()}.`,
    });
  }

  const limit = num(role.connection_limit) ?? -1;
  const sessions = num(role.sessions) ?? 0;
  checks.push({
    id: "connections",
    label: "Connection limit",
    status: limit >= 0 && sessions >= limit ? "fail" : limit >= 0 && sessions >= limit * 0.8 ? "warn" : "ok",
    detail:
      limit < 0
        ? `No limit. ${plural(sessions, "session")} open.`
        : `${sessions} of ${limit} connections in use.${sessions >= limit ? " New connections are refused." : ""}`,
  });

  const maxConnections = num(role.max_connections) ?? 0;
  const total = num(role.total_sessions) ?? 0;
  if (maxConnections && total >= maxConnections * 0.9) {
    checks.push({
      id: "server-connections",
      label: "Server connections",
      status: total >= maxConnections ? "fail" : "warn",
      detail: `${total} of ${maxConnections} server connections (max_connections) in use.`,
    });
  }

  const allowed = databases.filter((d) => bool(d.connect) && bool(d.allow));
  const denied = databases.filter((d) => !bool(d.connect));
  checks.push({
    id: "databases",
    label: "Databases it can connect to",
    status: allowed.length ? "ok" : "fail",
    detail: allowed.length
      ? `${allowed.map((d) => String(d.name)).join(", ")}${denied.length ? `. No CONNECT on ${denied.map((d) => String(d.name)).join(", ")}.` : "."}`
      : "No CONNECT privilege on any database.",
    fix:
      !allowed.length || denied.some((d) => d.name === server.database)
        ? planGrants(
            [{ action: "grant", target: { kind: "object", object: { type: "database", name: server.database } }, privileges: ["CONNECT"], grantee: principal.name }],
            server
          )
        : undefined,
  });
  for (const d of databases.filter((d) => !bool(d.allow))) {
    checks.push({ id: `db-${d.name}`, label: `Database ${d.name}`, status: "info", detail: "Doesn't allow connections (datallowconn is off)." });
  }

  checks.push(...(await hbaChecks(run, server, ctx, principal)));
  return checks;
}

async function hbaChecks(run: RunQuery, server: ServerInfo, ctx: AccessContext, principal: Principal): Promise<Check[]> {
  let list: Record<string, unknown>[];
  try {
    list = await rows(
      run,
      `SELECT line_number AS line, type, to_json(database) AS database, to_json(user_name) AS users, address, netmask,
         auth_method AS method, error
       FROM pg_hba_file_rules ORDER BY line_number`
    );
  } catch {
    return [
      {
        id: "hba",
        label: "pg_hba.conf",
        status: "unknown",
        detail: server.isSuperuser
          ? "pg_hba_file_rules isn't available on this server."
          : "Only superusers can read pg_hba.conf rules (pg_hba_file_rules).",
      },
    ];
  }
  const rules: HbaRule[] = list.map((r) => ({
    line: num(r.line) ?? 0,
    type: String(r.type ?? ""),
    database: json<string[]>(r.database, []),
    users: json<string[]>(r.users, []),
    address: str(r.address),
    netmask: str(r.netmask),
    method: str(r.method),
    error: str(r.error),
  }));

  const checks: Check[] = [];
  for (const rule of rules.filter((r) => r.error)) {
    checks.push({ id: `hba-error-${rule.line}`, label: `pg_hba.conf line ${rule.line}`, status: "warn", detail: `Error: ${rule.error}` });
  }

  // "+group" matches any membership, inherited or not.
  const groups = new Set(reachableRoles(principal.name, ctx.memberships).keys());
  const matching = rules
    .filter((r) => !r.error)
    .map((rule) => ({ rule, match: rule.users.map((u) => hbaUserMatch(u, principal.name, groups)) }))
    .filter(({ match }) => match.some((m) => m !== false));

  if (!matching.length) {
    checks.push({
      id: "hba",
      label: "pg_hba.conf",
      status: "fail",
      detail: `No rule matches ${principal.name}, so every connection attempt is rejected.`,
    });
    return checks;
  }

  const state = principal.passwordState;
  const needsPassword = (method?: string) => ["password", "md5", "scram-sha-256"].includes(method ?? "");
  for (const { rule, match } of matching.slice(0, 8)) {
    const uncertain = !match.includes(true);
    let status: Check["status"] = "ok";
    let detail = describeRule(rule);
    if (rule.method === "reject") {
      status = "fail";
      detail += ". Rejects these connections.";
    } else if (rule.method === "trust") {
      status = "warn";
      detail += ". No password needed.";
    } else if (needsPassword(rule.method) && state === "none") {
      status = "fail";
      detail += ". Needs a password, and none is set.";
    } else if (rule.method === "scram-sha-256" && state === "md5") {
      status = "fail";
      detail += ". Needs a SCRAM password; the stored one is MD5.";
    } else if (rule.method === "peer" || rule.method === "ident") {
      status = "info";
      detail += ". The operating system user must match (or be mapped).";
    }
    if (uncertain) {
      detail += " Matches through a file (@) reference that can't be checked here.";
      if (status === "ok") status = "info";
    }
    checks.push({ id: `hba-${rule.line}`, label: `pg_hba.conf line ${rule.line}`, status, detail });
  }
  checks.push({
    id: "hba-order",
    label: "Rule order",
    status: "info",
    detail:
      "The first rule matching the connection type, database, user and address decides. pg_hba_file_rules shows the file on disk, which may not be loaded yet (SELECT pg_reload_conf()).",
  });
  return checks;
}

export async function dropInfo(run: RunQuery, server: ServerInfo, principal: Principal): Promise<DropInfo> {
  const name = quoteLiteral(principal.name);
  const [deps, owned] = await Promise.all([
    rows(
      run,
      `SELECT coalesce(d.datname, '') AS database, s.dbid = 0 AS shared, s.deptype::text AS deptype, count(*) AS n
       FROM pg_shdepend s LEFT JOIN pg_database d ON d.oid = s.dbid
       WHERE s.refclassid = 'pg_authid'::regclass AND s.refobjid = (SELECT oid FROM pg_roles WHERE rolname = ${name})
       GROUP BY 1, 2, 3 ORDER BY 1`
    ),
    rows(run, `SELECT datname AS name FROM pg_database WHERE datdba = (SELECT oid FROM pg_roles WHERE rolname = ${name})`),
  ]);

  const checks: Check[] = [];
  let ownedCount = 0;
  let privilegeCount = 0;
  const elsewhere = new Map<string, number>();
  for (const d of deps) {
    const count = num(d.n) ?? 0;
    if (bool(d.shared)) continue;
    if (d.database === server.database) {
      if (d.deptype === "o") ownedCount += count;
      else privilegeCount += count;
    } else {
      elsewhere.set(String(d.database), (elsewhere.get(String(d.database)) ?? 0) + count);
    }
  }

  if (principal.name === server.currentUser) {
    checks.push({ id: "self", label: "Current role", status: "fail", detail: "You can't drop the role you are connected as." });
  }
  if (ownedCount) {
    checks.push({
      id: "owned",
      label: "Owned objects",
      status: "warn",
      detail: `Owns ${plural(ownedCount, "object")} in ${server.database}. Reassign them to another role, or drop them.`,
    });
  }
  if (privilegeCount) {
    checks.push({
      id: "privileges",
      label: "Privileges",
      status: "warn",
      detail: `Has privileges or policies on ${plural(privilegeCount, "object")} in ${server.database}. DROP OWNED revokes them; otherwise DROP ROLE fails.`,
    });
  }
  if (owned.length) {
    checks.push({
      id: "databases",
      label: "Owned databases",
      status: "warn",
      detail: `Owns ${owned.map((d) => String(d.name)).join(", ")}. REASSIGN OWNED hands them over; otherwise DROP ROLE fails.`,
    });
  }
  for (const [database, count] of elsewhere) {
    checks.push({
      id: `db-${database}`,
      label: `Database ${database}`,
      status: "fail",
      detail: `Owns or has privileges on ${plural(count, "object")} in ${database}. Connect to ${database} and run REASSIGN OWNED BY / DROP OWNED BY there first.`,
    });
  }
  if (principal.sessions) {
    checks.push({
      id: "sessions",
      label: "Open sessions",
      status: "info",
      detail: `${plural(principal.sessions, "session")} open. They keep running after the role is dropped unless terminated.`,
    });
  }
  return {
    checks,
    ownedCount,
    sessions: principal.sessions ?? 0,
    suggested: { reassign: ownedCount > 0 || owned.length > 0, dropOwned: ownedCount > 0 || privilegeCount > 0 },
  };
}
