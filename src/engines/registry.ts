import type { UserManagementEngine } from "./types";
import { postgres } from "./postgres";

/**
 * Every supported database. To add one, implement {@link UserManagementEngine}
 * in `src/engines/<name>/` and list it here.
 */
export const ENGINES: UserManagementEngine[] = [postgres];

export function engineForConnection(connectionType: string | undefined): UserManagementEngine | undefined {
  if (!connectionType) return undefined;
  return ENGINES.find((engine) => engine.connectionTypes.includes(connectionType));
}

export function supportedDatabaseNames(): string {
  return ENGINES.map((e) => e.displayName).join(", ");
}

const DATABASE_NAMES: Record<string, string> = {
  postgresql: "PostgreSQL",
  mysql: "MySQL",
  mariadb: "MariaDB",
  sqlite: "SQLite",
  sqlserver: "SQL Server",
  oracle: "Oracle",
  cockroachdb: "CockroachDB",
  redshift: "Redshift",
  bigquery: "BigQuery",
  clickhouse: "ClickHouse",
  duckdb: "DuckDB",
  libsql: "LibSQL",
  firebird: "Firebird",
  mongodb: "MongoDB",
  cassandra: "Cassandra",
  trino: "Trino",
  snowflake: "Snowflake",
};

/** A readable name for a Beekeeper Studio connection type. */
export function databaseName(connectionType: string | undefined): string {
  if (!connectionType) return "This database";
  return DATABASE_NAMES[connectionType] ?? connectionType;
}
