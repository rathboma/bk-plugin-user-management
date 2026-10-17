import { describe, expect, it } from "vitest";
import { reachableRoles } from "../../src/core/graph";
import { effectiveMemberships, explainPrivilege, predefinedRolesFor } from "../../src/engines/postgres/privileges";
import type { Membership, ServerInfo } from "../../src/engines/types";

const server = (version: number): ServerInfo => ({
  version,
  versionLabel: "",
  database: "app",
  currentUser: "admin",
  isSuperuser: true,
  canManagePrincipals: true,
  settings: { databaseOwner: "app_owner" },
});

const m = (role: string, member: string, inherit = true): Membership => ({ role, member, options: { admin: false, inherit, set: true } });
const reach = (principal: string, memberships: Membership[]) =>
  reachableRoles(principal, memberships, { inherits: (x) => x.options.inherit, settable: () => true });

const base = { privilege: "SELECT", superuser: false, predefined: [] as string[], owner: "app_owner" };

describe("explainPrivilege", () => {
  it("finds grants through memberships", () => {
    const cell = explainPrivilege({
      ...base,
      principal: "alice",
      allowed: true,
      acl: [
        { grantee: "app_owner", privilege: "SELECT", grantable: false },
        { grantee: "readers", privilege: "SELECT", grantable: false },
        { grantee: "readers", privilege: "INSERT", grantable: false },
      ],
      reach: reach("alice", [m("readers", "analysts"), m("analysts", "alice")]),
    });
    expect(cell).toEqual({
      allowed: true,
      sources: [{ kind: "inherited", grantee: "readers", grantable: false, via: ["alice", "analysts", "readers"], needsSetRole: false }],
    });
  });

  it("orders owner, direct and PUBLIC", () => {
    const cell = explainPrivilege({
      ...base,
      principal: "app_owner",
      allowed: true,
      acl: [
        { grantee: "public", privilege: "SELECT", grantable: false },
        { grantee: "app_owner", privilege: "SELECT", grantable: false },
      ],
      reach: new Map(),
    });
    expect(cell.sources.map((s) => s.kind)).toEqual(["owner", "public"]);
  });

  it("keeps only SET ROLE paths when the privilege isn't held", () => {
    const cell = explainPrivilege({
      ...base,
      principal: "bob",
      allowed: false,
      acl: [{ grantee: "writers", privilege: "SELECT", grantable: false }],
      reach: reach("bob", [m("writers", "bob", false)]),
    });
    expect(cell).toEqual({ allowed: false, sources: [expect.objectContaining({ grantee: "writers", needsSetRole: true })] });
    expect(explainPrivilege({ ...base, principal: "eve", allowed: false, acl: [], reach: new Map() })).toEqual({ allowed: false, sources: [] });
  });

  it("credits predefined roles and superusers", () => {
    const viaPredefined = explainPrivilege({
      ...base,
      principal: "auditor",
      allowed: true,
      acl: [],
      predefined: predefinedRolesFor("table", "SELECT", server(160000)),
      reach: reach("auditor", [m("pg_read_all_data", "auditor")]),
    });
    expect(viaPredefined.sources[0]).toMatchObject({ kind: "predefined", grantee: "pg_read_all_data" });
    expect(predefinedRolesFor("table", "SELECT", server(130000))).toEqual([]);
    expect(predefinedRolesFor("table", "MAINTAIN", server(170000))).toEqual(["pg_maintain"]);

    const superuser = explainPrivilege({ ...base, principal: "root", superuser: true, allowed: true, acl: [], reach: new Map() });
    expect(superuser.sources).toEqual([{ kind: "superuser", via: ["root"] }]);
  });

  it("admits when it can't tell why", () => {
    const cell = explainPrivilege({ ...base, principal: "x", allowed: true, acl: [], reach: new Map() });
    expect(cell.sources).toEqual([{ kind: "unknown", note: expect.any(String) }]);
  });

  it("makes the database owner a member of pg_database_owner on 14+", () => {
    expect(effectiveMemberships([], server(140000))).toEqual([expect.objectContaining({ role: "pg_database_owner", member: "app_owner" })]);
    expect(effectiveMemberships([], server(130000))).toEqual([]);
  });
});
