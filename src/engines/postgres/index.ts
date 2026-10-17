import type { UserManagementEngine } from "../types";
import { capabilities } from "./capabilities";
import { listColumns, listMemberships, listObjects, listPrincipals, listSchemas, loadDetail, loadServerInfo } from "./catalog";
import {
  planCreate,
  planDrop,
  planGrants,
  planMemberships,
  planSettings,
  planTerminateSessions,
  planUpdate,
  script,
  validateName,
} from "./ddl";
import { checkAccess, diagnoseLogin, dropInfo, objectAccess } from "./debug";
import { effectivePrivileges } from "./privileges";

export const postgres: UserManagementEngine = {
  id: "postgresql",
  displayName: "PostgreSQL",
  connectionTypes: ["postgresql"],
  docsUrl: "https://www.postgresql.org/docs/current/user-manag.html",

  loadServerInfo,
  capabilities,
  validateName: (name) => validateName(name),

  listPrincipals,
  listMemberships,
  loadDetail,
  listSchemas: (run) => listSchemas(run),
  listObjects,
  listColumns: (run, _server, table) => listColumns(run, table),

  effectivePrivileges,
  objectAccess,
  checkAccess,
  diagnoseLogin,
  dropInfo,

  planCreate,
  planUpdate,
  planDrop,
  planMemberships,
  planGrants,
  planSettings,
  planTerminateSessions,
  script,

  // One request runs as one implicit transaction: if any statement fails,
  // the earlier ones are rolled back and the pooled connection stays clean.
  // Explicit BEGIN/COMMIT would leave the connection in an aborted
  // transaction after an error.
  async execute(run, plan) {
    if (!plan.statements.length) return;
    await run(plan.statements.map((s) => `${s.sql};`).join("\n"));
  },
};
