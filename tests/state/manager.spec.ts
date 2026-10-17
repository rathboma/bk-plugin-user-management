// The host module loads the plugin SDK, which needs a window.
// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { createManager, type SavedViewState } from "../../src/state/manager";
import type { Host } from "../../src/host/host";
import type { LaunchInput } from "../../src/host/launch";
import type { ChangePlan, Principal, ServerInfo, UserManagementEngine } from "../../src/engines/types";

const server: ServerInfo = {
  version: 170000,
  versionLabel: "PostgreSQL 17",
  database: "app",
  currentUser: "admin",
  isSuperuser: true,
  canManagePrincipals: true,
  settings: {},
};

const principal = (name: string, kind = "user", system = false): Principal => ({
  id: name,
  name,
  kind,
  system,
  attributes: { login: kind === "user" },
  comment: null,
  badges: [],
});

function setup(options: { readOnly?: boolean; saved?: SavedViewState; context?: unknown; failApply?: string } = {}) {
  let principals = [principal("admin"), principal("alice"), principal("readers", "role"), principal("pg_monitor", "role", true)];
  const executed: ChangePlan[] = [];
  const engine = {
    id: "fake",
    displayName: "Fake",
    connectionTypes: ["fake"],
    loadServerInfo: vi.fn(async () => server),
    capabilities: () => ({ kinds: [{ id: "user", label: "Users", singular: "User", description: "" }] }),
    listPrincipals: vi.fn(async () => principals),
    listMemberships: vi.fn(async () => [{ role: "readers", member: "alice", options: {} }]),
    loadDetail: vi.fn(async (_run: unknown, _server: unknown, p: Principal) => ({
      principal: p,
      grants: [],
      defaultGrants: [],
      owned: [],
      ownedTruncated: false,
      settings: [],
      sessions: [],
    })),
    execute: vi.fn(async (_run: unknown, plan: ChangePlan) => {
      if (options.failApply) throw new Error(options.failApply);
      executed.push(plan);
      if (plan.selectAfter) principals = [...principals, principal(plan.selectAfter)];
    }),
  } as unknown as UserManagementEngine;

  const saved: unknown[] = [];
  const host = {
    connectionInfo: async () => ({ databaseType: "fake", connectionType: "fake", readOnlyMode: options.readOnly ?? false }),
    viewContext: async () => options.context,
    viewState: async () => options.saved,
    saveViewState: async (state: unknown) => void saved.push(state),
    runQuery: async () => [],
    setTitle: vi.fn(async () => undefined),
    notifySuccess: vi.fn(async () => undefined),
    notifyError: vi.fn(async () => undefined),
  } as unknown as Host;

  const manager = createManager(host, (type) => (type === "fake" ? engine : undefined));
  return { manager, engine, host, executed, saved };
}

const launch = (input: LaunchInput) => async () => input;

describe("manager", () => {
  it("loads and selects the connected user", async () => {
    const { manager } = setup();
    await manager.init(launch({ kind: "manage" }));
    expect(manager.state.status).toBe("ready");
    expect(manager.state.selected).toBe("admin");
    expect(manager.state.detail?.principal.name).toBe("admin");
    expect(manager.filteredPrincipals.value.map((p) => p.name)).toEqual(["admin", "alice", "readers"]);
    manager.setShowSystem(true);
    expect(manager.filteredPrincipals.value).toHaveLength(4);
    manager.state.search = "ali";
    expect(manager.filteredPrincipals.value.map((p) => p.name)).toEqual(["alice"]);
  });

  it("reports databases without an engine", async () => {
    const other = createManager(
      { connectionInfo: async () => ({ databaseType: "mysql" }), viewState: async () => undefined } as unknown as Host,
      () => undefined
    );
    await other.init(launch({ kind: "manage" }));
    expect(other.state.status).toBe("unsupported");
  });

  it("opens the object view when launched from a table", async () => {
    const { manager, host } = setup();
    await manager.init(launch({ kind: "object", object: { type: "table", schema: "app", name: "orders" } }));
    expect(manager.state.view).toBe("object");
    expect(manager.state.object?.name).toBe("orders");
    expect(host.setTitle).toHaveBeenCalledWith("Access: orders");
  });

  it("restores the saved tab state", async () => {
    const { manager } = setup({
      saved: { version: 1, view: "principals", selected: "readers", tab: "grants", showSystem: true },
    });
    await manager.init(launch({ kind: "manage" }));
    expect(manager.state.selected).toBe("readers");
    expect(manager.state.tab).toBe("grants");
    expect(manager.state.showSystem).toBe(true);
  });

  it("applies a reviewed plan, refreshes and selects the result", async () => {
    const { manager, engine, executed } = setup();
    await manager.init(launch({ kind: "manage" }));
    const before = manager.state.revision;
    manager.review({ title: "Create bob", statements: [{ sql: "CREATE ROLE bob" }], warnings: [], selectAfter: "bob" });
    expect(manager.state.review?.plan.title).toBe("Create bob");
    await manager.apply();
    expect(executed).toHaveLength(1);
    expect(manager.state.review).toBeUndefined();
    expect(manager.state.selected).toBe("bob");
    expect(manager.state.revision).toBe(before + 1);
    expect(engine.listPrincipals).toHaveBeenCalledTimes(2);
  });

  it("keeps the review open with the error when a plan fails", async () => {
    const { manager } = setup({ failApply: 'role "bob" already exists' });
    await manager.init(launch({ kind: "manage" }));
    manager.review({ title: "Create bob", statements: [{ sql: "CREATE ROLE bob" }], warnings: [] });
    await manager.apply();
    expect(manager.state.review?.error).toBe('role "bob" already exists');
    expect(manager.state.review?.running).toBe(false);
  });

  it("knows about read-only connections", async () => {
    const { manager } = setup({ readOnly: true });
    await manager.init(launch({ kind: "manage" }));
    expect(manager.readOnly.value).toBe(true);
  });

  it("asks an access question in the Debug tab", async () => {
    const { manager } = setup();
    await manager.init(launch({ kind: "manage" }));
    manager.ask("alice", { object: { type: "table", schema: "app", name: "orders" }, privilege: "SELECT" });
    expect(manager.state.selected).toBe("alice");
    expect(manager.state.tab).toBe("debug");
    expect(manager.state.question?.privilege).toBe("SELECT");
  });
});
