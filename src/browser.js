export function getBrowser() {
  if (typeof browser !== "undefined") {
    return browser;
  }
  if (typeof chrome !== "undefined") {
    return chrome;
  }
  throw new Error("Browser API not found.");
}

export function getStorage() {
  const api = getBrowser();
  if (api?.storage?.local) {
    return api.storage.local;
  }
  throw new Error("Storage API not available.");
}

export async function getStorageItem(key) {
  const storage = getStorage();
  const results = await storage.get([key]);
  let data = results[key];

  if (typeof data === "undefined") {
    try {
      data = localStorage.getItem(key);
    } catch (error) {
      // ignore fallback errors
    }
  }

  return data;
}

export function setStorageItem(key, value) {
  const storage = getStorage();
  return storage.set({ [key]: value });
}

export function removeStorageItem(key) {
  const storage = getStorage();
  return storage.remove([key]);
}
