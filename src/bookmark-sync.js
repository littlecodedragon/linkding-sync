import { getBrowser } from "./browser";
import { isBookmarkArchived } from "./linkding";

const browser = getBrowser();

const SYNC_FOLDER_TITLE = "Linkding";
const UNTAGGED_FOLDER_TITLE = "Untagged";
const PARENT_FOLDER_ID_CANDIDATES = [
  "unfiled_____",
  "unsorted_____",
  "mobile_____",
  "mobile______",
  "2",
  "toolbar_____",
  "1",
];
const PARENT_FOLDER_TITLE_CANDIDATES = [
  "Other Bookmarks",
  "Unsorted Bookmarks",
  "Unsorted",
  "Bookmarks Menu",
];
const ROOT_IDS = new Set(["root________", "root_______", "root_________", "0"]);

export async function performBookmarkSync({
  api,
  previousState = {},
  configuration = {},
}) {
  const { bookmarks: remoteBookmarks, remoteHash } = await api.getAllBookmarks({
    includeArchived: false,
  });
  const activeBookmarks = remoteBookmarks.filter(
    (bookmark) => !isBookmarkArchived(bookmark),
  );

  if (configuration.lastRemoteHash && configuration.lastRemoteHash === remoteHash) {
    if (previousState.syncFolderId) {
      const existingFolder = await getFolderById(previousState.syncFolderId);
      if (!existingFolder) {
        console.warn("Linkding sync folder missing despite matching hash; rebuilding.");
      } else {
        return {
          syncFolderId: previousState.syncFolderId,
          remoteBookmarkCount: activeBookmarks.length,
          createdBrowserNodes: 0,
          skipped: true,
          remoteHash,
        };
      }
    } else {
      return {
        syncFolderId: null,
        remoteBookmarkCount: activeBookmarks.length,
        createdBrowserNodes: 0,
        skipped: true,
        remoteHash,
      };
    }
  }

  const rootFolder = await ensureSyncRootFolder({
    existingFolderId: previousState.syncFolderId,
    preferredParentId: configuration.syncParentFolderId,
  });

  const createdNodes = await populateFolders(rootFolder.id, activeBookmarks);

  return {
    syncFolderId: rootFolder.id,
    remoteBookmarkCount: activeBookmarks.length,
    createdBrowserNodes: createdNodes,
    skipped: false,
    remoteHash,
  };
}

async function ensureSyncRootFolder({ existingFolderId, preferredParentId }) {
  const preferredParent = await getPreferredParentFolder(preferredParentId);

  if (existingFolderId) {
    const existing = await getFolderById(existingFolderId);
    if (existing) {
      if (preferredParent && existing.parentId !== preferredParent.id) {
        try {
          await browser.bookmarks.move(existing.id, {
            parentId: preferredParent.id,
          });
          const moved = await getFolderById(existing.id);
          if (moved) {
            return moved;
          }
        } catch (error) {
          console.warn("Failed to move existing Linkding folder", error);
        }
      }
      return existing;
    }
  }

  const discovered = await findExistingSyncFolderByTitle();
  if (discovered) {
    if (preferredParent && discovered.parentId !== preferredParent.id) {
      try {
        await browser.bookmarks.move(discovered.id, {
          parentId: preferredParent.id,
        });
        const moved = await getFolderById(discovered.id);
        if (moved) {
          return moved;
        }
      } catch (error) {
        console.warn("Failed to move discovered Linkding folder", error);
      }
    }
    return discovered;
  }

  const parentFolder = preferredParent;
  const children = await browser.bookmarks.getChildren(parentFolder.id);
  const existingSyncFolder = children.find(
    (child) => !child.url && child.title === SYNC_FOLDER_TITLE,
  );

  if (existingSyncFolder) {
    return existingSyncFolder;
  }

  return browser.bookmarks.create({
    parentId: parentFolder.id,
    title: SYNC_FOLDER_TITLE,
  });
}

