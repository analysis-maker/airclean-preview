// @ts-check

const STORAGE_KEY = "guest-ops-store-v1";

/**
 * @param {{ read: () => any, write: (data: any) => void }} driver
 * @param {any} seedState
 */
export function createStore(driver, seedState) {
  let state = driver.read();
  if (!state) {
    state = structuredClone(seedState);
    driver.write(state);
  }
  return {
    load() {
      state = driver.read() || structuredClone(seedState);
      return structuredClone(state);
    },
    save(next) {
      state = structuredClone(next);
      driver.write(state);
      return structuredClone(state);
    },
  };
}

export function createMemoryDriver(initial = null) {
  let data = initial ? structuredClone(initial) : null;
  return {
    read() {
      return data ? structuredClone(data) : null;
    },
    write(next) {
      data = structuredClone(next);
    },
  };
}

/** @param {Storage} storage */
export function createLocalStorageDriver(storage, key = STORAGE_KEY) {
  return {
    read() {
      const raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    },
    write(data) {
      storage.setItem(key, JSON.stringify(data));
    },
  };
}

export async function createNodeFileDriver() {
  const { readFile, writeFile, mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  const file = new URL("../../.local/store.json", import.meta.url);
  return {
    async read() {
      try {
        return JSON.parse(await readFile(file, "utf8"));
      } catch {
        return null;
      }
    },
    async write(data) {
      await mkdir(dirname(file.pathname), { recursive: true });
      await writeFile(file, JSON.stringify(data, null, 2));
    },
  };
}

/**
 * @param {any} state
 * @param {{ scope: "global" | "listingSet" | "property", id?: string, settings: object, actor: string, now: string }} change
 */
export function saveRule(state, change) {
  const next = structuredClone(state);
  next.rules = next.rules || { global: null, listingSets: {}, properties: {} };
  if (change.tree) {
    next.rules[change.tree] = next.rules[change.tree] || { global: null, listingSets: {}, properties: {} };
  }
  const version = nextVersion(next, change.scope, change.id, change.tree);
  const record = {
    version,
    updated_by: change.actor,
    updated_at: change.now,
    settings: structuredClone(change.settings),
  };
  const root = change.tree ? next.rules[change.tree] : next.rules;
  if (change.scope === "global") {
    record.id = "global";
    root.global = record;
  } else if (change.scope === "listingSet") {
    root.listingSets[change.id] = record;
  } else {
    root.properties[change.id] = record;
  }
  next.history = next.history || [];
  next.history.push({
    version,
    tree: change.tree || "early_checkin",
    scope: change.scope,
    scopeId: change.scope === "global" ? "global" : change.id,
    updated_by: change.actor,
    updated_at: change.now,
    settings: structuredClone(change.settings),
  });
  return next;
}

function nextVersion(state, scope, id, tree) {
  const root = tree ? state.rules?.[tree] : state.rules;
  if (scope === "global") return Number(root?.global?.version || 0) + 1;
  if (scope === "listingSet") return Number(root?.listingSets?.[id]?.version || 0) + 1;
  return Number(root?.properties?.[id]?.version || 0) + 1;
}

/** @param {any} seed */
export function seedStateFrom(seed) {
  const row = (seed.qa_app_config || []).find((item) => item.key === "upsells");
  return {
    rules: structuredClone(row?.value || {}),
    listingSets: structuredClone(seed.ac_listing_sets || []),
    orders: structuredClone(seed.ac_orders || []),
    audit: [],
    notifications: [],
    outbox: [],
    calendar: structuredClone(seed.ac_calendar || []),
    history: [],
    counters: { payment: 0, order: 0, quote: 0, audit: 0 },
  };
}
