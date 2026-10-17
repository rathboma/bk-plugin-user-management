/**
 * One catalog query per object type, all returning the same columns:
 *
 *   oid, schema, name, signature, subtype, owner (oid), acl (aclitem[])
 *
 * `acl` falls back to the built-in default when the object has never been
 * granted on, so PUBLIC's default privileges (EXECUTE on functions, CONNECT
 * on databases...) show up like any other grant.
 */
import type { ObjectRef, ServerInfo } from "../types";
import { quoteIdent, quoteLiteral, quoteQualified } from "./sql";

export { objectLabel } from "../../core/objects";

interface ObjectSource {
  select(server: ServerInfo): string;
  /** has_*_privilege function for the type. */
  hasPrivilege: string;
  /** Keyword in GRANT ... ON <keyword>. */
  keyword(subtype?: string): string;
  /** Keyword in GRANT ... ON ALL <keyword> IN SCHEMA. */
  allKeyword?: string;
  /** Keyword in ALTER DEFAULT PRIVILEGES ... ON <keyword>. */
  defaultsKeyword?: string;
  /** pg_default_acl.defaclobjtype. */
  defaultsCode?: string;
}

/** Schemas that hold PostgreSQL's own objects. */
export function userSchemaFilter(column: string): string {
  return `${column} NOT IN ('pg_catalog', 'information_schema') AND ${column} NOT LIKE 'pg\\_toast%' AND ${column} NOT LIKE 'pg\\_temp\\_%'`;
}

function notExtensionMember(catalog: string, column: string): string {
  return `NOT EXISTS (SELECT 1 FROM pg_depend dep WHERE dep.classid = '${catalog}'::regclass AND dep.objid = ${column} AND dep.deptype = 'e')`;
}

const SOURCES: Record<string, ObjectSource> = {
  table: {
    select: () => `
      SELECT c.oid, n.nspname AS schema, c.relname AS name, NULL::text AS signature,
        CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized view' WHEN 'f' THEN 'foreign table'
          WHEN 'p' THEN 'partitioned table' ELSE 'table' END AS subtype,
        c.relowner AS owner, coalesce(c.relacl, acldefault('r', c.relowner)) AS acl
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f') AND ${userSchemaFilter("n.nspname")}`,
    hasPrivilege: "has_table_privilege",
    keyword: () => "TABLE",
    allKeyword: "TABLES",
    defaultsKeyword: "TABLES",
    defaultsCode: "r",
  },
  sequence: {
    select: () => `
      SELECT c.oid, n.nspname AS schema, c.relname AS name, NULL::text AS signature, 'sequence' AS subtype,
        c.relowner AS owner, coalesce(c.relacl, acldefault('s', c.relowner)) AS acl
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'S' AND ${userSchemaFilter("n.nspname")}`,
    hasPrivilege: "has_sequence_privilege",
    keyword: () => "SEQUENCE",
    allKeyword: "SEQUENCES",
    defaultsKeyword: "SEQUENCES",
    defaultsCode: "S",
  },
  function: {
    select: (server) => {
      const kind =
        server.version >= 110000
          ? "p.prokind::text"
          : "CASE WHEN p.proisagg THEN 'a' WHEN p.proiswindow THEN 'w' ELSE 'f' END";
      return `
      SELECT p.oid, n.nspname AS schema, p.proname AS name, pg_get_function_identity_arguments(p.oid) AS signature,
        CASE ${kind} WHEN 'p' THEN 'procedure' WHEN 'a' THEN 'aggregate' WHEN 'w' THEN 'window function' ELSE 'function' END AS subtype,
        p.proowner AS owner, coalesce(p.proacl, acldefault('f', p.proowner)) AS acl
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE ${userSchemaFilter("n.nspname")} AND ${notExtensionMember("pg_proc", "p.oid")}`;
    },
    hasPrivilege: "has_function_privilege",
    keyword: (subtype) => (subtype === "procedure" ? "PROCEDURE" : "FUNCTION"),
    allKeyword: "FUNCTIONS",
    defaultsKeyword: "FUNCTIONS",
    defaultsCode: "f",
  },
  type: {
    select: () => `
      SELECT t.oid, n.nspname AS schema, t.typname AS name, NULL::text AS signature,
        CASE t.typtype WHEN 'd' THEN 'domain' WHEN 'e' THEN 'enum' WHEN 'r' THEN 'range' WHEN 'c' THEN 'composite'
          WHEN 'm' THEN 'multirange' ELSE 'base' END AS subtype,
        t.typowner AS owner, coalesce(t.typacl, acldefault('T', t.typowner)) AS acl
      FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE t.typtype IN ('b', 'c', 'd', 'e', 'r', 'm') AND t.typcategory <> 'A'
        AND (t.typtype <> 'c' OR EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = t.typrelid AND c.relkind = 'c'))
        AND ${userSchemaFilter("n.nspname")} AND ${notExtensionMember("pg_type", "t.oid")}`,
    hasPrivilege: "has_type_privilege",
    keyword: () => "TYPE",
    defaultsKeyword: "TYPES",
    defaultsCode: "T",
  },
  schema: {
    select: () => `
      SELECT n.oid, NULL::text AS schema, n.nspname AS name, NULL::text AS signature, 'schema' AS subtype,
        n.nspowner AS owner, coalesce(n.nspacl, acldefault('n', n.nspowner)) AS acl
      FROM pg_namespace n
      WHERE ${userSchemaFilter("n.nspname")}`,
    hasPrivilege: "has_schema_privilege",
    keyword: () => "SCHEMA",
    defaultsKeyword: "SCHEMAS",
    defaultsCode: "n",
  },
  database: {
    select: () => `
      SELECT d.oid, NULL::text AS schema, d.datname AS name, NULL::text AS signature, 'database' AS subtype,
        d.datdba AS owner, coalesce(d.datacl, acldefault('d', d.datdba)) AS acl
      FROM pg_database d
      WHERE NOT d.datistemplate`,
    hasPrivilege: "has_database_privilege",
    keyword: () => "DATABASE",
  },
  language: {
    select: () => `
      SELECT l.oid, NULL::text AS schema, l.lanname AS name, NULL::text AS signature, 'language' AS subtype,
        l.lanowner AS owner, coalesce(l.lanacl, acldefault('l', l.lanowner)) AS acl
      FROM pg_language l
      WHERE l.lanname NOT IN ('internal', 'c')`,
    hasPrivilege: "has_language_privilege",
    keyword: () => "LANGUAGE",
  },
  fdw: {
    select: () => `
      SELECT w.oid, NULL::text AS schema, w.fdwname AS name, NULL::text AS signature, 'foreign data wrapper' AS subtype,
        w.fdwowner AS owner, coalesce(w.fdwacl, acldefault('F', w.fdwowner)) AS acl
      FROM pg_foreign_data_wrapper w`,
    hasPrivilege: "has_foreign_data_wrapper_privilege",
    keyword: () => "FOREIGN DATA WRAPPER",
  },
  server: {
    select: () => `
      SELECT s.oid, NULL::text AS schema, s.srvname AS name, NULL::text AS signature, 'foreign server' AS subtype,
        s.srvowner AS owner, coalesce(s.srvacl, acldefault('S', s.srvowner)) AS acl
      FROM pg_foreign_server s`,
    hasPrivilege: "has_server_privilege",
    keyword: () => "FOREIGN SERVER",
  },
  tablespace: {
    select: () => `
      SELECT s.oid, NULL::text AS schema, s.spcname AS name, NULL::text AS signature, 'tablespace' AS subtype,
        s.spcowner AS owner, coalesce(s.spcacl, acldefault('t', s.spcowner)) AS acl
      FROM pg_tablespace s`,
    hasPrivilege: "has_tablespace_privilege",
    keyword: () => "TABLESPACE",
  },
};

