/**
 * Builds the statements for every change. Nothing here touches the database:
 * each function returns a ChangePlan that the UI shows for review first.
 */
import { sameTimestamp } from "../../core/format";
import type {
  AttributeValue,
  ChangePlan,
  DefaultGrant,
  DropOptions,
  GrantChange,
  GrantEntry,
  Membership,
  MembershipChange,
  Principal,
  PrincipalDetail,
  PrincipalDraft,
  ServerInfo,
  Session,
  SettingChange,
  Statement,
} from "../types";
import { PG16 } from "./capabilities";
import { objectClause, objectLabel, source } from "./objects";
import { encodePassword } from "./password";
import { MAX_NAME_BYTES, PUBLIC, byteLength, quoteIdent, quoteLiteral, quoteRole } from "./sql";

/** Role attribute keywords, in the order they are written. */
const FLAGS: [attribute: string, on: string, off: string][] = [
  ["login", "LOGIN", "NOLOGIN"],
  ["superuser", "SUPERUSER", "NOSUPERUSER"],
  ["createdb", "CREATEDB", "NOCREATEDB"],
  ["createrole", "CREATEROLE", "NOCREATEROLE"],
  ["inherit", "INHERIT", "NOINHERIT"],
  ["replication", "REPLICATION", "NOREPLICATION"],
  ["bypassrls", "BYPASSRLS", "NOBYPASSRLS"],
];

/** What CREATE ROLE uses when an option is left out. */
const CREATE_DEFAULTS: Record<string, AttributeValue> = {
  login: false,
  superuser: false,
  createdb: false,
  createrole: false,
  inherit: true,
  replication: false,
  bypassrls: false,
  connectionLimit: -1,
  validUntil: null,
};

const RESERVED_NAMES = ["public", "none", "current_user", "session_user", "current_role"];

export function validateName(name: string): string | undefined {
  if (!name.trim()) return "Enter a name.";
  if (name !== name.trim()) return "Remove the spaces at the start or end.";
  if (byteLength(name) > MAX_NAME_BYTES) return `Names can be at most ${MAX_NAME_BYTES} bytes long.`;
  if (RESERVED_NAMES.includes(name.toLowerCase())) return `"${name}" is reserved.`;
  if (/^pg_/i.test(name)) return 'Names starting with "pg_" are reserved for PostgreSQL.';
  return undefined;
}

function plan(title: string, statements: Statement[], warnings: string[] = [], selectAfter?: string): ChangePlan {
  return { title, statements, warnings, selectAfter };
}

const stmt = (sql: string, display?: string): Statement => (display ? { sql, display } : { sql });

function connectionLimit(value: AttributeValue): number {
  const n = Number(value ?? -1);
  return Number.isFinite(n) ? Math.max(-1, Math.trunc(n)) : -1;
}

/** VALID UNTIL clause; 'infinity' removes an expiry. */
function validUntilClause(value: AttributeValue): string {
  return `VALID UNTIL ${quoteLiteral(value ? String(value) : "infinity")}`;
}

interface PasswordClause {
  sql: string;
  display: string;
  warning?: string;
}

async function passwordClause(draft: PrincipalDraft, server: ServerInfo): Promise<PasswordClause | undefined> {
  if (draft.password.action === "remove") return { sql: "PASSWORD NULL", display: "PASSWORD NULL" };
  if (draft.password.action !== "set") return undefined;
  const encoded = await encodePassword(draft.password.value, draft.name, {
    passwordEncryption: server.settings.passwordEncryption,
    scramIterations: Number(server.settings.scramIterations) || undefined,
  });
  return {
    sql: `PASSWORD ${quoteLiteral(encoded.value)}`,
    display: encoded.encoding === "plain" ? "PASSWORD '********'" : `PASSWORD '********' /* ${encoded.encoding}, hashed locally */`,
    warning: encoded.warning,
  };
}

function optionClauses(attributes: Record<string, AttributeValue>, changed: (id: string) => boolean): string[] {
  const clauses: string[] = [];
  for (const [id, on, off] of FLAGS) {
    if (changed(id)) clauses.push(attributes[id] ? on : off);
  }
  if (changed("connectionLimit")) clauses.push(`CONNECTION LIMIT ${connectionLimit(attributes.connectionLimit)}`);
  if (changed("validUntil")) clauses.push(validUntilClause(attributes.validUntil));
  return clauses;
}

