/** Reads roles, memberships, grants and objects from the PostgreSQL catalogs. */
import type {
  Badge,
  DefaultGrant,
  GrantEntry,
  Membership,
  ObjectRef,
  Principal,
  PrincipalDetail,
  RunQuery,
  ServerInfo,
  Session,
  SettingEntry,
} from "../types";
import { PG16 } from "./capabilities";
import { OBJECT_TYPE_IDS, objectsSql, userSchemaFilter } from "./objects";
import { bool, num, quoteLiteral, str } from "./sql";

export async function rows(run: RunQuery, sql: string): Promise<Record<string, unknown>[]> {
  const results = await run(sql);
  return results[results.length - 1]?.rows ?? [];
}

/** Roles PostgreSQL or a cloud provider manages. */
export function isSystemRole(name: string): boolean {
  return (
    /^pg_/.test(name) ||
    /^(rds_|rdsadmin$|rdsrepladmin$|rdstopmgr$|azure_|cloudsql|alloydb)/.test(name)
  );
}

export async function loadServerInfo(run: RunQuery): Promise<ServerInfo> {
  const [row] = await rows(
    run,
    `SELECT current_setting('server_version_num') AS version_num,
       current_setting('server_version') AS version,
       current_database() AS database,
       current_user AS current_user,
       r.rolsuper AS superuser,
       r.rolcreaterole AS createrole,
       (SELECT o.rolname FROM pg_database d JOIN pg_roles o ON o.oid = d.datdba WHERE d.datname = current_database()) AS database_owner,
       current_setting('password_encryption') AS password_encryption,
       coalesce(current_setting('scram_iterations', true), '4096') AS scram_iterations,
       current_setting('standard_conforming_strings') AS standard_conforming_strings
     FROM pg_roles r WHERE r.rolname = current_user`
  );
  if (!row) throw new Error("Couldn't read the current role.");
  const superuser = bool(row.superuser);
  return {
    version: num(row.version_num) ?? 0,
    versionLabel: `PostgreSQL ${String(row.version).split(" ")[0]}`,
    database: String(row.database),
    currentUser: String(row.current_user),
    isSuperuser: superuser,
    canManagePrincipals: superuser || bool(row.createrole),
    settings: {
      passwordEncryption: str(row.password_encryption) ?? "scram-sha-256",
      scramIterations: str(row.scram_iterations) ?? "4096",
      databaseOwner: str(row.database_owner) ?? "",
      standardConformingStrings: str(row.standard_conforming_strings) ?? "on",
    },
  };
}

/** "infinity" and NULL both mean the password never expires. */
export function normalizeValidUntil(value: unknown): string | null {
  const text = str(value);
  if (!text || text === "infinity") return null;
  return text;
}

function badges(row: Record<string, unknown>, passwordState: string | undefined): Badge[] {
  const list: Badge[] = [];
  const superuser = bool(row.superuser);
  if (superuser) list.push({ label: "Superuser", tone: "danger", title: "Bypasses every permission check" });
  if (bool(row.expired)) list.push({ label: "Expired", tone: "warning", title: "The password has expired" });
  if (bool(row.login) && num(row.connection_limit) === 0)
    list.push({ label: "No connections", tone: "warning", title: "CONNECTION LIMIT 0" });
  if (bool(row.login) && passwordState === "none")
    list.push({ label: "No password", tone: "neutral", title: "Password authentication will fail" });
  if (passwordState === "md5") list.push({ label: "MD5", tone: "warning", title: "MD5 passwords are deprecated" });
  // A superuser can do all of these anyway.
  if (superuser) return list;
  if (bool(row.bypassrls)) list.push({ label: "Bypass RLS", tone: "warning", title: "Row level security doesn't apply" });
  if (bool(row.replication)) list.push({ label: "Replication", tone: "info" });
  if (bool(row.createrole)) list.push({ label: "Create role", tone: "info" });
  if (bool(row.createdb)) list.push({ label: "Create DB", tone: "info" });
  return list;
}

/** Password state per role. Only superusers can read pg_authid. */
async function passwordStates(run: RunQuery, server: ServerInfo): Promise<Map<string, string>> {
  if (!server.isSuperuser) return new Map();
  try {
    const list = await rows(
      run,
      `SELECT rolname AS name,
         CASE WHEN rolpassword IS NULL THEN 'none'
           WHEN rolpassword LIKE 'SCRAM-SHA-256$%' THEN 'scram-sha-256'
           WHEN rolpassword ~ '^md5[0-9a-f]{32}$' THEN 'md5'
           ELSE 'set' END AS password
       FROM pg_authid`
    );
    return new Map(list.map((r) => [String(r.name), String(r.password)]));
  } catch {
    return new Map();
  }
}

