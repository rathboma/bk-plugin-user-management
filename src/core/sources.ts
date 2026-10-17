import type { PrivilegeSource } from "../engines/types";

/** One line describing a privilege source, e.g. "through readers → app_read". */
export function describeSource(source: PrivilegeSource): string {
  const chain = source.via && source.via.length > 1 ? source.via.slice(1).join(" → ") : "";
  const viaRole = (text: string) => (chain ? `${text} through ${chain}` : text);
  const setRole = source.needsSetRole ? " (only after SET ROLE)" : "";
  switch (source.kind) {
    case "superuser":
      return "Superuser: permission checks are skipped";
    case "owner":
      return viaRole(chain ? "Owner role" : "Owns the object") + setRole;
    case "direct":
      return `Granted directly${source.grantable ? ", with grant option" : ""}`;
    case "inherited":
      return `Granted to ${source.grantee}${chain && source.via!.length > 2 ? `, through ${chain}` : ""}${setRole}`;
    case "predefined":
      return `Predefined role ${source.grantee}${chain && source.via!.length > 2 ? `, through ${chain}` : ""}${setRole}`;
    case "public":
      return "Granted to PUBLIC (every role)";
    default:
      return source.note ?? "Granted in a way this view can't trace";
  }
}
