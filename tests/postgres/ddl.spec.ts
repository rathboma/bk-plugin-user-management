import { describe, expect, it } from "vitest";
import {
  grantStatement,
  planCreate,
  planDrop,
  planMemberships,
  planTerminateSessions,
  planUpdate,
  script,
  settingValue,
  validateName,
} from "../../src/engines/postgres/ddl";
import { quoteIdent, quoteLiteral, quoteRole } from "../../src/engines/postgres/sql";
import type { Membership, Principal, PrincipalDraft, ServerInfo } from "../../src/engines/types";

const server = (version = 170000, settings: Record<string, string> = {}): ServerInfo => ({
  version,
  versionLabel: "PostgreSQL",
  database: "app",
  currentUser: "admin",
  isSuperuser: true,
  canManagePrincipals: true,
  settings: { passwordEncryption: "scram-sha-256", scramIterations: "4096", databaseOwner: "admin", ...settings },
});

const principal = (name: string, attributes: Partial<Principal["attributes"]> = {}, extra: Partial<Principal> = {}): Principal => ({
  id: name,
  name,
  kind: attributes.login ? "user" : "role",
  system: false,
  attributes: {
    login: false,
    superuser: false,
    createdb: false,
    createrole: false,
    replication: false,
    bypassrls: false,
    inherit: true,
    connectionLimit: -1,
    validUntil: null,
    ...attributes,
  },
  comment: null,
  badges: [],
  sessions: 0,
  passwordState: "scram-sha-256",
  ...extra,
});

const draftFrom = (p: Principal, changes: Partial<PrincipalDraft> = {}): PrincipalDraft => ({
  name: p.name,
  kind: p.kind,
  attributes: { ...p.attributes },
  comment: p.comment,
  password: { action: "keep" },
  ...changes,
});

describe("quoting", () => {
  it("quotes identifiers only when needed", () => {
    expect(quoteIdent("alice")).toBe("alice");
    expect(quoteIdent("app_user$1")).toBe("app_user$1");
    expect(quoteIdent("Alice")).toBe('"Alice"');
    expect(quoteIdent("user")).toBe('"user"');
    expect(quoteIdent("1st")).toBe('"1st"');
    expect(quoteIdent('say "hi"')).toBe('"say ""hi"""');
    expect(quoteIdent("data-team")).toBe('"data-team"');
  });

  it("writes PUBLIC for the public grantee", () => {
    expect(quoteRole("public")).toBe("PUBLIC");
    expect(quoteRole("PUBLIC")).toBe('"PUBLIC"');
  });

  it("quotes literals, with E'' for backslashes", () => {
    expect(quoteLiteral("it's")).toBe("'it''s'");
    expect(quoteLiteral("C:\\temp")).toBe("E'C:\\\\temp'");
    expect(quoteLiteral("a\\'b")).toBe("E'a\\\\''b'");
  });
});

describe("validateName", () => {
  it("rejects names PostgreSQL would reject or truncate", () => {
    expect(validateName("")).toMatch(/Enter/);
    expect(validateName(" bob")).toMatch(/spaces/);
    expect(validateName("public")).toMatch(/reserved/);
    expect(validateName("pg_mine")).toMatch(/pg_/);
    expect(validateName("x".repeat(64))).toMatch(/63 bytes/);
    expect(validateName("é".repeat(32))).toMatch(/63 bytes/);
    expect(validateName("Mixed Case-OK")).toBeUndefined();
  });
});

