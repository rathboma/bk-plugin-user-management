import type { PrivilegeSource, PrivilegeSourceKind } from "../engines/types";

/** Letters for privilege sources in the Access grids and Debug. */
export const SOURCE_LETTERS: Record<PrivilegeSourceKind, string> = {
  direct: "D",
  inherited: "R",
  owner: "O",
  public: "P",
  predefined: "B",
  superuser: "S",
  unknown: "?",
};

/** One line describing a privilege source, e.g. "through readers → app_read". */
export function describeSource(source: PrivilegeSource): string {
  const chain = source.via && source.via.length > 1 ? source.via.slice(1).join(" → ") : "";
  const viaRole = (text: string) => (chain ? `${text} through ${chain}` : text);
  const setRole = source.needsSetRole ? ", usable only after SET ROLE" : "";
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
