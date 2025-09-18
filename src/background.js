import { getBrowser } from "./browser";
import {
  CONFIG_KEY,
  getConfiguration,
  isConfigurationComplete,
} from "./configuration";
import { LinkdingApi } from "./linkding";
import {
  SYNC_STATE_KEY,
  getSyncState,
  updateSyncState,
} from "./sync-state";
import { performBookmarkSync } from "./bookmark-sync";

const browser = getBrowser();
const SYNC_ALARM_NAME = "linkding-sync";

let configuration = null;
let syncInProgress = false;

async function refreshConfiguration({ triggerSync = false } = {}) {
  configuration = await getConfiguration();

  if (isConfigurationComplete(configuration)) {
    scheduleRecurringSync(configuration);
    if (triggerSync) {
      await runSync({ reason: "configuration" });
    }
  } else {
    await browser.alarms.clear(SYNC_ALARM_NAME);
    await updateSyncState({ inProgress: false });
  }
}

function scheduleRecurringSync(config) {
  const period = Math.max(Number(config.syncIntervalMinutes) || 0, 5);
  browser.alarms.create(SYNC_ALARM_NAME, {
    periodInMinutes: period,
    delayInMinutes: Math.min(period, 1),
  });
}

async function runSync({ reason } = {}) {
  if (syncInProgress) {
    return { skipped: true, reason: "in_progress" };
  }

  if (!isConfigurationComplete(configuration)) {
    throw new Error("Linkding Sync is not configured");
  }

  syncInProgress = true;

  const stateBefore = await getSyncState();
  await updateSyncState({
    inProgress: true,
    lastAttempt: Date.now(),
    lastError: null,
  });

  try {
    const api = new LinkdingApi(configuration);
    const result = await performBookmarkSync({
      api,
      previousState: stateBefore,
    });

    await updateSyncState({
      ...result,
      inProgress: false,
      lastRun: Date.now(),
    });

    return { ...result, reason };
  } catch (error) {
    const message = error?.message || String(error);
    await updateSyncState({
      inProgress: false,
      lastFailure: Date.now(),
      lastError: message,
    });
    console.error("Linkding sync failed", error);
    throw error;
  } finally {
    syncInProgress = false;
  }
}

browser.runtime.onInstalled.addListener(() => {
  refreshConfiguration({ triggerSync: true }).catch((error) =>
    console.error("Failed to initialize configuration", error),
  );
});

browser.runtime.onStartup.addListener(() => {
  refreshConfiguration({ triggerSync: true }).catch((error) =>
    console.error("Failed to initialize on startup", error),
  );
});

browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (Object.prototype.hasOwnProperty.call(changes, CONFIG_KEY)) {
    refreshConfiguration({ triggerSync: true }).catch((error) =>
      console.error("Failed to refresh configuration", error),
    );
  }
});

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== SYNC_ALARM_NAME) {
    return;
  }

  runSync({ reason: "alarm" }).catch((error) =>
    console.error("Scheduled sync failed", error),
  );
});

if (browser.browserAction?.onClicked) {
  browser.browserAction.onClicked.addListener(() => {
    browser.runtime.openOptionsPage();
  });
}

browser.runtime.onMessage.addListener((message) => {
  if (!message || typeof message !== "object") {
    return undefined;
  }

  if (message.type === "linkding.sync.now") {
    return runSync({ reason: "manual" })
      .then((result) => ({ status: "ok", result }))
      .catch((error) => ({
        status: "error",
        message: error?.message || String(error),
      }));
  }

  if (message.type === "linkding.sync.state") {
    return getSyncState();
  }

  return undefined;
});

refreshConfiguration().catch((error) =>
  console.error("Failed to load initial configuration", error),
);

// Expose the sync state key for external tools (debugging)
export { SYNC_STATE_KEY };