export async function listPrincipals(run: RunQuery, server: ServerInfo): Promise<Principal[]> {
  const [list, passwords] = await Promise.all([
    rows(
      run,
      `WITH sessions AS (SELECT usesysid, count(*) AS n FROM pg_stat_activity WHERE usesysid IS NOT NULL GROUP BY usesysid)
       SELECT r.rolname AS name, r.rolsuper AS superuser, r.rolinherit AS inherit, r.rolcreaterole AS createrole,
         r.rolcreatedb AS createdb, r.rolcanlogin AS login, r.rolreplication AS replication,
         r.rolbypassrls AS bypassrls, r.rolconnlimit AS connection_limit, r.rolvaliduntil::text AS valid_until,
         (r.rolvaliduntil IS NOT NULL AND r.rolvaliduntil < now()) AS expired,
         shobj_description(r.oid, 'pg_authid') AS comment,
         coalesce(s.n, 0) AS sessions
       FROM pg_roles r LEFT JOIN sessions s ON s.usesysid = r.oid
       ORDER BY r.rolname`
    ),
    passwordStates(run, server),
  ]);

  return list.map((row) => {
    const name = String(row.name);
    const passwordState = passwords.get(name) ?? (server.isSuperuser ? undefined : "unknown");
    return {
      id: name,
      name,
      kind: bool(row.login) ? "user" : "role",
      system: isSystemRole(name),
      attributes: {
        login: bool(row.login),
        superuser: bool(row.superuser),
        createdb: bool(row.createdb),
        createrole: bool(row.createrole),
        replication: bool(row.replication),
        bypassrls: bool(row.bypassrls),
        inherit: bool(row.inherit),
        connectionLimit: num(row.connection_limit) ?? -1,
        validUntil: normalizeValidUntil(row.valid_until),
      },
      comment: str(row.comment) ?? null,
      badges: badges(row, passwordState),
      sessions: num(row.sessions) ?? 0,
      passwordState,
    };
  });
}

export async function listMemberships(run: RunQuery, server: ServerInfo): Promise<Membership[]> {
  const options =
    server.version >= PG16
      ? "a.admin_option AS admin, a.inherit_option AS inherit, a.set_option AS set"
      : "a.admin_option AS admin, m.rolinherit AS inherit, true AS set";
  const list = await rows(
    run,
    `SELECT r.rolname AS role, m.rolname AS member, g.rolname AS grantor, ${options}
     FROM pg_auth_members a
     JOIN pg_roles r ON r.oid = a.roleid
     JOIN pg_roles m ON m.oid = a.member
     LEFT JOIN pg_roles g ON g.oid = a.grantor
     ORDER BY r.rolname, m.rolname`
  );
  return list.map((row) => ({
    role: String(row.role),
    member: String(row.member),
    grantor: str(row.grantor),
    options: { admin: bool(row.admin), inherit: bool(row.inherit), set: bool(row.set) },
  }));
}

function objectFrom(row: Record<string, unknown>, type: string): ObjectRef {
  return {
    type,
    schema: str(row.schema),
    name: String(row.name),
    signature: str(row.signature),
    subtype: str(row.subtype),
  };
}

const DEFAULTS_TYPES: Record<string, string> = { r: "table", S: "sequence", f: "function", T: "type", n: "schema" };

const OWNED_LIMIT = 500;