export const OBJECT_TYPE_IDS = Object.keys(SOURCES);

export function source(type: string): ObjectSource {
  const s = SOURCES[type];
  if (!s) throw new Error(`Unknown object type: ${type}`);
  return s;
}

/** The catalog query for a type, optionally narrowed to a schema or one object. */
export function objectsSql(server: ServerInfo, type: string, filter: { schema?: string; object?: ObjectRef } = {}): string {
  const where: string[] = [];
  const schema = filter.object?.schema ?? filter.schema;
  if (schema !== undefined && isSchemaScoped(type)) where.push(`o.schema = ${quoteLiteral(schema)}`);
  if (filter.object) {
    where.push(`o.name = ${quoteLiteral(filter.object.name)}`);
    if (filter.object.signature !== undefined) where.push(`o.signature = ${quoteLiteral(filter.object.signature)}`);
  }
  return `SELECT * FROM (${source(type).select(server)}) o${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`;
}

export function isSchemaScoped(type: string): boolean {
  return ["table", "sequence", "function", "type"].includes(type);
}

/** The object as written in GRANT ... ON <here>. */
export function objectClause(object: ObjectRef): string {
  const keyword = source(object.type).keyword(object.subtype);
  const name = isSchemaScoped(object.type) ? quoteQualified(object.schema, object.name) : quoteIdent(object.name);
  const signature = object.type === "function" ? `(${object.signature ?? ""})` : "";
  return `${keyword} ${name}${signature}`;
}

/** JSON array of the object's ACL entries with role names, for a SELECT list. */
export function aclJson(aclColumn: string): string {
  return `(SELECT coalesce(json_agg(json_build_object(
      'grantee', coalesce(ge.rolname, 'public'),
      'grantor', gr.rolname,
      'privilege', a.privilege_type,
      'grantable', a.is_grantable)), '[]'::json)
    FROM aclexplode(${aclColumn}) a
    LEFT JOIN pg_roles ge ON ge.oid = a.grantee
    LEFT JOIN pg_roles gr ON gr.oid = a.grantor)`;
}
