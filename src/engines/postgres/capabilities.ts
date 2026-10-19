import type { AttributeDef, Capabilities, ObjectTypeDef, ServerInfo } from "../types";
import { MAX_NAME_BYTES, PUBLIC } from "./sql";

export const PG16 = 160000;

/** PostgreSQL role attributes, keyed by the id used in Principal.attributes. */
export function attributeDefs(server: ServerInfo): AttributeDef[] {
  const pg16 = server.version >= PG16;
  return [
    {
      id: "login",
      label: "Can log in",
      description: "LOGIN. Roles that can log in are listed as users.",
      type: "boolean",
      group: "Login",
    },
    {
      id: "validUntil",
      label: "Password expires",
      description: "VALID UNTIL. After this time the password stops working. Other login methods are not affected.",
      type: "datetime",
      group: "Login",
      placeholder: "Never",
      kinds: ["user"],
      default: null,
    },
    {
      id: "connectionLimit",
      label: "Connection limit",
      description: "CONNECTION LIMIT. -1 means no limit.",
      type: "number",
      group: "Login",
      min: -1,
      default: -1,
      kinds: ["user"],
    },
    {
      id: "superuser",
      label: "Superuser",
      description: "SUPERUSER. Bypasses every permission check.",
      type: "boolean",
      group: "Privileges",
      dangerous: true,
      default: false,
    },
    {
      id: "createdb",
      label: "Create databases",
      description: "CREATEDB.",
      type: "boolean",
      group: "Privileges",
      default: false,
    },
    {
      id: "createrole",
      label: "Create roles",
      description: pg16
        ? "CREATEROLE. Can create roles, and change the roles it has ADMIN on."
        : "CREATEROLE. Can create, change and drop any role that isn't a superuser.",
      type: "boolean",
      group: "Privileges",
      dangerous: !pg16,
      default: false,
    },
    {
      id: "replication",
      label: "Replication",
      description: "REPLICATION. Can start streaming replication and create replication slots.",
      type: "boolean",
      group: "Privileges",
      dangerous: true,
      default: false,
    },
    {
      id: "bypassrls",
      label: "Bypass row level security",
      description: "BYPASSRLS. Row level security policies don't apply.",
      type: "boolean",
      group: "Privileges",
      dangerous: true,
      default: false,
    },
    {
      id: "inherit",
      label: "Inherit privileges",
      description: pg16
        ? "INHERIT. Default for new memberships: use a role's privileges without SET ROLE."
        : "INHERIT. Use the privileges of the roles it belongs to without SET ROLE.",
      type: "boolean",
      group: "Privileges",
      default: true,
    },
  ];
}

const p = (id: string, label: string, description?: string, minServerVersion?: number) => ({
  id,
  label,
  description,
  minServerVersion,
});

