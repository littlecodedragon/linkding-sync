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
  const remoteBookmarks = await api.getAllBookmarks({ includeArchived: false });
  const activeBookmarks = remoteBookmarks.filter(
    (bookmark) => !isBookmarkArchived(bookmark),
  );

  const rootFolder = await ensureSyncRootFolder({
    existingFolderId: previousState.syncFolderId,
    preferredParentId: configuration.syncParentFolderId,
  });
  await clearFolderContents(rootFolder.id);

  const createdNodes = await populateFolders(rootFolder.id, activeBookmarks);

  return {
    syncFolderId: rootFolder.id,
    remoteBookmarkCount: activeBookmarks.length,
    createdBrowserNodes: createdNodes,
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

async function clearFolderContents(folderId) {
  const children = await browser.bookmarks.getChildren(folderId);
  for (const child of children) {
    if (child.url) {
      await browser.bookmarks.remove(child.id);
    } else {
      await browser.bookmarks.removeTree(child.id);
    }
  }
}

async function populateFolders(rootFolderId, bookmarks) {
  const folderCache = new Map();
  const folderUrlCache = new Map();
  let created = 0;

  const prepared = [];
  for (const bookmark of bookmarks) {
    if (!bookmark?.url) {
      continue;
    }
    const tags = extractTags(bookmark);
    const title = getBookmarkTitle(bookmark);
    prepared.push({ bookmark, tags, title });
  }

  const uniqueTags = new Set();
  let hasUntagged = false;
  for (const item of prepared) {
    for (const tag of item.tags) {
      if (tag === null) {
        hasUntagged = true;
      } else {
        uniqueTags.add(tag);
      }
    }
  }

  const collator = new Intl.Collator(undefined, { sensitivity: "base" });
  const tagsForCreation = [
    ...Array.from(uniqueTags),
    ...(hasUntagged ? [null] : []),
  ].sort((a, b) => collator.compare(getTagLabel(a), getTagLabel(b)));

  for (let index = 0; index < tagsForCreation.length; index++) {
    const tag = tagsForCreation[index];
    await ensureTagFolder(rootFolderId, tag, folderCache, { index });
  }

  for (const { bookmark, tags, title } of prepared) {
    for (const tag of tags) {
      const folder = await ensureTagFolder(rootFolderId, tag, folderCache);
      let urlSet = folderUrlCache.get(folder.id);
      if (!urlSet) {
        urlSet = new Set();
        folderUrlCache.set(folder.id, urlSet);
      }

      if (urlSet.has(bookmark.url)) {
        continue;
      }

      await browser.bookmarks.create({
        parentId: folder.id,
        title,
        url: bookmark.url,
      });
      urlSet.add(bookmark.url);
      created += 1;
    }
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

async function ensureTagFolder(rootFolderId, tag, cache, options = {}) {
  const cacheKey = tag ?? "__untagged__";
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const title = tag === null ? UNTAGGED_FOLDER_TITLE : tag;
  const folder = await browser.bookmarks.create({
    parentId: rootFolderId,
    title,
    ...(typeof options.index === "number" ? { index: options.index } : {}),
  });

  cache.set(cacheKey, folder);
  return folder;
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
