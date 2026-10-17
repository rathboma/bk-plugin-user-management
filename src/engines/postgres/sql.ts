/**
 * Quoting and value helpers for the SQL the PostgreSQL engine builds. Every
 * name and value that reaches a statement goes through quoteIdent or
 * quoteLiteral.
 */

/** Keywords that can't be used as bare identifiers (pg_get_keywords() catcode <> 'U'). */
const KEYWORDS = new Set(
  (
    "all analyse analyze and any array as asc asymmetric authorization between bigint binary bit boolean both " +
    "case cast char character check coalesce collate collation column concurrently constraint create cross " +
    "current_catalog current_date current_role current_schema current_time current_timestamp current_user dec " +
    "decimal default deferrable desc distinct do else end except exists extract false fetch float for foreign " +
    "freeze from full grant greatest group grouping having ilike in initially inner inout int integer intersect " +
    "interval into is isnull join json json_array json_arrayagg json_exists json_object json_objectagg json_query " +
    "json_scalar json_serialize json_table json_value lateral leading least left like limit localtime " +
    "localtimestamp merge_action national natural nchar none normalize not notnull null nullif numeric offset on " +
    "only or order out outer overlaps overlay placing position precision primary real references returning right " +
    "row select session_user setof similar smallint some substring symmetric system_user table tablesample then " +
    "time timestamp to trailing treat trim true union unique user using values varchar variadic verbose when " +
    "where window with xmlattributes xmlconcat xmlelement xmlexists xmlforest xmlnamespaces xmlparse xmlpi " +
    "xmlroot xmlserialize xmltable"
  ).split(" ")
);

/** The grantee name used for PostgreSQL's PUBLIC pseudo-role. No real role can be called "public". */
export const PUBLIC = "public";

/** Quotes an identifier when PostgreSQL would otherwise change or reject it. */
export function quoteIdent(name: string): string {
  if (/^[a-z_][a-z0-9_$]*$/.test(name) && !KEYWORDS.has(name)) return name;
  return `"${name.replace(/"/g, '""')}"`;
}

/** A role in GRANT, REVOKE or ALTER DEFAULT PRIVILEGES. */
export function quoteRole(name: string): string {
  return name === PUBLIC ? "PUBLIC" : quoteIdent(name);
}

export function quoteQualified(schema: string | undefined, name: string): string {
  return schema ? `${quoteIdent(schema)}.${quoteIdent(name)}` : quoteIdent(name);
}

/**
 * Quotes a string literal. Values with backslashes use the E'' form, which
 * reads the same whatever standard_conforming_strings is set to.
 */
export function quoteLiteral(value: string): string {
  if (value.includes("\\")) return `E'${value.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
  return `'${value.replace(/'/g, "''")}'`;
}

/** `IN (...)` list of literals; `IN (NULL)` matches nothing. */
export function literalList(values: string[]): string {
  return values.length ? values.map(quoteLiteral).join(", ") : "NULL";
}

/** Bytes PostgreSQL keeps of a name (NAMEDATALEN - 1). Longer names are truncated. */
export const MAX_NAME_BYTES = 63;

export function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

// ---------------------------------------------------------------------------
// Reading values. Beekeeper Studio's driver settings decide how some types
// arrive (timestamps as text, json parsed or not), so readers accept both.
// ---------------------------------------------------------------------------

export function str(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return String(value);
}

export function bool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "t" || value === "true" || value === "1";
  if (typeof value === "number") return value !== 0;
  return false;
}

export function num(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function json<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}
