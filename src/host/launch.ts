import type { ObjectRef } from "../engines/types";
import type { PluginViewContext } from "./host";

/** What the tab was opened for, worked out from the menu that opened it. */
export type LaunchInput = { kind: "manage" } | { kind: "object"; object: ObjectRef };

type Entity = { type?: string; schema?: string; name?: string };

export function launchInput(context: PluginViewContext | undefined): LaunchInput {
  const entity = (context?.params as { entity?: Entity } | undefined)?.entity;
  if (entity?.name) {
    if (context?.command === "table-access" || entity.type === "table") {
      return { kind: "object", object: { type: "table", schema: entity.schema || undefined, name: entity.name } };
    }
    if (context?.command === "schema-access" || entity.type === "schema") {
      return { kind: "object", object: { type: "schema", name: entity.name } };
    }
  }
  return { kind: "manage" };
}