export const OBJECT_TYPES: ObjectTypeDef[] = [
  {
    id: "table",
    label: "Table or view",
    plural: "Tables & views",
    schemaScoped: true,
    allInSchema: true,
    defaults: true,
    columnPrivileges: ["SELECT", "INSERT", "UPDATE", "REFERENCES"],
    browse: true,
    privileges: [
      p("SELECT", "Select", "Read rows"),
      p("INSERT", "Insert", "Add rows"),
      p("UPDATE", "Update", "Change rows"),
      p("DELETE", "Delete", "Remove rows"),
      p("TRUNCATE", "Truncate", "Empty the table"),
      p("REFERENCES", "References", "Create foreign keys to it"),
      p("TRIGGER", "Trigger", "Create triggers on it"),
      p("MAINTAIN", "Maintain", "VACUUM, ANALYZE, REINDEX, REFRESH and similar", 170000),
    ],
  },
  {
    id: "schema",
    label: "Schema",
    plural: "Schemas",
    schemaScoped: false,
    defaults: true,
    browse: true,
    privileges: [p("USAGE", "Usage", "Look up objects in the schema"), p("CREATE", "Create", "Create objects in the schema")],
  },
  {
    id: "database",
    label: "Database",
    plural: "Databases",
    schemaScoped: false,
    browse: true,
    privileges: [
      p("CONNECT", "Connect", "Connect to the database"),
      p("CREATE", "Create", "Create schemas and publications"),
      p("TEMPORARY", "Temporary", "Create temporary tables"),
    ],
  },
  {
    id: "sequence",
    label: "Sequence",
    plural: "Sequences",
    schemaScoped: true,
    allInSchema: true,
    defaults: true,
    browse: true,
    privileges: [
      p("USAGE", "Usage", "currval and nextval"),
      p("SELECT", "Select", "currval"),
      p("UPDATE", "Update", "nextval and setval"),
    ],
  },
  {
    id: "function",
    label: "Function or procedure",
    plural: "Functions & procedures",
    schemaScoped: true,
    allInSchema: true,
    defaults: true,
    browse: true,
    privileges: [p("EXECUTE", "Execute", "Call it")],
  },
  {
    id: "type",
    label: "Type or domain",
    plural: "Types & domains",
    schemaScoped: true,
    defaults: true,
    privileges: [p("USAGE", "Usage", "Use it in tables and functions")],
  },
  {
    id: "language",
    label: "Language",
    plural: "Languages",
    schemaScoped: false,
    privileges: [p("USAGE", "Usage", "Create functions in it")],
  },
  {
    id: "fdw",
    label: "Foreign data wrapper",
    plural: "Foreign data wrappers",
    schemaScoped: false,
    privileges: [p("USAGE", "Usage", "Create servers with it")],
  },
  {
    id: "server",
    label: "Foreign server",
    plural: "Foreign servers",
    schemaScoped: false,
    privileges: [p("USAGE", "Usage", "Create foreign tables and user mappings")],
  },
  {
    id: "tablespace",
    label: "Tablespace",
    plural: "Tablespaces",
    schemaScoped: false,
    privileges: [p("CREATE", "Create", "Store tables and indexes in it")],
  },
];

/** Object types with the privileges the server supports. */
export function objectTypes(server: ServerInfo): ObjectTypeDef[] {
  return OBJECT_TYPES.map((t) => ({
    ...t,
    privileges: t.privileges.filter((priv) => !priv.minServerVersion || server.version >= priv.minServerVersion),
  }));
}

export function objectType(server: ServerInfo, id: string): ObjectTypeDef {
  const type = objectTypes(server).find((t) => t.id === id);
  if (!type) throw new Error(`Unknown object type: ${id}`);
  return type;
}

export function capabilities(server: ServerInfo): Capabilities {
  const pg16 = server.version >= PG16;
  return {
    kinds: [
      {
        id: "user",
        label: "Users",
        singular: "User",
        description: "Roles that can log in.",
        defaults: { login: true },
      },
      {
        id: "role",
        label: "Roles",
        singular: "Role",
        description: "Groups of privileges that users and other roles can belong to.",
        defaults: { login: false },
      },
    ],
    attributes: attributeDefs(server),
    password: {
      supported: true,
      kinds: ["user"],
      hint: "Hashed in the plugin before it is sent, so the plain text never reaches the server or its logs.",
    },
    comments: true,
    rename: true,
    memberships: {
      supported: true,
      options: [
        {
          id: "admin",
          label: "Admin",
          description: pg16
            ? "ADMIN OPTION. Can grant the role to others and revoke it."
            : "ADMIN OPTION. Can grant the role to others, revoke it and comment on it.",
          default: false,
        },
        ...(pg16
          ? [
              {
                id: "inherit",
                label: "Inherit",
                description: "INHERIT. Uses the role's privileges automatically.",
                default: true,
              },
              {
                id: "set",
                label: "Set role",
                description: "SET. Can switch to the role with SET ROLE.",
                default: true,
              },
            ]
          : []),
      ],
    },
    objectTypes: objectTypes(server),
    publicGrantee: { id: PUBLIC, label: "PUBLIC (every role)" },
    settingSuggestions: [
      "search_path",
      "statement_timeout",
      "work_mem",
      "timezone",
      "lock_timeout",
      "idle_in_transaction_session_timeout",
      "default_transaction_read_only",
      "default_transaction_isolation",
      "role",
      "log_statement",
      "log_min_duration_statement",
      "application_name",
    ],
    settings: true,
    sessions: true,
    loginCheck: true,
    script: true,
    drop: {
      reassign: "REASSIGN OWNED, in this database and for shared objects such as databases.",
      dropOwned: "DROP OWNED: deletes the objects it still owns here, with their data, and revokes its privileges.",
    },
    atomic: true,
    nameMaxLength: MAX_NAME_BYTES,
  };
}