function withClause(clauses: string[], password?: PasswordClause): { sql: string; display: string } {
  const sql = [...clauses, ...(password ? [password.sql] : [])];
  const display = [...clauses, ...(password ? [password.display] : [])];
  return { sql: sql.length ? ` WITH ${sql.join(" ")}` : "", display: display.length ? ` WITH ${display.join(" ")}` : "" };
}

function commentStatement(name: string, comment: string | null): Statement {
  return stmt(`COMMENT ON ROLE ${quoteIdent(name)} IS ${comment ? quoteLiteral(comment) : "NULL"}`);
}

function powerWarnings(attributes: Record<string, AttributeValue>, changed: (id: string) => boolean): string[] {
  const warnings: string[] = [];
  if (attributes.superuser && changed("superuser")) warnings.push("Superusers bypass every permission check.");
  if (attributes.bypassrls && changed("bypassrls")) warnings.push("Row level security policies won't apply to this role.");
  if (attributes.replication && changed("replication"))
    warnings.push("Replication roles can read all data through a replication connection.");
  return warnings;
}

export async function planCreate(draft: PrincipalDraft, server: ServerInfo): Promise<ChangePlan> {
  const name = quoteIdent(draft.name);
  const password = await passwordClause(draft, server);
  const changed = (id: string) => {
    const value = draft.attributes[id] ?? CREATE_DEFAULTS[id];
    if (id === "connectionLimit") return connectionLimit(value) !== -1;
    return id in CREATE_DEFAULTS && (value ?? null) !== CREATE_DEFAULTS[id];
  };
  const options = withClause(optionClauses(draft.attributes, changed), password);
  const statements = [stmt(`CREATE ROLE ${name}${options.sql}`, `CREATE ROLE ${name}${options.display}`)];
  if (draft.comment) statements.push(commentStatement(draft.name, draft.comment));
  for (const role of draft.memberOf ?? []) statements.push(stmt(`GRANT ${quoteIdent(role)} TO ${name}`));

  const warnings = powerWarnings(draft.attributes, changed);
  if (password?.warning) warnings.push(password.warning);
  if (draft.attributes.login && draft.password.action !== "set")
    warnings.push("No password is set, so password authentication will fail for this user.");
  const kind = draft.attributes.login ? "user" : "role";
  return plan(`Create ${kind} ${draft.name}`, statements, warnings, draft.name);
}

export async function planUpdate(before: Principal, draft: PrincipalDraft, server: ServerInfo): Promise<ChangePlan> {
  const statements: Statement[] = [];
  const warnings: string[] = [];
  const renamed = draft.name !== before.name;

  if (renamed) {
    statements.push(stmt(`ALTER ROLE ${quoteIdent(before.name)} RENAME TO ${quoteIdent(draft.name)}`));
    if (before.passwordState === "md5" && draft.password.action !== "set") {
      warnings.push("Renaming clears the role's MD5 password. Set a new password to keep password logins working.");
    } else if (before.passwordState === "unknown" && draft.password.action !== "set") {
      warnings.push("If the role has an MD5 password, renaming clears it.");
    }
    if (before.name === server.currentUser) warnings.push("This is the role you are connected as.");
  }

  const changed = (id: string) => {
    const a = before.attributes[id] ?? null;
    const b = draft.attributes[id] ?? null;
    if (id === "validUntil") return !sameTimestamp(a as string | null, b as string | null);
    if (id === "connectionLimit") return connectionLimit(a) !== connectionLimit(b);
    return id in CREATE_DEFAULTS && a !== b;
  };
  const password = await passwordClause(draft, server);
  const clauses = optionClauses(draft.attributes, changed);
  if (clauses.length || password) {
    const options = withClause(clauses, password);
    const name = quoteIdent(draft.name);
    statements.push(stmt(`ALTER ROLE ${name}${options.sql}`, `ALTER ROLE ${name}${options.display}`));
  }
  if ((draft.comment ?? null) !== (before.comment ?? null)) statements.push(commentStatement(draft.name, draft.comment));

  warnings.push(...powerWarnings(draft.attributes, changed));
  if (password?.warning) warnings.push(password.warning);
  if (before.name === server.currentUser) {
    for (const id of ["superuser", "createrole", "login"]) {
      if (changed(id) && !draft.attributes[id]) warnings.push(`You are connected as ${before.name}: removing ${id.toUpperCase()} affects this session's rights.`);
    }
  }
  if (changed("login") && !draft.attributes.login && (before.sessions ?? 0) > 0) {
    warnings.push("Open sessions stay connected until they disconnect or are terminated.");
  }
  return plan(`Change ${before.name}`, statements, warnings, draft.name);
}

