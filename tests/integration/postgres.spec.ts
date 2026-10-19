import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { postgres } from "../../src/engines/postgres";
import type { AccessContext, PrincipalDraft, QueryResultLike, RunQuery, ServerInfo } from "../../src/engines/types";

/**
 * Runs against a real server when PG_URL is set, e.g.
 *   PG_URL=postgres://postgres:pw@localhost:5432/postgres yarn test
 *
 * Queries go through a pool exactly like Beekeeper Studio's runQuery: one
 * simple-protocol call per request, on whichever pooled connection is free.
 * Everything happens in a scratch database, and every role is prefixed um_.
 */
const url = process.env.PG_URL;
const DB = "um_test";

function urlFor(database: string, user?: string, password?: string): string {
  const u = new URL(url!);
  u.pathname = `/${database}`;
  if (user) {
    u.username = user;
    u.password = password ?? "";
  }
  return u.toString();
}

describe.skipIf(!url)("PostgreSQL engine against a live server", () => {
  let admin: pg.Client;
  let pool: pg.Pool;
  let server: ServerInfo;
  const run: RunQuery = async (sql) => {
    const result = (await pool.query(sql)) as unknown as pg.QueryResult | pg.QueryResult[];
    const results = Array.isArray(result) ? result : [result];
    return results.map(
      (r): QueryResultLike => ({ fields: (r.fields ?? []).map((f) => ({ name: f.name })), rows: r.rows ?? [] })
    );
  };
  const q = async (sql: string) => (await pool.query(sql)).rows;
  const context = async (): Promise<AccessContext> => ({
    principals: await postgres.listPrincipals(run, server),
    memberships: await postgres.listMemberships(run, server),
  });
  const principal = async (name: string) => {
    const found = (await postgres.listPrincipals(run, server)).find((p) => p.name === name);
    if (!found) throw new Error(`${name} not found`);
    return found;
  };
  const draft = (name: string, overrides: Partial<PrincipalDraft> = {}): PrincipalDraft => ({
    name,
    kind: "user",
    attributes: { login: true },
    comment: null,
    password: { action: "keep" },
    ...overrides,
  });
  const canLogin = async (user: string, password: string) => {
    const client = new pg.Client({ connectionString: urlFor(DB, user, password) });
    try {
      await client.connect();
      return true;
    } catch {
      return false;
    } finally {
      await client.end().catch(() => undefined);
    }
  };

  async function dropTestRoles() {
    const roles = (await admin.query("SELECT rolname FROM pg_roles WHERE rolname LIKE 'um\\_%'")).rows.map((r) => r.rolname);
    for (const role of roles) {
      await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = '${role}'`);
      await admin.query(`DROP OWNED BY "${role}"`).catch(() => undefined);
    }
    for (const role of roles) await admin.query(`DROP ROLE IF EXISTS "${role}"`).catch(() => undefined);
  }

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB}' AND pid <> pg_backend_pid()`);
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await dropTestRoles();
    await admin.query(`CREATE DATABASE ${DB}`);
    pool = new pg.Pool({ connectionString: urlFor(DB), max: 2 });
    // Cleanup terminates connections to the scratch database.
    pool.on("error", () => undefined);
    await q(`
      CREATE SCHEMA app;
      CREATE TABLE app.orders (id int PRIMARY KEY, customer text, total numeric, secret text);
      INSERT INTO app.orders VALUES (1, 'ann', 10, 'x'), (2, 'bob', 20, 'y');
      CREATE SEQUENCE app.order_seq;
      CREATE FUNCTION app.order_total(a int, b int) RETURNS int LANGUAGE sql AS 'SELECT a + b';
      CREATE VIEW app.big_orders AS SELECT * FROM app.orders WHERE total > 15;
    `);
    server = await postgres.loadServerInfo(run);
  });

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB}'`);
      await admin.query(`DROP DATABASE IF EXISTS ${DB}`).catch(() => undefined);
      await dropTestRoles();
      await admin.end();
    }
  });

  it("reads the server", () => {
    expect(server.version).toBeGreaterThan(100000);
    expect(server.isSuperuser).toBe(true);
    expect(server.database).toBe(DB);
    expect(server.settings.passwordEncryption).toMatch(/md5|scram-sha-256/);
  });

  it("creates a user whose hashed password works", async () => {
    const plan = await postgres.planCreate(
      draft("um_alice", { password: { action: "set", value: "s3cret's" }, comment: "Alice's login", attributes: { login: true, connectionLimit: 5 } }),
      server
    );
    expect(plan.statements[0].sql).not.toContain("s3cret");
    expect(plan.statements[0].display).toContain("********");
    await postgres.execute(run, plan);

    const alice = await principal("um_alice");
    expect(alice.kind).toBe("user");
    expect(alice.attributes.connectionLimit).toBe(5);
    expect(alice.comment).toBe("Alice's login");
    expect(alice.passwordState).toBe(server.settings.passwordEncryption);
    await q(`GRANT CONNECT ON DATABASE ${DB} TO um_alice`);
    expect(await canLogin("um_alice", "s3cret's")).toBe(true);
    expect(await canLogin("um_alice", "wrong")).toBe(false);
  });

  it("stores SCRAM verifiers that work for login", async () => {
    await postgres.execute(run, await postgres.planCreate(draft("um_scram"), server));
    const scramServer = { ...server, settings: { ...server.settings, passwordEncryption: "scram-sha-256" } };
    const before = await principal("um_scram");
    await postgres.execute(
      run,
      await postgres.planUpdate(before, { ...draft("um_scram"), password: { action: "set", value: "Tr0ub4dor&3" } }, scramServer)
    );
    expect((await principal("um_scram")).passwordState).toBe("scram-sha-256");
    expect(await canLogin("um_scram", "Tr0ub4dor&3")).toBe(true);
  });

  it("changes, renames and comments on a role", async () => {
    await postgres.execute(run, await postgres.planCreate(draft("um_temp", { kind: "role", attributes: { login: false } }), server));
    const before = await principal("um_temp");
    expect(before.kind).toBe("role");
    const plan = await postgres.planUpdate(
      before,
      {
        ...draft("um_renamed"),
        kind: "role",
        attributes: { ...before.attributes, createdb: true, inherit: false, validUntil: "2099-01-01T00:00:00.000Z" },
        comment: "now renamed",
      },
      server
    );
    expect(plan.statements.map((s) => s.sql)).toEqual([
      "ALTER ROLE um_temp RENAME TO um_renamed",
      "ALTER ROLE um_renamed WITH CREATEDB NOINHERIT VALID UNTIL '2099-01-01T00:00:00.000Z'",
      "COMMENT ON ROLE um_renamed IS 'now renamed'",
    ]);
    await postgres.execute(run, plan);
    const after = await principal("um_renamed");
    expect(after.attributes.createdb).toBe(true);
    expect(after.attributes.inherit).toBe(false);
    expect(after.attributes.validUntil).toMatch(/^2099-01-01/);
    expect(after.comment).toBe("now renamed");

    // Clearing the expiry
    const cleared = await postgres.planUpdate(after, { ...draft("um_renamed"), kind: "role", attributes: { ...after.attributes, validUntil: null }, comment: "now renamed" }, server);
    await postgres.execute(run, cleared);
    expect((await principal("um_renamed")).attributes.validUntil).toBeNull();
  });

  it("rolls back every statement when one fails", async () => {
    const plan = await postgres.planCreate(draft("um_rollback", { memberOf: ["um_does_not_exist"] }), server);
    await expect(postgres.execute(run, plan)).rejects.toThrow(/does not exist/);
    expect((await postgres.listPrincipals(run, server)).some((p) => p.name === "um_rollback")).toBe(false);
    // The pooled connections are still usable.
    expect(await q("SELECT 1 AS ok")).toEqual([{ ok: 1 }]);
  });

  it("quotes awkward names", async () => {
    const name = 'um_Odd "name"';
    await postgres.execute(run, await postgres.planCreate(draft(name, { comment: "back\\slash" }), server));
    const odd = await principal(name);
    expect(odd.comment).toBe("back\\slash");
    await postgres.execute(run, postgres.planDrop(odd, { dropOwned: false, terminateSessions: false }, server));
  });

  it("manages memberships", async () => {
    await postgres.execute(run, await postgres.planCreate(draft("um_readers", { kind: "role", attributes: { login: false } }), server));
    await postgres.execute(
      run,
      postgres.planMemberships([{ action: "add", role: "um_readers", member: "um_alice", options: { admin: false, inherit: true, set: true } }], server)
    );
    let memberships = await postgres.listMemberships(run, server);
    let m = memberships.find((x) => x.role === "um_readers" && x.member === "um_alice")!;
    expect(m).toBeDefined();
    expect(m.options.admin).toBe(false);

    await postgres.execute(run, postgres.planMemberships([{ action: "update", membership: m, options: { ...m.options, admin: true, inherit: false } }], server));
    memberships = await postgres.listMemberships(run, server);
    m = memberships.find((x) => x.role === "um_readers" && x.member === "um_alice")!;
    expect(m.options.admin).toBe(true);
    if (server.version >= 160000) expect(m.options.inherit).toBe(false);

    await postgres.execute(run, postgres.planMemberships([{ action: "update", membership: m, options: { ...m.options, admin: false, inherit: true } }], server));
    m = (await postgres.listMemberships(run, server)).find((x) => x.role === "um_readers" && x.member === "um_alice")!;
    expect(m.options).toMatchObject({ admin: false, inherit: true });
  });

  it("grants, explains and revokes privileges", async () => {
    await postgres.execute(
      run,
      postgres.planGrants(
        [
          { action: "grant", target: { kind: "object", object: { type: "schema", name: "app" } }, privileges: ["USAGE"], grantee: "um_readers" },
          { action: "grant", target: { kind: "object", object: { type: "table", schema: "app", name: "orders" } }, privileges: ["SELECT"], grantee: "um_readers" },
          { action: "grant", target: { kind: "object", object: { type: "table", schema: "app", name: "orders" }, columns: ["id", "total"] }, privileges: ["UPDATE"], grantee: "um_alice" },
          { action: "grant", target: { kind: "all-in-schema", objectType: "sequence", schema: "app" }, privileges: ["USAGE"], grantee: "um_alice" },
          { action: "grant", target: { kind: "default", objectType: "table", schema: "app", owner: server.currentUser }, privileges: ["SELECT"], grantee: "um_readers" },
        ],
        server
      )
    );

    const ctx = await context();
    const effective = await postgres.effectivePrivileges(run, server, ctx, "um_alice", "table", "app");
    const orders = effective.rows.find((r) => r.object.name === "orders")!;
    expect(orders.cells.SELECT.allowed).toBe(true);
    expect(orders.cells.SELECT.sources[0]).toMatchObject({ kind: "inherited", grantee: "um_readers", via: ["um_alice", "um_readers"] });
    expect(orders.cells.INSERT.allowed).toBe(false);

    const functions = await postgres.effectivePrivileges(run, server, ctx, "um_alice", "function", "app");
    expect(functions.rows[0].object.signature).toBe("a integer, b integer");
    expect(functions.rows[0].cells.EXECUTE.sources[0].kind).toBe("public");

    const alice = await principal("um_alice");
    const detail = await postgres.loadDetail(run, server, alice);
    expect(detail.grants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ object: expect.objectContaining({ type: "table", name: "orders" }), column: "id", privilege: "UPDATE" }),
        expect.objectContaining({ object: expect.objectContaining({ type: "sequence", name: "order_seq" }), privilege: "USAGE" }),
      ])
    );
    // What the owner sees: who else holds privileges on its objects.
    const owner = await postgres.loadDetail(run, server, await principal(server.currentUser));
    const ordersOwned = owner.owned.find((o) => o.name === "orders");
    // Column grants (um_alice's UPDATE) live on the columns, not the table.
    expect(ordersOwned?.grants).toEqual([{ grantee: "um_readers", privileges: ["SELECT"] }]);
    expect(ordersOwned?.policies).toBe(0);
    const readers = await postgres.loadDetail(run, server, await principal("um_readers"));
    expect(readers.defaultGrants).toEqual([
      expect.objectContaining({ owner: server.currentUser, schema: "app", objectType: "table", privilege: "SELECT", grantee: "um_readers" }),
    ]);

    // Default privileges apply to tables created afterwards.
    await q("CREATE TABLE app.later (id int)");
    const later = await postgres.objectAccess(run, server, await context(), { type: "table", schema: "app", name: "later" });
    expect(later.rows.find((r) => r.principal === "um_alice")!.cells.SELECT.allowed).toBe(true);

    await postgres.execute(
      run,
      postgres.planGrants(
        [{ action: "revoke", target: { kind: "default", objectType: "table", schema: "app", owner: server.currentUser }, privileges: ["SELECT"], grantee: "um_readers" }],
        server
      )
    );
    expect((await postgres.loadDetail(run, server, await principal("um_readers"))).defaultGrants).toEqual([]);
  });

  it("explains why access fails and fixes it", async () => {
    await postgres.execute(run, await postgres.planCreate(draft("um_bob", { password: { action: "set", value: "pw" } }), server));
    await q("REVOKE CONNECT ON DATABASE um_test FROM PUBLIC");
    let ctx = await context();
    let result = await postgres.checkAccess(run, server, ctx, {
      principal: "um_bob",
      object: { type: "table", schema: "app", name: "orders" },
      privilege: "SELECT",
    });
    expect(result.allowed).toBe(false);
    const byId = Object.fromEntries(result.checks.map((c) => [c.id, c.status]));
    expect(byId).toMatchObject({ privilege: "fail", schema: "fail", connect: "fail" });
    expect(result.fixes).toHaveLength(1);
    await postgres.execute(run, result.fixes[0]);

    ctx = await context();
    result = await postgres.checkAccess(run, server, ctx, {
      principal: "um_bob",
      object: { type: "table", schema: "app", name: "orders" },
      privilege: "SELECT",
    });
    expect(result.allowed).toBe(true);
    expect(result.cell.sources[0].kind).toBe("direct");
  });

  it("finds column grants, SET ROLE-only access and row level security", async () => {
    await postgres.execute(run, await postgres.planCreate(draft("um_carol", { attributes: { login: true, inherit: false } }), server));
    await q("GRANT um_readers TO um_carol; GRANT CONNECT ON DATABASE um_test TO um_carol; GRANT USAGE ON SCHEMA app TO um_carol");
    await q("GRANT SELECT (id, customer) ON app.orders TO um_carol");
    let result = await postgres.checkAccess(run, server, await context(), {
      principal: "um_carol",
      object: { type: "table", schema: "app", name: "orders" },
      privilege: "SELECT",
    });
    expect(result.allowed).toBe(false);
    expect(result.cell.sources[0]).toMatchObject({ kind: "inherited", needsSetRole: true });
    expect(result.checks.find((c) => c.id === "columns")?.detail).toContain("id, customer");
    expect(result.checks.find((c) => c.id === "set-role")?.status).toBe("warn");

    await q("ALTER TABLE app.orders ENABLE ROW LEVEL SECURITY");
    result = await postgres.checkAccess(run, server, await context(), {
      principal: "um_alice",
      object: { type: "table", schema: "app", name: "orders" },
      privilege: "SELECT",
    });
    expect(result.checks.find((c) => c.id === "rls")?.status).toBe("warn");
    await q("CREATE POLICY own_orders ON app.orders FOR SELECT TO um_readers USING (customer = current_user)");
    result = await postgres.checkAccess(run, server, await context(), {
      principal: "um_alice",
      object: { type: "table", schema: "app", name: "orders" },
      privilege: "SELECT",
    });
    expect(result.checks.find((c) => c.id === "rls")).toMatchObject({ status: "info", detail: expect.stringContaining("own_orders") });
    const access = await postgres.objectAccess(run, server, await context(), { type: "table", schema: "app", name: "orders" });
    expect(access.notes.map((n) => n.id)).toEqual(["rls", "columns"]);
    await q("ALTER TABLE app.orders DISABLE ROW LEVEL SECURITY");
  });

  it("diagnoses logins", async () => {
    await postgres.execute(run, await postgres.planCreate(draft("um_dave", { attributes: { login: true, validUntil: "2001-01-01T00:00:00Z" } }), server));
    const dave = await principal("um_dave");
    const result = await postgres.diagnoseLogin(run, server, await context(), dave);
    const byId = Object.fromEntries(result.checks.map((c) => [c.id, c]));
    expect(result.verdict).toBe("no");
    expect(result.summary).toMatch(/expired on 2001-01-01/);
    expect(result.suggestPassword).toBe(true);
    expect(byId.login.status).toBe("ok");
    expect(byId.expiry.status).toBe("fail");
    expect(byId.password.status).toBe("warn");
    expect(byId.databases.detail).toContain(`No CONNECT on ${DB}`);
    expect(byId.databases.fix?.statements[0].sql).toBe(`GRANT CONNECT ON DATABASE ${DB} TO um_dave`);
    // The rules that match are grouped under one check.
    expect(byId.hba.label).toMatch(/pg_hba\.conf · \d+ rules? match/);
    expect(byId.hba.children?.length).toBeGreaterThan(0);
    // The suggested fix works.
    expect(result.fixes.map((f) => f.title)).toContain("Remove the expiry");
    await postgres.execute(run, byId.expiry.fix!);
    expect((await principal("um_dave")).attributes.validUntil).toBeNull();
    expect((await postgres.diagnoseLogin(run, server, await context(), await principal("um_dave"))).checks.find((c) => c.id === "expiry")?.status).toBe("ok");
  });

  it("stores role settings, including list values", async () => {
    const alice = await principal("um_alice");
    await postgres.execute(
      run,
      postgres.planSettings(
        alice,
        [
          { action: "set", name: "search_path", value: '"$user", app, public' },
          { action: "set", name: "statement_timeout", value: "5s" },
          { action: "set", name: "work_mem", value: "64MB", database: DB },
        ],
        server
      )
    );
    const detail = await postgres.loadDetail(run, server, alice);
    expect(detail.settings).toEqual(
      expect.arrayContaining([
        { name: "search_path", value: '"$user", app, public', database: undefined },
        { name: "statement_timeout", value: "5s", database: undefined },
        { name: "work_mem", value: "64MB", database: DB },
      ])
    );
    await postgres.execute(run, postgres.planSettings(alice, [{ action: "reset", name: "statement_timeout" }], server));
    expect((await postgres.loadDetail(run, server, alice)).settings.some((s) => s.name === "statement_timeout")).toBe(false);
  });

  it("scripts a role that can be recreated under another name", async () => {
    const alice = await principal("um_alice");
    const detail = await postgres.loadDetail(run, server, alice);
    const sql = postgres.script(detail, await postgres.listMemberships(run, server), server, { name: "um_alice_copy" });
    expect(sql).toContain("CREATE ROLE um_alice_copy WITH LOGIN CONNECTION LIMIT 5;");
    await q(sql);
    const copy = await postgres.loadDetail(run, server, await principal("um_alice_copy"));
    expect(copy.grants.length).toBe(detail.grants.length);
    expect(copy.settings.length).toBe(detail.settings.length);
    expect((await postgres.listMemberships(run, server)).some((m) => m.member === "um_alice_copy" && m.role === "um_readers")).toBe(true);
  });

  it("shows and terminates sessions", async () => {
    await q("ALTER ROLE um_bob PASSWORD 'pw'");
    const client = new pg.Client({ connectionString: urlFor(DB, "um_bob", "pw") });
    await client.connect();
    client.on("error", () => undefined);
    const bob = await principal("um_bob");
    expect(bob.sessions).toBe(1);
    const detail = await postgres.loadDetail(run, server, bob);
    expect(detail.sessions).toHaveLength(1);
    await postgres.execute(run, postgres.planTerminateSessions(detail.sessions, server));
    await new Promise((r) => setTimeout(r, 200));
    expect((await principal("um_bob")).sessions).toBe(0);
    await client.end().catch(() => undefined);
  });

  it("drops a role that owns objects", async () => {
    await postgres.execute(run, await postgres.planCreate(draft("um_owner"), server));
    await q("GRANT CREATE ON SCHEMA app TO um_owner; SET ROLE um_owner; CREATE TABLE app.owned (id int); RESET ROLE");
    await q("GRANT SELECT ON app.orders TO um_owner");
    const owner = await principal("um_owner");
    const info = await postgres.dropInfo(run, server, owner);
    expect(info.ownedCount).toBeGreaterThan(0);
    expect(info.checks.map((c) => c.id)).toEqual(expect.arrayContaining(["owned", "privileges"]));

    // Without cleaning up first, DROP ROLE fails and nothing changes.
    await expect(postgres.execute(run, postgres.planDrop(owner, { dropOwned: false, terminateSessions: false }, server))).rejects.toThrow(
      /depend/
    );
    await postgres.execute(
      run,
      postgres.planDrop(owner, { reassignTo: server.currentUser, dropOwned: true, terminateSessions: true }, server)
    );
    expect((await postgres.listPrincipals(run, server)).some((p) => p.name === "um_owner")).toBe(false);
    expect(await q("SELECT count(*)::int AS n FROM app.owned")).toEqual([{ n: 0 }]);
  });

  it("lists objects of every type", async () => {
    for (const type of postgres.capabilities(server).objectTypes) {
      const objects = await postgres.listObjects(run, server, type.id);
      expect(Array.isArray(objects)).toBe(true);
    }
    expect((await postgres.listObjects(run, server, "table", "app")).map((o) => o.name)).toEqual(
      expect.arrayContaining(["orders", "big_orders", "later"])
    );
    expect(await postgres.listColumns(run, server, { type: "table", schema: "app", name: "orders" })).toEqual([
      "id",
      "customer",
      "total",
      "secret",
    ]);
    expect(await postgres.listSchemas(run, server)).toEqual(["public", "app"]);
  });
});