async function findExistingSyncFolderByTitle() {
  try {
    const matches = await browser.bookmarks.search({ title: SYNC_FOLDER_TITLE });
    if (!Array.isArray(matches)) {
      return null;
    }

    const folders = matches
      .filter((node) => node && !node.url)
      .sort((a, b) => {
        const aDate = typeof a.dateAdded === "number" ? a.dateAdded : 0;
        const bDate = typeof b.dateAdded === "number" ? b.dateAdded : 0;
        return bDate - aDate;
      });

    return folders[0] || null;
  } catch (error) {
    console.warn("Unable to search for existing Linkding folder", error);
    return null;
  }
}

async function getPreferredParentFolder(preferredParentId) {
  if (preferredParentId) {
    const preferred = await getFolderById(preferredParentId);
    if (preferred) {
      return preferred;
    }
  }

  for (const candidateId of PARENT_FOLDER_ID_CANDIDATES) {
    const node = await getFolderById(candidateId);
    if (node) {
      return node;
    }
  }

  const tree = await browser.bookmarks.getTree();
  const root = tree[0];
  const titleMatch = findFolderByTitle(root, PARENT_FOLDER_TITLE_CANDIDATES);
  if (titleMatch) {
    return titleMatch;
  }

  const fallback = findFirstFolder(root);
  if (fallback) {
    return fallback;
  }

  throw new Error("Unable to locate a parent folder to host Linkding sync.");
}

async function getFolderById(id) {
  if (!id) {
    return null;
  }
  try {
    const nodes = await browser.bookmarks.get(id);
    const node = nodes && nodes[0];
    if (node && !node.url) {
      return node;
    }
  } catch (error) {
    // ignore lookup errors
  }
  return null;
}

function findFolderByTitle(node, titleCandidates = []) {
  if (!node) {
    return null;
  }

  const normalizedTitles = titleCandidates.map((title) => title.toLowerCase());
  const stack = [node];

  while (stack.length) {
    const current = stack.pop();
    if (current && !current.url) {
      if (normalizedTitles.includes((current.title || "").toLowerCase())) {
        return current;
      }
      if (current.children) {
        stack.push(...current.children);
      }
    }
  }

  return null;
}

function findFirstFolder(node) {
  if (!node) {
    return null;
  }

  const stack = [node];
  while (stack.length) {
    const current = stack.pop();
    if (current && !current.url && current.id) {
      if (!isRootNode(current)) {
        return current;
      }
    }
    if (current?.children) {
      stack.push(...current.children);
    }
  }
  return null;
}

function isRootNode(node) {
  if (!node) {
    return false;
  }
  if (ROOT_IDS.has(node.id)) {
    return true;
  }
  return typeof node.parentId === "undefined" || node.parentId === null;
}

async function populateFolders(rootFolderId, bookmarks) {
  const { tagMap, orderedTagKeys } = prepareRemoteBookmarkIndex(bookmarks);

  const existingChildren = await browser.bookmarks.getChildren(rootFolderId);
  const existingFoldersByTitle = new Map();
  const unusedFolderIds = new Set();

  for (const child of existingChildren) {
    if (child.url) {
      await browser.bookmarks.remove(child.id);
      continue;
    }

    existingFoldersByTitle.set(child.title, child);
    unusedFolderIds.add(child.id);
  }

  let created = 0;

  for (let index = 0; index < orderedTagKeys.length; index++) {
    const tagKey = orderedTagKeys[index];
    const tag = tagKey === UNTAGGED_CACHE_KEY ? null : tagKey;
    const title = getTagLabel(tag);
    const remoteEntries = tagMap.get(tagKey)?.list ?? [];

    let folder = existingFoldersByTitle.get(title) || null;
    if (folder) {
      unusedFolderIds.delete(folder.id);

      const needsReparenting = folder.parentId !== rootFolderId;
      const needsReordering =
        typeof folder.index !== "number" || folder.index !== index;

      if (needsReparenting || needsReordering) {
        try {
          folder = await browser.bookmarks.move(folder.id, {
            parentId: rootFolderId,
            index,
          });
        } catch (error) {
          console.warn("Failed to move existing tag folder", title, error);
          const refreshed = await getFolderById(folder.id);
          if (refreshed) {
            folder = refreshed;
          }
        }
      }
    } else {
      folder = await browser.bookmarks.create({
        parentId: rootFolderId,
        title,
        index,
      });
    }

    created += await syncFolderBookmarks(folder.id, remoteEntries);
  }

  for (const folderId of unusedFolderIds) {
    await browser.bookmarks.removeTree(folderId);
  }

  return created;
}

