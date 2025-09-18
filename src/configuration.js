import { getStorageItem, setStorageItem } from "./browser";

export const CONFIG_KEY = "ld_sync_config";

const DEFAULTS = {
  baseUrl: "",
  token: "",
  syncIntervalMinutes: 30,
};

function normalizeConfiguration(config = {}) {
  const baseUrl = (config.baseUrl || "").trim().replace(/\/$/, "");
  const token = (config.token || "").trim();
  const interval = Number(config.syncIntervalMinutes) || DEFAULTS.syncIntervalMinutes;
  const syncIntervalMinutes = Math.min(Math.max(interval, 5), 720); // clamp between 5 minutes and 12 hours

  return {
    ...DEFAULTS,
    ...config,
    baseUrl,
    token,
    syncIntervalMinutes,
  };
}

export async function getConfiguration() {
  const configJson = await getStorageItem(CONFIG_KEY);
  if (!configJson) {
    return { ...DEFAULTS };
  }

  try {
    const parsed = JSON.parse(configJson);
    return normalizeConfiguration(parsed);
  } catch (error) {
    console.error("Failed to parse configuration", error);
    return { ...DEFAULTS };
  }
}

export async function saveConfiguration(config) {
  const normalized = normalizeConfiguration(config);
  const configJson = JSON.stringify(normalized);
  await setStorageItem(CONFIG_KEY, configJson);
  return normalized;
}

export function isConfigurationComplete(config) {
  return Boolean(config?.baseUrl && config?.token);
}

export function getDefaultConfiguration() {
  return { ...DEFAULTS };
}
