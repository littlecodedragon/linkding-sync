import { getStorageItem, setStorageItem } from "./browser";

export const SYNC_STATE_KEY = "ld_sync_state";

const DEFAULT_STATE = {
  lastRun: null,
  lastAttempt: null,
  lastFailure: null,
  inProgress: false,
  lastError: null,
  remoteBookmarkCount: 0,
  createdBrowserNodes: 0,
  syncFolderId: null,
};

export async function getSyncState() {
  const stateJson = await getStorageItem(SYNC_STATE_KEY);
  if (!stateJson) {
    return { ...DEFAULT_STATE };
  }

  try {
    const parsed = JSON.parse(stateJson);
    return { ...DEFAULT_STATE, ...parsed };
  } catch (error) {
    console.error("Failed to parse sync state", error);
    return { ...DEFAULT_STATE };
  }
}

export async function saveSyncState(state) {
  const stateJson = JSON.stringify(state);
  await setStorageItem(SYNC_STATE_KEY, stateJson);
  return state;
}

export async function updateSyncState(patch = {}) {
  const current = await getSyncState();
  const next = { ...current, ...patch };
  await saveSyncState(next);
  return next;
}

export function getDefaultSyncState() {
  return { ...DEFAULT_STATE };
}
