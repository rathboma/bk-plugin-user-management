/**
 * The database-neutral model the UI works with. Every database family gets an
 * adapter implementing {@link UserManagementEngine}; the components only ever
 * see the types in this file.
 */

/** A single result set, as returned by Beekeeper Studio's `runQuery`. */
export interface QueryResultLike {
  fields: { id?: string; name: string; dataType?: string }[];
  rows: Record<string, unknown>[];
}

/** Runs SQL through the host application and returns every result set. */
export type RunQuery = (sql: string) => Promise<QueryResultLike[]>;

export type Tone = "danger" | "warning" | "info" | "success" | "neutral";

export interface Badge {
  label: string;
  tone: Tone;
  title?: string;
}

export interface ServerInfo {
  /** Engine-specific numeric version, e.g. 170002 for PostgreSQL 17.2. */
  version: number;
  versionLabel: string;
  database: string;
  currentUser: string;
  /** Skips every permission check. */
  isSuperuser: boolean;
  /** Can create principals and change at least some of them. */
  canManagePrincipals: boolean;
  /** Engine-specific settings, e.g. password_encryption. */
  settings: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Principals: users, roles, logins, groups...
// ---------------------------------------------------------------------------

export type AttributeValue = string | number | boolean | null;

/** A group of principals in the sidebar, e.g. "Users" and "Roles". */
export interface KindDef {
  id: string;
  /** Plural, used for the sidebar heading. */
  label: string;
  singular: string;
  description: string;
  /** Attribute values a new principal of this kind starts with. */
  defaults?: Record<string, AttributeValue>;
}

export type AttributeType = "boolean" | "text" | "number" | "datetime" | "select";

/**
 * Describes one property of a principal so the create and edit forms can be
 * rendered without knowing the database.
 */
export interface AttributeDef {
  id: string;
  label: string;
  description?: string;
  type: AttributeType;
  /** Heading the attribute is listed under. */
  group: string;
  options?: { value: string; label: string }[];
  placeholder?: string;
  /** Value for new principals when the kind has no default. */
  default?: AttributeValue;
  /** Kinds the attribute applies to; all kinds when absent. */
  kinds?: string[];
  /** Can be set by CREATE. Defaults to true. */
  create?: boolean;
  /** Can be changed afterwards. Defaults to true. */
  editable?: boolean;
  /** Grants broad power, e.g. SUPERUSER. Shown with a warning colour. */
  dangerous?: boolean;
  min?: number;
}

export interface Principal {
  /** Stable key, unique on the server. PostgreSQL: the role name. */
  id: string;
  name: string;
  kind: string;
  /** Built in or managed by the database or the cloud provider. */
  system: boolean;
  attributes: Record<string, AttributeValue>;
  comment: string | null;
  badges: Badge[];
  /** Open connections, when the engine can count them. */
  sessions?: number;
  /** "set", "none", "md5", "scram-sha-256"... or "unknown" without the rights to read it. */
  passwordState?: string;
}

export type PasswordChange = { action: "keep" } | { action: "set"; value: string } | { action: "remove" };

/** What the create and edit forms produce. */
export interface PrincipalDraft {
  name: string;
  kind: string;
  attributes: Record<string, AttributeValue>;
  comment: string | null;
  password: PasswordChange;
  /** Roles to join, when creating. */
  memberOf?: string[];
}

// ---------------------------------------------------------------------------
// Memberships
// ---------------------------------------------------------------------------

/** `member` belongs to `role`. */
export interface Membership {
  role: string;
  member: string;
  grantor?: string;
  /** Option values by {@link MembershipOptionDef} id, e.g. admin, inherit, set. */
  options: Record<string, boolean>;
}

export interface MembershipOptionDef {
  id: string;
  label: string;
  description: string;
  default: boolean;
}

export type MembershipChange =
  | { action: "add"; role: string; member: string; options: Record<string, boolean> }
  | { action: "remove"; membership: Membership }
  | { action: "update"; membership: Membership; options: Record<string, boolean> };

// ---------------------------------------------------------------------------
// Objects and privileges
// ---------------------------------------------------------------------------

export interface PrivilegeDef {
  id: string;
  label: string;
  description?: string;
  minServerVersion?: number;
}

export interface ObjectTypeDef {
  id: string;
  label: string;
  plural: string;
  privileges: PrivilegeDef[];
  /** Objects of this type live in a schema. */
  schemaScoped: boolean;
  /** Supports granting on every object of the type in a schema at once. */
  allInSchema?: boolean;
  /** Supports default privileges for objects created later. */
  defaults?: boolean;
  /** Privileges that can be granted on individual columns. */
  columnPrivileges?: string[];
  /** Listed in the effective privileges browser. */
  browse?: boolean;
}

export interface ObjectRef {
  type: string;
  schema?: string;
  name: string;
  /** Extra identity, e.g. a function's argument types. */
  signature?: string;
  /** Engine-specific sub-type, e.g. "view" or "procedure". */
  subtype?: string;
}

/** A privilege granted directly to a principal. */
export interface GrantEntry {
  object: ObjectRef;
  column?: string;
  privilege: string;
  grantee: string;
  grantor?: string;
  grantable: boolean;
}

/** A privilege that will be granted on objects created later. */
export interface DefaultGrant {
  /** Applies to objects created by this principal. */
  owner: string;
  schema?: string;
  objectType: string;
  grantee: string;
  privilege: string;
  grantable: boolean;
}

export type GrantTarget =
  | { kind: "object"; object: ObjectRef; columns?: string[] }
  | { kind: "all-in-schema"; objectType: string; schema: string }
  | { kind: "default"; objectType: string; schema?: string; owner: string };

export interface GrantChange {
  action: "grant" | "revoke";
  target: GrantTarget;
  privileges: string[];
  grantee: string;
  withGrantOption?: boolean;
  /** Also revoke grants that depend on this one. */
  cascade?: boolean;
}

export type PrivilegeSourceKind = "superuser" | "owner" | "direct" | "inherited" | "public" | "predefined" | "unknown";

/** One reason a principal holds a privilege. */
export interface PrivilegeSource {
  kind: PrivilegeSourceKind;
  /** Membership chain, starting with the principal itself. */
  via?: string[];
  /** The role holding the grant. */
  grantee?: string;
  grantable?: boolean;
  /** Only after switching role (SET ROLE), not automatically. */
  needsSetRole?: boolean;
  note?: string;
}

export interface PrivilegeCell {
  allowed: boolean;
  sources: PrivilegeSource[];
}

export interface ObjectPrivileges {
  object: ObjectRef;
  owner?: string;
  cells: Record<string, PrivilegeCell>;
}

export interface EffectivePrivileges {
  objectType: ObjectTypeDef;
  rows: ObjectPrivileges[];
  truncated: boolean;
}

export interface ObjectAccess {
  object: ObjectRef;
  objectType: ObjectTypeDef;
  owner?: string;
  rows: { principal: string; cells: Record<string, PrivilegeCell> }[];
  notes: Check[];
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export type CheckStatus = "ok" | "warn" | "fail" | "info" | "unknown";

export interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  detail?: string;
  /** Statements that fix the problem, offered as a button. */
  fix?: ChangePlan;
}

export interface AccessCheckRequest {
  principal: string;
  object: ObjectRef;
  privilege: string;
}

export interface AccessCheckResult {
  allowed: boolean;
  summary: string;
  cell: PrivilegeCell;
  /** Everything that has to be true for the access to work. */
  checks: Check[];
  fixes: ChangePlan[];
}

// ---------------------------------------------------------------------------
// Details shown for the selected principal
// ---------------------------------------------------------------------------

export interface SettingEntry {
  name: string;
  value: string;
  /** Only applies in this database. */
  database?: string;
}

export type SettingChange =
  | { action: "set"; name: string; value: string; database?: string }
  | { action: "reset"; name: string; database?: string };

export interface Session {
  id: string;
  database?: string;
  client?: string;
  application?: string;
  state?: string;
  startedAt?: string;
  queryStartedAt?: string;
  query?: string;
}

export interface PrincipalDetail {
  principal: Principal;
  grants: GrantEntry[];
  defaultGrants: DefaultGrant[];
  owned: ObjectRef[];
  ownedTruncated: boolean;
  settings: SettingEntry[];
  sessions: Session[];
}

export interface DropInfo {
  checks: Check[];
  /** Objects owned in the current database. */
  ownedCount: number;
  sessions: number;
  /** Options the drop needs to succeed, preselected in the dialog. */
  suggested: { reassign: boolean; dropOwned: boolean };
}

export interface DropOptions {
  /** Hand owned objects over to this principal first. */
  reassignTo?: string;
  /** Drop owned objects and revoke privileges in the current database first. */
  dropOwned: boolean;
  terminateSessions: boolean;
}

// ---------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------

export interface Statement {
  sql: string;
  /** The statement with secrets masked, for display. */
  display?: string;
}

/** A reviewed set of statements. Nothing runs without the user's approval. */
export interface ChangePlan {
  title: string;
  statements: Statement[];
  warnings: string[];
  /** Principal to select after the change, e.g. after a rename. */
  selectAfter?: string;
}

export interface Capabilities {
  kinds: KindDef[];
  attributes: AttributeDef[];
  password: { supported: boolean; kinds?: string[]; hint?: string };
  comments: boolean;
  rename: boolean;
  memberships: { supported: boolean; options: MembershipOptionDef[] };
  objectTypes: ObjectTypeDef[];
  /** The pseudo-principal meaning everyone, e.g. PostgreSQL's PUBLIC. */
  publicGrantee?: { id: string; label: string };
  settings: boolean;
  sessions: boolean;
  loginCheck: boolean;
  script: boolean;
  /** Hints for the drop options, or false when the database has no such step. */
  drop: { reassign: string | false; dropOwned: string | false };
  /** execute() runs a plan's statements all or nothing. */
  atomic: boolean;
  nameMaxLength?: number;
}

/** What the engine needs to explain privileges: every principal and membership. */
export interface AccessContext {
  principals: Principal[];
  memberships: Membership[];
}

/**
 * One implementation per database family.
 *
 * To add a database: implement this interface in `src/engines/<name>/` and
 * register it in `src/engines/registry.ts`. Methods named `plan*` build SQL
 * without touching the database, so they are easy to unit test; the UI shows
 * the plan for review and then calls {@link execute}.
 */
export interface UserManagementEngine {
  /** Stable id, usually the main Beekeeper Studio connection type. */
  id: string;
  displayName: string;
  /** Beekeeper Studio connection types this engine handles. */
  connectionTypes: string[];
  docsUrl?: string;

