import { createHash, createHmac, pbkdf2Sync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fromDateTimeInput, parseTimestamp, sameTimestamp, toDateTimeInput } from "../../src/core/format";
import { allMembers, reachableRoles, wouldCreateCycle } from "../../src/core/graph";
import { md5Hex } from "../../src/core/md5";
import { describeSource } from "../../src/core/sources";
import { encodePassword, md5Verifier, scramVerifier } from "../../src/engines/postgres/password";
import { launchInput } from "../../src/host/launch";
import type { Membership } from "../../src/engines/types";

const member = (role: string, m: string, options: Partial<Membership["options"]> = {}): Membership => ({
  role,
  member: m,
  options: { admin: false, inherit: true, set: true, ...options },
});

describe("md5", () => {
  it("matches node's implementation", () => {
    for (const input of ["", "abc", "The quick brown fox jumps over the lazy dog", "a".repeat(55), "a".repeat(56), "x".repeat(1000), "pässwörd✓"]) {
      expect(md5Hex(input)).toBe(createHash("md5").update(input, "utf8").digest("hex"));
    }
  });

  it("builds PostgreSQL's md5 password format", () => {
    expect(md5Verifier("pw", "alice")).toBe(`md5${createHash("md5").update("pwalice").digest("hex")}`);
  });
});

describe("SCRAM-SHA-256", () => {
  it("builds the verifier PostgreSQL stores", async () => {
    const salt = new Uint8Array(16).map((_, i) => i);
    const verifier = await scramVerifier("hunter2", { salt, iterations: 4096 });
    const salted = pbkdf2Sync("hunter2", Buffer.from(salt), 4096, 32, "sha256");
    const clientKey = createHmac("sha256", salted).update("Client Key").digest();
    const storedKey = createHash("sha256").update(clientKey).digest("base64");
    const serverKey = createHmac("sha256", salted).update("Server Key").digest("base64");
    expect(verifier).toBe(`SCRAM-SHA-256$4096:${Buffer.from(salt).toString("base64")}$${storedKey}:${serverKey}`);
  });

  it("uses a new salt every time", async () => {
    expect(await scramVerifier("same")).not.toBe(await scramVerifier("same"));
  });

  it("leaves non-ASCII passwords for the server to normalize", async () => {
    const encoded = await encodePassword("pässword", "alice", { passwordEncryption: "scram-sha-256" });
    expect(encoded).toMatchObject({ value: "pässword", encoding: "plain" });
    expect(encoded.warning).toMatch(/plain text/);
    expect((await encodePassword("pässword", "alice", { passwordEncryption: "md5" })).encoding).toBe("md5");
  });
});

describe("membership graph", () => {
  const memberships = [
    member("readers", "analysts"),
    member("analysts", "alice"),
    member("writers", "bob", { inherit: false }),
    member("auditors", "writers"),
    member("ops", "bob", { set: false }),
  ];

  it("follows chains and records the path", () => {
    const reach = reachableRoles("alice", memberships);
    expect(reach.get("readers")).toMatchObject({ path: ["alice", "analysts", "readers"], inherited: true, depth: 2 });
  });

  it("marks roles that need SET ROLE", () => {
    const rules = { inherits: (m: Membership) => m.options.inherit, settable: (m: Membership) => m.options.set };
    const reach = reachableRoles("bob", memberships, rules);
    expect(reach.get("writers")).toMatchObject({ inherited: false, settable: true });
    expect(reach.get("auditors")).toMatchObject({ inherited: false, path: ["bob", "writers", "auditors"] });
    expect(reach.get("ops")).toMatchObject({ inherited: true, settable: false });
  });

  it("prefers an inherited chain over a shorter one that isn't", () => {
    const list = [member("target", "bob", { inherit: false }), member("middle", "bob"), member("target", "middle")];
    const reach = reachableRoles("bob", list, { inherits: (m) => m.options.inherit, settable: () => true });
    expect(reach.get("target")).toMatchObject({ inherited: true, path: ["bob", "middle", "target"] });
  });

  it("finds members and loops", () => {
    expect([...allMembers("readers", memberships).keys()]).toEqual(["analysts", "alice"]);
    expect(wouldCreateCycle("alice", "readers", memberships)).toBe(true);
    expect(wouldCreateCycle("readers", "bob", memberships)).toBe(false);
    expect(wouldCreateCycle("x", "x", memberships)).toBe(true);
  });
});

describe("timestamps", () => {
  it("reads PostgreSQL's text format", () => {
    expect(parseTimestamp("2026-10-16 12:00:00+00")?.toISOString()).toBe("2026-10-16T12:00:00.000Z");
    expect(parseTimestamp("2026-10-16 12:00:00.5-05")?.toISOString()).toBe("2026-10-16T17:00:00.500Z");
    expect(parseTimestamp("2026-10-16 12:00:00+05:30")?.toISOString()).toBe("2026-10-16T06:30:00.000Z");
    expect(parseTimestamp("infinity")).toBeUndefined();
    expect(sameTimestamp("2026-10-16 12:00:00+00", "2026-10-16T12:00:00.000Z")).toBe(true);
    expect(sameTimestamp(null, undefined)).toBe(true);
    expect(sameTimestamp(null, "2026-10-16T12:00:00Z")).toBe(false);
  });

  it("round-trips the datetime input", () => {
    const iso = "2026-10-16T12:34:00.000Z";
    expect(fromDateTimeInput(toDateTimeInput(iso))).toBe(iso);
    expect(fromDateTimeInput("")).toBeNull();
  });
});

describe("describeSource", () => {
  it("explains each kind of source", () => {
    expect(describeSource({ kind: "direct", via: ["alice"], grantable: true })).toBe("Granted directly, with grant option");
    expect(describeSource({ kind: "inherited", grantee: "readers", via: ["alice", "analysts", "readers"] })).toBe(
      "Granted to readers, through analysts → readers"
    );
    expect(describeSource({ kind: "inherited", grantee: "writers", via: ["bob", "writers"], needsSetRole: true })).toBe(
      "Granted to writers, usable only after SET ROLE"
    );
    expect(describeSource({ kind: "public" })).toMatch(/PUBLIC/);
    expect(describeSource({ kind: "owner", via: ["alice"] })).toBe("Owns the object");
  });
});

describe("launchInput", () => {
  it("opens the object view from the sidebar menus", () => {
    expect(launchInput({ command: "table-access", params: { entity: { type: "table", schema: "app", name: "orders" } } } as never)).toEqual({
      kind: "object",
      object: { type: "table", schema: "app", name: "orders" },
    });
    expect(launchInput({ command: "schema-access", params: { entity: { type: "schema", name: "app" } } } as never)).toEqual({
      kind: "object",
      object: { type: "schema", name: "app" },
    });
    expect(launchInput({ command: "manage-users" })).toEqual({ kind: "manage" });
    expect(launchInput(undefined)).toEqual({ kind: "manage" });
  });
});