describe("planCreate", () => {
  it("only writes options that differ from CREATE ROLE's defaults", async () => {
    const plan = await planCreate(
      { name: "readers", kind: "role", attributes: { login: false, inherit: true, connectionLimit: -1 }, comment: null, password: { action: "keep" } },
      server()
    );
    expect(plan.statements.map((s) => s.sql)).toEqual(["CREATE ROLE readers"]);
    expect(plan.selectAfter).toBe("readers");
  });

  it("hashes the password and masks it for display", async () => {
    const plan = await planCreate(
      {
        name: "Alice",
        kind: "user",
        attributes: { login: true, createdb: true, connectionLimit: 3, validUntil: "2030-01-01T00:00:00.000Z" },
        comment: "Data team",
        password: { action: "set", value: "hunter2" },
        memberOf: ["readers", "Data Team"],
      },
      server()
    );
    const [create, comment, ...grants] = plan.statements;
    expect(create.sql).toMatch(
      /^CREATE ROLE "Alice" WITH LOGIN CREATEDB CONNECTION LIMIT 3 VALID UNTIL '2030-01-01T00:00:00.000Z' PASSWORD 'SCRAM-SHA-256\$4096:[^']+'$/
    );
    expect(create.sql).not.toContain("hunter2");
    expect(create.display).toContain("PASSWORD '********' /* scram-sha-256, hashed locally */");
    expect(comment.sql).toBe(`COMMENT ON ROLE "Alice" IS 'Data team'`);
    expect(grants.map((s) => s.sql)).toEqual(['GRANT readers TO "Alice"', 'GRANT "Data Team" TO "Alice"']);
    expect(plan.warnings).toEqual([]);
  });

  it("uses MD5 when the server is set to it", async () => {
    const plan = await planCreate(
      { name: "bob", kind: "user", attributes: { login: true }, comment: null, password: { action: "set", value: "pw" } },
      server(120000, { passwordEncryption: "md5" })
    );
    expect(plan.statements[0].sql).toMatch(/PASSWORD 'md5[0-9a-f]{32}'$/);
  });

  it("warns about powerful attributes and missing passwords", async () => {
    const plan = await planCreate(
      { name: "boss", kind: "user", attributes: { login: true, superuser: true, bypassrls: true }, comment: null, password: { action: "keep" } },
      server()
    );
    expect(plan.statements[0].sql).toBe("CREATE ROLE boss WITH LOGIN SUPERUSER BYPASSRLS");
    expect(plan.warnings.join(" ")).toMatch(/bypass every permission check.*Row level security.*No password/s);
  });
});