  loadServerInfo(run: RunQuery): Promise<ServerInfo>;
  capabilities(server: ServerInfo): Capabilities;
  /** Returns an error message for an invalid name. */
  validateName(name: string, server: ServerInfo): string | undefined;

  listPrincipals(run: RunQuery, server: ServerInfo): Promise<Principal[]>;
  listMemberships(run: RunQuery, server: ServerInfo): Promise<Membership[]>;
  loadDetail(run: RunQuery, server: ServerInfo, principal: Principal): Promise<PrincipalDetail>;
  listSchemas(run: RunQuery, server: ServerInfo): Promise<string[]>;
  listObjects(run: RunQuery, server: ServerInfo, type: string, schema?: string): Promise<ObjectRef[]>;
  listColumns(run: RunQuery, server: ServerInfo, table: ObjectRef): Promise<string[]>;

  effectivePrivileges(
    run: RunQuery,
    server: ServerInfo,
    ctx: AccessContext,
    principal: string,
    type: string,
    schema?: string
  ): Promise<EffectivePrivileges>;
  objectAccess(run: RunQuery, server: ServerInfo, ctx: AccessContext, object: ObjectRef): Promise<ObjectAccess>;
  checkAccess(run: RunQuery, server: ServerInfo, ctx: AccessContext, request: AccessCheckRequest): Promise<AccessCheckResult>;
  diagnoseLogin(run: RunQuery, server: ServerInfo, ctx: AccessContext, principal: Principal): Promise<Check[]>;
  dropInfo(run: RunQuery, server: ServerInfo, principal: Principal): Promise<DropInfo>;

  planCreate(draft: PrincipalDraft, server: ServerInfo): Promise<ChangePlan>;
  planUpdate(before: Principal, draft: PrincipalDraft, server: ServerInfo): Promise<ChangePlan>;
  planDrop(principal: Principal, options: DropOptions, server: ServerInfo): ChangePlan;
  planMemberships(changes: MembershipChange[], server: ServerInfo): ChangePlan;
  planGrants(changes: GrantChange[], server: ServerInfo): ChangePlan;
  planSettings(principal: Principal, changes: SettingChange[], server: ServerInfo): ChangePlan;
  planTerminateSessions(sessions: Session[], server: ServerInfo): ChangePlan;
  /** SQL that recreates the principal, optionally under another name. */
  script(detail: PrincipalDetail, memberships: Membership[], server: ServerInfo, options?: { name?: string }): string;

  /** Runs a reviewed plan, all or nothing where the database allows it. */
  execute(run: RunQuery, plan: ChangePlan): Promise<void>;
}
