import { computed, reactive, shallowRef } from "vue";
import { engineForConnection } from "../engines/registry";
import type {
  AccessContext,
  Capabilities,
  ChangePlan,
  Membership,
  MembershipChange,
  ObjectRef,
  Principal,
  PrincipalDetail,
  ServerInfo,
  UserManagementEngine,
} from "../engines/types";
import { errorMessage, type ConnectionInfo, type Host } from "../host/host";
import type { LaunchInput } from "../host/launch";

export type DetailTab = "overview" | "debug" | "memberships" | "grants" | "access" | "settings" | "sessions";
export type DebugMode = "access" | "login";

const TABS: DetailTab[] = ["overview", "debug", "memberships", "grants", "access", "settings", "sessions"];
export type View = "principals" | "object";

export type Dialog =
  | { type: "create"; kind: string }
  | { type: "edit"; password?: boolean }
  | { type: "duplicate" }
  | { type: "drop" }
  | { type: "script" }
  | { type: "grant"; grantee?: string; object?: ObjectRef; target?: "object" | "all-in-schema" | "default" }
  | { type: "membership"; direction: "memberOf" | "members" };

/** A request to check one privilege, set from anywhere and shown in the Debug tab. */
export interface AccessQuestion {
  object: ObjectRef;
  privilege: string;
}

/** What each tab remembers between restarts (Beekeeper Studio stores it). */
export interface SavedViewState {
  version: 1;
  view: View;
  selected?: string;
  tab: DetailTab;
  showSystem: boolean;
  object?: ObjectRef;
}

export interface Review {
  plan: ChangePlan;
  running: boolean;
  error: string;
  /** Applying it settles the pending membership edits. */
  fromPending?: boolean;
}

/** A membership option edit waiting for review, like a cell edit in a table tab. */
export interface PendingMembership {
  membership: Membership;
  options: Record<string, boolean>;
}

const membershipKey = (m: Membership) => JSON.stringify([m.role, m.member, m.grantor ?? null]);

