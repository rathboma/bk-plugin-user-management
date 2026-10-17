import type { ObjectRef } from "../engines/types";

/** A readable name, e.g. public.orders or public.total(integer). */
export function objectLabel(object: ObjectRef): string {
  const name = object.schema ? `${object.schema}.${object.name}` : object.name;
  return object.type === "function" ? `${name}(${object.signature ?? ""})` : name;
}

export function objectKey(object: ObjectRef): string {
  return JSON.stringify([object.type, object.schema ?? null, object.name, object.signature ?? null]);
}

export function sameObject(a: ObjectRef | undefined, b: ObjectRef | undefined): boolean {
  return !!a && !!b && objectKey(a) === objectKey(b);
}