export function planDrop(principal: Principal, options: DropOptions, server: ServerInfo): ChangePlan {
  const name = quoteIdent(principal.name);
  const statements: Statement[] = [];
  if (options.terminateSessions) {
    statements.push(
      stmt(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = ${quoteLiteral(principal.name)} AND pid <> pg_backend_pid()`
      )
    );
  }
  if (options.reassignTo) statements.push(stmt(`REASSIGN OWNED BY ${name} TO ${quoteIdent(options.reassignTo)}`));
  if (options.dropOwned) statements.push(stmt(`DROP OWNED BY ${name}`));
  statements.push(stmt(`DROP ROLE ${name}`));

  const warnings: string[] = [];
  if (options.dropOwned && !options.reassignTo)
    warnings.push(`DROP OWNED deletes every object ${principal.name} owns in ${server.database}, with its data.`);
  if (options.dropOwned) warnings.push(`Privileges granted to ${principal.name} in ${server.database} are revoked.`);
  if (principal.name === server.currentUser) warnings.push("You can't drop the role you are connected as.");
  return plan(`Drop ${principal.name}`, statements, warnings);
}

function membershipOptions(options: Record<string, boolean>, server: ServerInfo): string {
  if (server.version < PG16) return options.admin ? " WITH ADMIN OPTION" : "";
  const parts: string[] = [];
  if (options.admin) parts.push("ADMIN TRUE");
  parts.push(`INHERIT ${options.inherit === false ? "FALSE" : "TRUE"}`);
  if (options.set === false) parts.push("SET FALSE");
  return ` WITH ${parts.join(", ")}`;
}

function grantedBy(m: Membership, server: ServerInfo): string {
  return server.version >= PG16 && m.grantor ? ` GRANTED BY ${quoteIdent(m.grantor)}` : "";
}

export function planMemberships(changes: MembershipChange[], server: ServerInfo): ChangePlan {
  const statements: Statement[] = [];
  for (const change of changes) {
    if (change.action === "add") {
      statements.push(
        stmt(`GRANT ${quoteIdent(change.role)} TO ${quoteIdent(change.member)}${membershipOptions(change.options, server)}`)
      );
    } else if (change.action === "remove") {
      const m = change.membership;
      statements.push(stmt(`REVOKE ${quoteIdent(m.role)} FROM ${quoteIdent(m.member)}${grantedBy(m, server)}`));
    } else {
      const m = change.membership;
      const role = quoteIdent(m.role);
      const member = quoteIdent(m.member);
      const by = grantedBy(m, server);
      for (const option of server.version >= PG16 ? ["admin", "inherit", "set"] : ["admin"]) {
        const before = m.options[option] ?? false;
        const after = change.options[option] ?? false;
        if (before === after) continue;
        if (after) {
          const clause = server.version >= PG16 ? `${option.toUpperCase()} TRUE` : "ADMIN OPTION";
          statements.push(stmt(`GRANT ${role} TO ${member} WITH ${clause}${by}`));
        } else {
          statements.push(stmt(`REVOKE ${option.toUpperCase()} OPTION FOR ${role} FROM ${member}${by}`));
        }
      }
    }
  }
  const titles = new Set(changes.map((c) => c.action));
  const title =
    titles.size === 1 && titles.has("add")
      ? "Add membership"
      : titles.size === 1 && titles.has("remove")
        ? "Remove membership"
        : "Change memberships";
  return plan(title, statements);
}

function privilegeList(privileges: string[], columns?: string[]): string {
  const cols = columns?.length ? ` (${columns.map(quoteIdent).join(", ")})` : "";
  return privileges.map((p) => `${p}${cols}`).join(", ");
}

export function grantStatement(change: GrantChange, server: ServerInfo): string {
  const { target } = change;
  const privileges = privilegeList(change.privileges, target.kind === "object" ? target.columns : undefined);
  const grantee = quoteRole(change.grantee);
  const action =
    change.action === "grant"
      ? (on: string) => `GRANT ${privileges} ON ${on} TO ${grantee}${change.withGrantOption ? " WITH GRANT OPTION" : ""}`
      : (on: string) => `REVOKE ${privileges} ON ${on} FROM ${grantee}${change.cascade ? " CASCADE" : ""}`;

  if (target.kind === "object") return action(objectClause(target.object));
  if (target.kind === "all-in-schema") {
    const keyword = target.objectType === "function" && server.version >= 110000 ? "ROUTINES" : source(target.objectType).allKeyword;
    if (!keyword) throw new Error(`Can't grant on all ${target.objectType} objects at once.`);
    return action(`ALL ${keyword} IN SCHEMA ${quoteIdent(target.schema)}`);
  }
  const keyword = source(target.objectType).defaultsKeyword;
  if (!keyword) throw new Error(`${target.objectType} objects have no default privileges.`);
  const inSchema = target.schema && target.objectType !== "schema" ? ` IN SCHEMA ${quoteIdent(target.schema)}` : "";
  return `ALTER DEFAULT PRIVILEGES FOR ROLE ${quoteIdent(target.owner)}${inSchema} ${action(keyword)}`;
}

export function planGrants(changes: GrantChange[], server: ServerInfo): ChangePlan {
  const statements = changes.map((c) => stmt(grantStatement(c, server)));
  const warnings: string[] = [];
  if (changes.some((c) => c.action === "grant" && c.grantee === PUBLIC))
    warnings.push("PUBLIC means every role, including roles created later.");
  if (changes.some((c) => c.action === "grant" && c.target.kind === "all-in-schema"))
    warnings.push("ALL ... IN SCHEMA only covers objects that exist now. Add default privileges for objects created later.");
  if (changes.some((c) => c.target.kind === "default"))
    warnings.push("Default privileges apply to objects the named owner creates from now on.");
  const actions = new Set(changes.map((c) => c.action));
  const title = actions.size === 1 ? (actions.has("grant") ? "Grant privileges" : "Revoke privileges") : "Change privileges";
  return plan(title, statements, warnings);
}

/** Parameters whose value is a list (GUC_LIST_INPUT), written as one literal per item. */
const LIST_PARAMETERS = new Set([
  "search_path",
  "temp_tablespaces",
  "session_preload_libraries",
  "local_preload_libraries",
  "shared_preload_libraries",
]);

export function settingValue(name: string, value: string): string {
  if (LIST_PARAMETERS.has(name.toLowerCase())) {
    const items = value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => (/^".*"$/.test(item) ? item.slice(1, -1).replace(/""/g, '"') : item));
    return items.length ? items.map(quoteLiteral).join(", ") : "''";
  }
  return quoteLiteral(value);
}

function parameterName(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_$]*(\.[A-Za-z_][A-Za-z0-9_$]*)*$/.test(name)) throw new Error(`Invalid parameter name: ${name}`);
  return name;
}