export function createManager(
  host: Host,
  resolveEngine: (connectionType: string | undefined) => UserManagementEngine | undefined = engineForConnection
) {
  const state = reactive({
    status: "loading" as "loading" | "ready" | "error" | "unsupported" | "disconnected",
    error: "",
    connection: undefined as ConnectionInfo | undefined,
    server: undefined as ServerInfo | undefined,
    principals: [] as Principal[],
    memberships: [] as Membership[],
    loadingList: false,
    search: "",
    showSystem: false,
    view: "principals" as View,
    object: undefined as ObjectRef | undefined,
    selected: undefined as string | undefined,
    tab: "overview" as DetailTab,
    detail: undefined as PrincipalDetail | undefined,
    detailLoading: false,
    detailError: "",
    dialog: undefined as Dialog | undefined,
    review: undefined as Review | undefined,
    question: undefined as AccessQuestion | undefined,
    debugMode: "access" as DebugMode,
    /** Membership edits made on this principal and not applied yet. */
    pending: [] as PendingMembership[],
    pendingFor: undefined as string | undefined,
    /** Bumped after every applied change, so panels reload what they show. */
    revision: 0,
  });

  const engine = shallowRef<UserManagementEngine>();
  let detailRequest = 0;

  const caps = computed<Capabilities | undefined>(() =>
    engine.value && state.server ? engine.value.capabilities(state.server) : undefined
  );
  const readOnly = computed(() => state.connection?.readOnlyMode === true);
  const selectedPrincipal = computed(() => state.principals.find((p) => p.id === state.selected));
  const ctx = computed<AccessContext>(() => ({ principals: state.principals, memberships: state.memberships }));

  const run = (sql: string) => host.runQuery(sql);

  function need(): { engine: UserManagementEngine; server: ServerInfo } {
    if (!engine.value || !state.server) throw new Error("Not connected");
    return { engine: engine.value, server: state.server };
  }

  function saveViewState() {
    const saved: SavedViewState = {
      version: 1,
      view: state.view,
      selected: state.selected,
      tab: state.tab,
      showSystem: state.showSystem,
      object: state.object,
    };
    void host.saveViewState(saved);
  }

  async function loadList() {
    const { engine: e, server } = need();
    state.loadingList = true;
    try {
      const [principals, memberships] = await Promise.all([e.listPrincipals(run, server), e.listMemberships(run, server)]);
      state.principals = principals;
      state.memberships = memberships;
    } finally {
      state.loadingList = false;
    }
  }

  async function loadDetail() {
    const principal = selectedPrincipal.value;
    const request = ++detailRequest;
    if (!principal) {
      state.detail = undefined;
      return;
    }
    const { engine: e, server } = need();
    state.detailLoading = true;
    state.detailError = "";
    try {
      const detail = await e.loadDetail(run, server, principal);
      if (request === detailRequest) state.detail = detail;
    } catch (error) {
      if (request === detailRequest) {
        state.detail = undefined;
        state.detailError = errorMessage(error);
      }
    } finally {
      if (request === detailRequest) state.detailLoading = false;
    }
  }

  function updateTitle() {
    if (state.view === "object" && state.object) {
      void host.setTitle(`Access: ${state.object.name}`);
    } else {
      void host.setTitle(state.selected ? `Users & Roles: ${state.selected}` : "Users & Roles");
    }
  }

  async function init(launch: () => Promise<LaunchInput>) {
    try {
      const [connection, input, saved] = await Promise.all([
        host.connectionInfo(),
        launch(),
        host.viewState<SavedViewState>(),
      ]);
      state.connection = connection;
      engine.value = resolveEngine(connection?.databaseType ?? connection?.connectionType);
      if (!connection) {
        state.status = "disconnected";
        return;
      }
      if (!engine.value) {
        state.status = "unsupported";
        return;
      }
      state.server = await engine.value.loadServerInfo(run);
      await loadList();

      if (saved?.version === 1) {
        state.showSystem = saved.showSystem;
        // "effective" is the Access tab's old name.
        const tab = (saved.tab as string) === "effective" ? "access" : saved.tab;
        state.tab = TABS.includes(tab) ? tab : "overview";
        if (saved.selected && state.principals.some((p) => p.id === saved.selected)) state.selected = saved.selected;
        state.view = saved.view;
        state.object = saved.object;
      }
      if (input.kind === "object" && !saved) {
        state.view = "object";
        state.object = input.object;
      }
      if (!state.selected) {
        state.selected = state.principals.find((p) => !p.system && p.name === state.server?.currentUser)?.id ??
          state.principals.find((p) => !p.system)?.id;
      }
      state.status = "ready";
      updateTitle();
      await loadDetail();
    } catch (error) {
      state.status = "error";
      state.error = errorMessage(error);
    }
  }

  async function refresh() {
    try {
      state.server = await need().engine.loadServerInfo(run);
      await loadList();
      if (state.selected && !selectedPrincipal.value) state.selected = undefined;
      state.revision++;
      await loadDetail();
    } catch (error) {
      void host.notifyError(errorMessage(error));
    }
  }

  async function select(id: string | undefined) {
    if (id !== state.selected && state.pending.length) {
      const discard = await host.confirm(
        "Discard pending changes?",
        `${state.pending.length === 1 ? "1 membership change" : `${state.pending.length} membership changes`} for ${state.pendingFor} haven't been applied.`,
        "Discard"
      );
      if (discard === false) return;
      discardPending();
    }
    state.view = "principals";
    if (id === state.selected && state.detail) return;
    state.selected = id;
    state.question = undefined;
    state.detail = undefined;
    saveViewState();
    updateTitle();
    await loadDetail();
  }

  function setTab(tab: DetailTab) {
    state.tab = tab;
    saveViewState();
  }

  function showObject(object: ObjectRef | undefined) {
    state.view = "object";
    if (object) state.object = object;
    saveViewState();
    updateTitle();
  }

  function setShowSystem(show: boolean) {
    state.showSystem = show;
    saveViewState();
  }

  /** Opens the Debug tab with an access question filled in. */
  async function ask(principal: string, question: AccessQuestion) {
    await select(principal);
    if (state.selected !== principal) return;
    state.question = question;
    state.debugMode = "access";
    setTab("debug");
  }

  function setDebugMode(mode: DebugMode) {
    state.debugMode = mode;
  }

  /** Queues a membership option change; changing it back drops it from the queue. */
  function queueMembership(membership: Membership, option: string, value: boolean) {
    if (state.pendingFor && state.pendingFor !== state.selected) discardPending();
    state.pendingFor = state.selected;
    const key = membershipKey(membership);
    const existing = state.pending.find((p) => membershipKey(p.membership) === key);
    const options = { ...(existing?.options ?? membership.options), [option]: value };
    const unchanged = Object.keys(options).every((k) => (options[k] ?? false) === (membership.options[k] ?? false));
    state.pending = state.pending.filter((p) => membershipKey(p.membership) !== key);
    if (!unchanged) state.pending.push({ membership, options });
    if (!state.pending.length) state.pendingFor = undefined;
  }

  /** The pending value of a membership option, or undefined when it isn't changed. */
  function pendingOption(membership: Membership, option: string): boolean | undefined {
    const key = membershipKey(membership);
    const p = state.pending.find((x) => membershipKey(x.membership) === key);
    if (!p || (p.options[option] ?? false) === (membership.options[option] ?? false)) return undefined;
    return p.options[option];
  }

  function pendingPlan(): ChangePlan | undefined {
    if (!state.pending.length || !engine.value || !state.server) return undefined;
    const changes: MembershipChange[] = state.pending.map((p) => ({ action: "update", membership: p.membership, options: p.options }));
    return engine.value.planMemberships(changes, state.server);
  }

  /** Keeps queued edits in line with memberships changed or removed by another change. */
  function rebasePending() {
    state.pending = state.pending.flatMap((p) => {
      const fresh = state.memberships.find((x) => membershipKey(x) === membershipKey(p.membership));
      if (!fresh) return [];
      const changed = Object.keys(p.options).some((k) => (p.options[k] ?? false) !== (fresh.options[k] ?? false));
      return changed ? [{ membership: fresh, options: p.options }] : [];
    });
    if (!state.pending.length) state.pendingFor = undefined;
  }

  function discardPending() {
    state.pending = [];
    state.pendingFor = undefined;
  }

  function reviewPending() {
    const plan = pendingPlan();
    if (!plan) return;
    review(plan);
    state.review!.fromPending = true;
  }

  function openDialog(dialog: Dialog) {
    state.dialog = dialog;
  }

  function closeDialog() {
    state.dialog = undefined;
  }

  function review(plan: ChangePlan) {
    state.dialog = undefined;
    state.review = { plan, running: false, error: "" };
  }

  function closeReview() {
    state.review = undefined;
  }

  async function apply() {
    const current = state.review;
    if (!current || current.running) return;
    const { engine: e } = need();
    current.running = true;
    current.error = "";
    try {
      await e.execute(run, current.plan);
    } catch (error) {
      current.error = errorMessage(error);
      current.running = false;
      return;
    }
    state.review = undefined;
    if (current.fromPending) discardPending();
    void host.notifySuccess(`${current.plan.title}: done`);
    await loadList().catch(() => undefined);
    rebasePending();
    const next = current.plan.selectAfter;
    if (next && state.principals.some((p) => p.id === next)) {
      state.selected = next;
      state.view = "principals";
    } else if (state.selected && !selectedPrincipal.value) {
      state.selected = undefined;
    }
    saveViewState();
    updateTitle();
    state.revision++;
    await loadDetail();
  }

  const filteredPrincipals = computed(() => {
    const term = state.search.trim().toLowerCase();
    return state.principals.filter(
      (p) => (state.showSystem || !p.system) && (!term || p.name.toLowerCase().includes(term) || (p.comment ?? "").toLowerCase().includes(term))
    );
  });

  return {
    state,
    engine,
    caps,
    readOnly,
    selectedPrincipal,
    filteredPrincipals,
    ctx,
    run,
    need,
    init,
    refresh,
    select,
    setTab,
    showObject,
    setShowSystem,
    ask,
    setDebugMode,
    queueMembership,
    pendingOption,
    pendingPlan,
    discardPending,
    reviewPending,
    openDialog,
    closeDialog,
    review,
    closeReview,
    apply,
  };
}

export type Manager = ReturnType<typeof createManager>;