function extractTags(bookmark) {
  const rawTags = Array.isArray(bookmark?.tag_names)
    ? bookmark.tag_names
    : [];
  const sanitized = rawTags
    .map((tag) => (tag || "").trim())
    .filter((tag) => tag.length > 0);

  if (!sanitized.length) {
    return [null];
  }

  return sanitized;
}

function getBookmarkTitle(bookmark) {
  return (
    (bookmark.title && bookmark.title.trim()) ||
    (bookmark.website_title && bookmark.website_title.trim()) ||
    bookmark.url
  );
}

function getTagLabel(tag) {
  return tag === null ? UNTAGGED_FOLDER_TITLE : tag;
}

const UNTAGGED_CACHE_KEY = "__untagged__";

function prepareRemoteBookmarkIndex(bookmarks) {
  const tagMap = new Map();

  for (const bookmark of bookmarks) {
    if (!bookmark?.url) {
      continue;
    }

    const tags = extractTags(bookmark);
    const title = getBookmarkTitle(bookmark);

    for (const tag of tags) {
      const cacheKey = tag === null ? UNTAGGED_CACHE_KEY : tag;
      let bucket = tagMap.get(cacheKey);
      if (!bucket) {
        bucket = { list: [], byUrl: new Map() };
        tagMap.set(cacheKey, bucket);
      }

      const existing = bucket.byUrl.get(bookmark.url);
      if (existing) {
        existing.title = title;
        continue;
      }

      const record = { url: bookmark.url, title };
      bucket.list.push(record);
      bucket.byUrl.set(bookmark.url, record);
    }
  }

  const collator = new Intl.Collator(undefined, { sensitivity: "base" });
  const orderedTagKeys = Array.from(tagMap.keys()).sort((a, b) =>
    collator.compare(getTagLabel(a === UNTAGGED_CACHE_KEY ? null : a), getTagLabel(b === UNTAGGED_CACHE_KEY ? null : b)),
  );

  return { tagMap, orderedTagKeys };
}

async function syncFolderBookmarks(folderId, remoteEntries) {
  const children = await browser.bookmarks.getChildren(folderId);
  const existingByUrl = new Map();

  for (const child of children) {
    if (child.url) {
      existingByUrl.set(child.url, child);
    } else {
      await browser.bookmarks.removeTree(child.id);
    }
  }

  let created = 0;

  for (let index = 0; index < remoteEntries.length; index++) {
    const remoteEntry = remoteEntries[index];
    const existing = existingByUrl.get(remoteEntry.url);

    if (existing) {
      existingByUrl.delete(remoteEntry.url);

      if (existing.title !== remoteEntry.title) {
        await browser.bookmarks.update(existing.id, { title: remoteEntry.title });
      }

      const needsReparenting = existing.parentId !== folderId;
      const needsReordering =
        typeof existing.index !== "number" || existing.index !== index;

      if (needsReparenting || needsReordering) {
        await browser.bookmarks.move(existing.id, {
          parentId: folderId,
          index,
        });
      }

      continue;
    }

    await browser.bookmarks.create({
      parentId: folderId,
      title: remoteEntry.title,
      url: remoteEntry.url,
      index,
    });
    created += 1;
  }

  for (const leftover of existingByUrl.values()) {
    await browser.bookmarks.remove(leftover.id);
  }

  return created;
}