export function planSettings(principal: Principal, changes: SettingChange[], _server: ServerInfo): ChangePlan {
  const role = quoteIdent(principal.name);
  const statements = changes.map((c) => {
    const inDatabase = c.database ? ` IN DATABASE ${quoteIdent(c.database)}` : "";
    return c.action === "set"
      ? stmt(`ALTER ROLE ${role}${inDatabase} SET ${parameterName(c.name)} TO ${settingValue(c.name, c.value)}`)
      : stmt(`ALTER ROLE ${role}${inDatabase} RESET ${parameterName(c.name)}`);
  });
  return plan(`Change settings for ${principal.name}`, statements, [
    "Settings apply to sessions that start after the change.",
  ]);
}

export function planTerminateSessions(sessions: Session[], _server: ServerInfo): ChangePlan {
  const pids = sessions.map((s) => Number(s.id)).filter((pid) => Number.isInteger(pid) && pid > 0);
  return plan(
    sessions.length === 1 ? "Terminate session" : `Terminate ${pids.length} sessions`,
    [stmt(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid IN (${pids.join(", ") || "NULL"})`)],
    ["Running queries are cancelled and their transactions rolled back."]
  );
}

/** Groups grants on the same object so each object gets one GRANT. */
function groupGrants(grants: GrantEntry[]): { key: string; first: GrantEntry; privileges: string[] }[] {
  const groups = new Map<string, { key: string; first: GrantEntry; privileges: string[] }>();
  for (const g of grants) {
    const key = JSON.stringify([g.object.type, g.object.schema, g.object.name, g.object.signature, g.column ?? null, g.grantable]);
    if (!groups.has(key)) groups.set(key, { key, first: g, privileges: [] });
    groups.get(key)!.privileges.push(g.privilege);
  }
  return [...groups.values()];
}

function groupDefaults(defaults: DefaultGrant[]) {
  const groups = new Map<string, { first: DefaultGrant; privileges: string[] }>();
  for (const d of defaults) {
    const key = JSON.stringify([d.owner, d.schema ?? null, d.objectType, d.grantee, d.grantable]);
    if (!groups.has(key)) groups.set(key, { first: d, privileges: [] });
    groups.get(key)!.privileges.push(d.privilege);
  }
  return [...groups.values()];
}

/** SQL that recreates a role: attributes, comment, settings, memberships and grants. */
export function script(
  detail: PrincipalDetail,
  memberships: Membership[],
  server: ServerInfo,
  options: { name?: string } = {}
): string {
  const p = detail.principal;
  const name = options.name ?? p.name;
  const role = quoteIdent(name);
  const lines: string[] = [`-- ${p.kind === "user" ? "User" : "Role"} ${name}, from ${server.versionLabel} (${server.database})`];
  const changed = (id: string) => {
    if (id === "connectionLimit") return connectionLimit(p.attributes.connectionLimit) !== -1;
    return id in CREATE_DEFAULTS && (p.attributes[id] ?? null) !== CREATE_DEFAULTS[id];
  };
  const clauses = optionClauses(p.attributes, changed);
  lines.push(`CREATE ROLE ${role}${clauses.length ? ` WITH ${clauses.join(" ")}` : ""};`);
  if (p.attributes.login) lines.push("-- The password is not included.");
  if (p.comment) lines.push(`${commentStatement(name, p.comment).sql};`);

  for (const s of detail.settings) {
    const inDatabase = s.database ? ` IN DATABASE ${quoteIdent(s.database)}` : "";
    lines.push(`ALTER ROLE ${role}${inDatabase} SET ${s.name} TO ${settingValue(s.name, s.value)};`);
  }

  const memberOf = memberships.filter((m) => m.member === p.name);
  if (memberOf.length) {
    lines.push("", "-- Memberships");
    for (const m of memberOf) {
      lines.push(`GRANT ${quoteIdent(m.role)} TO ${role}${membershipOptions(m.options, server)};`);
    }
  }

  const members = memberships.filter((m) => m.role === p.name);
  if (members.length && !options.name) {
    lines.push("", "-- Members");
    for (const m of members) lines.push(`GRANT ${role} TO ${quoteIdent(m.member)}${membershipOptions(m.options, server)};`);
  }

  if (detail.grants.length) {
    lines.push("", `-- Privileges in ${server.database}`);
    for (const group of groupGrants(detail.grants)) {
      const change: GrantChange = {
        action: "grant",
        target: { kind: "object", object: group.first.object, columns: group.first.column ? [group.first.column] : undefined },
        privileges: group.privileges,
        grantee: name,
        withGrantOption: group.first.grantable,
      };
      lines.push(`${grantStatement(change, server)};`);
    }
  }

  const defaults = detail.defaultGrants.filter((d) => d.grantee === p.name);
  if (defaults.length) {
    lines.push("", "-- Default privileges for objects created later");
    for (const group of groupDefaults(defaults)) {
      const d = group.first;
      const change: GrantChange = {
        action: "grant",
        target: { kind: "default", objectType: d.objectType, schema: d.schema, owner: d.owner },
        privileges: group.privileges,
        grantee: name,
        withGrantOption: d.grantable,
      };
      lines.push(`${grantStatement(change, server)};`);
    }
  }

  if (detail.owned.length && !options.name) {
    lines.push("", `-- Owns ${detail.owned.length}${detail.ownedTruncated ? "+" : ""} objects in ${server.database}, for example:`);
    for (const o of detail.owned.slice(0, 10)) lines.push(`--   ${o.subtype ?? o.type} ${objectLabel(o)}`);
  }
  return lines.join("\n") + "\n";
}