describe("planUpdate", () => {
  it("does nothing when nothing changed", async () => {
    const p = principal("alice", { login: true, validUntil: "2030-01-01 00:00:00+00" });
    const plan = await planUpdate(p, draftFrom(p, { attributes: { ...p.attributes, validUntil: "2030-01-01T00:00:00.000Z" } }), server());
    expect(plan.statements).toEqual([]);
  });

  it("renames first, then changes attributes under the new name", async () => {
    const p = principal("alice", { login: true, validUntil: "2030-01-01 00:00:00+00" }, { passwordState: "md5" });
    const plan = await planUpdate(
      p,
      draftFrom(p, {
        name: "alice2",
        attributes: { ...p.attributes, createrole: true, connectionLimit: 0, validUntil: null },
        comment: "renamed",
      }),
      server()
    );
    expect(plan.statements.map((s) => s.sql)).toEqual([
      "ALTER ROLE alice RENAME TO alice2",
      "ALTER ROLE alice2 WITH CREATEROLE CONNECTION LIMIT 0 VALID UNTIL 'infinity'",
      "COMMENT ON ROLE alice2 IS 'renamed'",
    ]);
    expect(plan.warnings[0]).toMatch(/clears the role's MD5 password/);
    expect(plan.selectAfter).toBe("alice2");
  });

  it("removes a password and clears a comment", async () => {
    const p = principal("svc", { login: true }, { comment: "old" });
    const plan = await planUpdate(p, draftFrom(p, { password: { action: "remove" }, comment: null }), server());
    expect(plan.statements.map((s) => s.sql)).toEqual(["ALTER ROLE svc WITH PASSWORD NULL", "COMMENT ON ROLE svc IS NULL"]);
  });

  it("warns when changing the connected role", async () => {
    const p = principal("admin", { login: true, superuser: true });
    const plan = await planUpdate(p, draftFrom(p, { attributes: { ...p.attributes, superuser: false } }), server());
    expect(plan.statements[0].sql).toBe("ALTER ROLE admin WITH NOSUPERUSER");
    expect(plan.warnings.join(" ")).toMatch(/connected as admin/);
  });
});

describe("planDrop", () => {
  it("cleans up before dropping, in order", () => {
    const plan = planDrop(principal("old"), { reassignTo: "admin", dropOwned: true, terminateSessions: true }, server());
    expect(plan.statements.map((s) => s.sql)).toEqual([
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = 'old' AND pid <> pg_backend_pid()",
      "REASSIGN OWNED BY old TO admin",
      "DROP OWNED BY old",
      "DROP ROLE old",
    ]);
  });

  it("warns that DROP OWNED deletes objects when nothing is reassigned", () => {
    const plan = planDrop(principal("old"), { dropOwned: true, terminateSessions: false }, server());
    expect(plan.warnings[0]).toMatch(/deletes every object old owns/);
  });
});

describe("planMemberships", () => {
  const m: Membership = { role: "readers", member: "alice", grantor: "admin", options: { admin: false, inherit: true, set: true } };

  it("writes PostgreSQL 16 options", () => {
    const plan = planMemberships(
      [
        { action: "add", role: "readers", member: "bob", options: { admin: true, inherit: false, set: true } },
        { action: "remove", membership: m },
        { action: "update", membership: m, options: { admin: true, inherit: false, set: true } },
      ],
      server(160000)
    );
    expect(plan.statements.map((s) => s.sql)).toEqual([
      "GRANT readers TO bob WITH ADMIN TRUE, INHERIT FALSE",
      "REVOKE readers FROM alice GRANTED BY admin",
      "GRANT readers TO alice WITH ADMIN TRUE GRANTED BY admin",
      "REVOKE INHERIT OPTION FOR readers FROM alice GRANTED BY admin",
    ]);
  });

  it("only knows ADMIN OPTION before PostgreSQL 16", () => {
    const plan = planMemberships(
      [
        { action: "add", role: "readers", member: "bob", options: { admin: true, inherit: false } },
        { action: "update", membership: { ...m, options: { admin: true } }, options: { admin: false, inherit: false } },
        { action: "remove", membership: m },
      ],
      server(150000)
    );
    expect(plan.statements.map((s) => s.sql)).toEqual([
      "GRANT readers TO bob WITH ADMIN OPTION",
      "REVOKE ADMIN OPTION FOR readers FROM alice",
      "REVOKE readers FROM alice",
    ]);
  });
});

describe("grantStatement", () => {
  const s = server();
  it("grants on objects, functions and columns", () => {
    expect(
      grantStatement(
        { action: "grant", target: { kind: "object", object: { type: "table", schema: "app", name: "Orders" } }, privileges: ["SELECT", "INSERT"], grantee: "alice", withGrantOption: true },
        s
      )
    ).toBe('GRANT SELECT, INSERT ON TABLE app."Orders" TO alice WITH GRANT OPTION');
    expect(
      grantStatement(
        { action: "grant", target: { kind: "object", object: { type: "function", schema: "app", name: "total", signature: "a integer, b text" } }, privileges: ["EXECUTE"], grantee: "public" },
        s
      )
    ).toBe("GRANT EXECUTE ON FUNCTION app.total(a integer, b text) TO PUBLIC");
    expect(
      grantStatement(
        { action: "grant", target: { kind: "object", object: { type: "function", schema: "app", name: "run", signature: "", subtype: "procedure" } }, privileges: ["EXECUTE"], grantee: "bob" },
        s
      )
    ).toBe("GRANT EXECUTE ON PROCEDURE app.run() TO bob");
    expect(
      grantStatement(
        { action: "revoke", target: { kind: "object", object: { type: "table", schema: "app", name: "t" }, columns: ["id", "Name"] }, privileges: ["SELECT", "UPDATE"], grantee: "bob", cascade: true },
        s
      )
    ).toBe('REVOKE SELECT (id, "Name"), UPDATE (id, "Name") ON TABLE app.t FROM bob CASCADE');
    expect(
      grantStatement({ action: "grant", target: { kind: "object", object: { type: "database", name: "app" } }, privileges: ["CONNECT"], grantee: "bob" }, s)
    ).toBe("GRANT CONNECT ON DATABASE app TO bob");
    expect(
      grantStatement({ action: "grant", target: { kind: "object", object: { type: "server", name: "remote" } }, privileges: ["USAGE"], grantee: "bob" }, s)
    ).toBe("GRANT USAGE ON FOREIGN SERVER remote TO bob");
  });

  it("grants on everything in a schema", () => {
    expect(
      grantStatement({ action: "grant", target: { kind: "all-in-schema", objectType: "table", schema: "app" }, privileges: ["SELECT"], grantee: "readers" }, s)
    ).toBe("GRANT SELECT ON ALL TABLES IN SCHEMA app TO readers");
    expect(
      grantStatement({ action: "grant", target: { kind: "all-in-schema", objectType: "function", schema: "app" }, privileges: ["EXECUTE"], grantee: "readers" }, s)
    ).toBe("GRANT EXECUTE ON ALL ROUTINES IN SCHEMA app TO readers");
    expect(
      grantStatement(
        { action: "grant", target: { kind: "all-in-schema", objectType: "function", schema: "app" }, privileges: ["EXECUTE"], grantee: "readers" },
        server(100000)
      )
    ).toBe("GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO readers");
  });

  it("sets default privileges", () => {
    expect(
      grantStatement(
        { action: "grant", target: { kind: "default", objectType: "table", schema: "app", owner: "app_owner" }, privileges: ["SELECT"], grantee: "readers" },
        s
      )
    ).toBe("ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA app GRANT SELECT ON TABLES TO readers");
    expect(
      grantStatement(
        { action: "revoke", target: { kind: "default", objectType: "function", owner: "app_owner" }, privileges: ["EXECUTE"], grantee: "public" },
        s
      )
    ).toBe("ALTER DEFAULT PRIVILEGES FOR ROLE app_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC");
    expect(
      grantStatement(
        { action: "grant", target: { kind: "default", objectType: "schema", schema: "ignored", owner: "app_owner" }, privileges: ["USAGE"], grantee: "readers" },
        s
      )
    ).toBe("ALTER DEFAULT PRIVILEGES FOR ROLE app_owner GRANT USAGE ON SCHEMAS TO readers");
  });

  it("refuses targets the type doesn't support", () => {
    expect(() =>
      grantStatement({ action: "grant", target: { kind: "all-in-schema", objectType: "type", schema: "app" }, privileges: ["USAGE"], grantee: "x" }, s)
    ).toThrow();
    expect(() =>
      grantStatement({ action: "grant", target: { kind: "default", objectType: "database", owner: "x" }, privileges: ["CONNECT"], grantee: "x" }, s)
    ).toThrow();
  });
});

describe("settings", () => {
  it("writes list parameters as one literal per item", () => {
    expect(settingValue("search_path", '"$user", app, public')).toBe("'$user', 'app', 'public'");
    expect(settingValue("statement_timeout", "30s")).toBe("'30s'");
    expect(settingValue("application_name", "a, b")).toBe("'a, b'");
  });
});

describe("planTerminateSessions", () => {
  it("only accepts numeric process ids", () => {
    const plan = planTerminateSessions([{ id: "123" }, { id: "1; DROP TABLE x" }, { id: "456" }], server());
    expect(plan.statements[0].sql).toBe("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid IN (123, 456)");
  });
});

describe("script", () => {
  it("recreates a role, optionally under another name", () => {
    const p = principal("alice", { login: true, connectionLimit: 5 }, { comment: "Analyst" });
    const detail = {
      principal: p,
      grants: [
        { object: { type: "table", schema: "app", name: "orders" }, privilege: "SELECT", grantee: "alice", grantable: false },
        { object: { type: "table", schema: "app", name: "orders" }, privilege: "INSERT", grantee: "alice", grantable: false },
        { object: { type: "table", schema: "app", name: "orders" }, column: "total", privilege: "UPDATE", grantee: "alice", grantable: false },
      ],
      defaultGrants: [{ owner: "app_owner", schema: "app", objectType: "table", grantee: "alice", privilege: "SELECT", grantable: false }],
      owned: [],
      ownedTruncated: false,
      settings: [{ name: "search_path", value: "app, public" }],
      sessions: [],
    };
    const memberships: Membership[] = [
      { role: "readers", member: "alice", options: { admin: false, inherit: true, set: true } },
      { role: "alice", member: "bob", options: { admin: false, inherit: true, set: true } },
    ];
    const sql = script(detail, memberships, server(150000), { name: "alice2" });
    expect(sql.split("\n").filter((l) => l && !l.startsWith("--"))).toEqual([
      "CREATE ROLE alice2 WITH LOGIN CONNECTION LIMIT 5;",
      "COMMENT ON ROLE alice2 IS 'Analyst';",
      "ALTER ROLE alice2 SET search_path TO 'app', 'public';",
      "GRANT readers TO alice2;",
      "GRANT SELECT, INSERT ON TABLE app.orders TO alice2;",
      "GRANT UPDATE (total) ON TABLE app.orders TO alice2;",
      "ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA app GRANT SELECT ON TABLES TO alice2;",
    ]);
    // Members are only part of the role's own script.
    expect(script(detail, memberships, server(150000))).toContain("GRANT alice TO bob;");
  });
});
