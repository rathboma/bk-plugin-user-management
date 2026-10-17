import { inject, type InjectionKey } from "vue";
import type { Manager } from "./manager";

export const ManagerKey: InjectionKey<Manager> = Symbol("manager");

export function useManager(): Manager {
  const manager = inject(ManagerKey);
  if (!manager) throw new Error("useManager() called outside the app");
  return manager;
}