export async function loadDetail(run: RunQuery, server: ServerInfo, principal: Principal): Promise<PrincipalDetail> {
  const role = quoteLiteral(principal.name);
  const roleOid = `(SELECT oid FROM pg_roles WHERE rolname = ${role})`;

  // Grants: every ACL entry naming the role, except the implicit ones it has
  // as the owner.
  const grantsSql = OBJECT_TYPE_IDS.map(
    (type) => `SELECT '${type}' AS type, o.schema, o.name, o.signature, o.subtype, NULL::text AS column_name,
        a.privilege_type AS privilege, a.is_grantable AS grantable, gr.rolname AS grantor
      FROM (${objectsSql(server, type)}) o, aclexplode(o.acl) a
      LEFT JOIN pg_roles gr ON gr.oid = a.grantor
      WHERE a.grantee = ${roleOid} AND o.owner <> a.grantee`
  ).join("\nUNION ALL\n");

  const columnGrantsSql = `SELECT 'table' AS type, n.nspname AS schema, c.relname AS name, NULL::text AS signature,
      'table' AS subtype, att.attname::text AS column_name, a.privilege_type AS privilege, a.is_grantable AS grantable,
      gr.rolname AS grantor
    FROM pg_attribute att
    JOIN pg_class c ON c.oid = att.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace,
    aclexplode(att.attacl) a
    LEFT JOIN pg_roles gr ON gr.oid = a.grantor
    WHERE att.attacl IS NOT NULL AND NOT att.attisdropped AND a.grantee = ${roleOid}`;

  const ownedSql = OBJECT_TYPE_IDS.map(
    (type) => `SELECT '${type}' AS type, o.schema, o.name, o.signature, o.subtype
      FROM (${objectsSql(server, type)}) o WHERE o.owner = ${roleOid}${
        // Built-in languages and tablespaces belong to the bootstrap superuser.
        type === "database" ? "" : " AND o.oid >= 16384"
      }`
  ).join("\nUNION ALL\n");

  const [grants, columnGrants, defaults, owned, settings, sessions] = await Promise.all([
    rows(run, `SELECT * FROM (${grantsSql}) g ORDER BY type, schema NULLS FIRST, name, privilege`),
    rows(run, `${columnGrantsSql} ORDER BY 2, 3, 6, 7`),
    rows(
      run,
      `SELECT o.rolname AS owner, n.nspname AS schema, d.defaclobjtype::text AS objtype,
         coalesce(ge.rolname, 'public') AS grantee, a.privilege_type AS privilege, a.is_grantable AS grantable
       FROM pg_default_acl d
       JOIN pg_roles o ON o.oid = d.defaclrole
       LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace,
       aclexplode(d.defaclacl) a
       LEFT JOIN pg_roles ge ON ge.oid = a.grantee
       WHERE (a.grantee = ${roleOid} OR d.defaclrole = ${roleOid}) AND a.grantee <> d.defaclrole
       ORDER BY 1, 2 NULLS FIRST, 3, 4, 5`
    ),
    rows(run, `SELECT * FROM (${ownedSql}) o ORDER BY type, schema NULLS FIRST, name LIMIT ${OWNED_LIMIT + 1}`),
    rows(
      run,
      `SELECT d.datname AS database, cfg AS setting
       FROM pg_db_role_setting s
       LEFT JOIN pg_database d ON d.oid = s.setdatabase,
       unnest(s.setconfig) cfg
       WHERE s.setrole = ${roleOid}
       ORDER BY d.datname NULLS FIRST, cfg`
    ),
    rows(
      run,
      `SELECT pid, datname AS database, coalesce(client_addr::text, 'local') AS client, application_name AS application,
         state, backend_start::text AS started_at, query_start::text AS query_started_at, left(query, 1000) AS query
       FROM pg_stat_activity WHERE usesysid = ${roleOid} ORDER BY backend_start`
    ),
  ]);

  const grantEntries: GrantEntry[] = [...grants, ...columnGrants].map((row) => ({
    object: objectFrom(row, String(row.type)),
    column: str(row.column_name),
    privilege: String(row.privilege),
    grantee: principal.name,
    grantor: str(row.grantor),
    grantable: bool(row.grantable),
  }));

  const defaultGrants: DefaultGrant[] = defaults.map((row) => ({
    owner: String(row.owner),
    schema: str(row.schema),
    objectType: DEFAULTS_TYPES[String(row.objtype)] ?? String(row.objtype),
    grantee: String(row.grantee),
    privilege: String(row.privilege),
    grantable: bool(row.grantable),
  }));

  return {
    principal,
    grants: grantEntries,
    defaultGrants,
    owned: owned.slice(0, OWNED_LIMIT).map((row) => objectFrom(row, String(row.type))),
    ownedTruncated: owned.length > OWNED_LIMIT,
    settings: settings.map((row): SettingEntry => {
      const text = String(row.setting);
      const eq = text.indexOf("=");
      return { name: text.slice(0, eq), value: text.slice(eq + 1), database: str(row.database) };
    }),
    sessions: sessions.map(
      (row): Session => ({
        id: String(row.pid),
        database: str(row.database),
        client: str(row.client),
        application: str(row.application) || undefined,
        state: str(row.state),
        startedAt: str(row.started_at),
        queryStartedAt: str(row.query_started_at),
        query: str(row.query),
      })
    ),
  };
}

export async function listSchemas(run: RunQuery): Promise<string[]> {
  const list = await rows(
    run,
    `SELECT nspname AS name FROM pg_namespace WHERE ${userSchemaFilter("nspname")} ORDER BY nspname = 'public' DESC, nspname`
  );
  return list.map((r) => String(r.name));
}

export async function listObjects(run: RunQuery, server: ServerInfo, type: string, schema?: string): Promise<ObjectRef[]> {
  const list = await rows(run, `${objectsSql(server, type, { schema })} ORDER BY o.schema NULLS FIRST, o.name LIMIT 5000`);
  return list.map((row) => objectFrom(row, type));
}

export async function listColumns(run: RunQuery, table: ObjectRef): Promise<string[]> {
  const list = await rows(
    run,
    `SELECT a.attname AS name FROM pg_attribute a
     JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ${quoteLiteral(table.schema ?? "")} AND c.relname = ${quoteLiteral(table.name)}
       AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY a.attnum`
  );
  return list.map((r) => String(r.name));
}
