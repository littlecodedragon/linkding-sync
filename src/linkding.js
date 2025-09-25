const API_PAGE_SIZE = 100;

export class LinkdingApi {
  constructor(configuration) {
    this.configuration = configuration;
  }

  get headers() {
    return {
      Authorization: `Token ${this.configuration.token}`,
      "Content-Type": "application/json",
    };
  }

  buildUrl(path, params = {}) {
    const base = this.configuration.baseUrl.endsWith("/")
      ? this.configuration.baseUrl
      : `${this.configuration.baseUrl}/`;
    const url = new URL(path.replace(/^\//, ""), base);

    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") {
        return;
      }
      url.searchParams.set(key, value);
    });

    return url;
  }

  normalizeNextUrl(next) {
    if (!next) {
      return null;
    }

    try {
      const nextUrl = new URL(next, this.configuration.baseUrl);
      return nextUrl.toString();
    } catch (error) {
      console.error("Failed to normalize next URL", error);
      return null;
    }
  }

  async testConnection() {
    try {
      const url = this.buildUrl("/api/bookmarks/", { limit: 1 });
      const response = await fetch(url.toString(), {
        headers: this.headers,
      });

      if (!response.ok) {
        return false;
      }

      const body = await response.json();
      return Array.isArray(body.results);
    } catch (error) {
      console.error("Failed to test connection", error);
      return false;
    }
  }

  async getAllBookmarks({ includeArchived = false } = {}) {
    const collected = [];
    const rawResponses = [];
    let nextUrl = this.buildUrl("/api/bookmarks/", {
      limit: API_PAGE_SIZE,
      ...(includeArchived ? {} : { is_archived: "false" }),
    }).toString();

    while (nextUrl) {
      const response = await fetch(nextUrl, {
        headers: this.headers,
      });

      if (!response.ok) {
        throw new Error(
          `Failed to load bookmarks: ${response.status} ${response.statusText}`,
        );
      }

      const text = await response.text();
      rawResponses.push(text);
      const body = JSON.parse(text);
      const results = Array.isArray(body.results) ? body.results : [];
      const filtered = includeArchived
        ? results
        : results.filter((bookmark) => !isBookmarkArchived(bookmark));

      collected.push(...filtered);
      nextUrl = this.normalizeNextUrl(body.next);
    }

    const rawSource = rawResponses.length ? rawResponses.join("\n") : "";
    const remoteHash = await computeHash(rawSource);

    return {
      bookmarks: collected,
      remoteHash,
    };
  }

  async getTags({ limit = 5000 } = {}) {
    const url = this.buildUrl("/api/tags/", { limit });
    const response = await fetch(url.toString(), {
      headers: this.headers,
    });

    if (!response.ok) {
      throw new Error(`Failed to load tags: ${response.statusText}`);
    }

    const body = await response.json();
    if (!Array.isArray(body.results)) {
      return [];
    }

    return body.results.map((tag) => tag.name).filter(Boolean);
  }

  async saveBookmark(bookmark, options = {}) {
    const query = ["disable_scraping"]; // avoid server-side metadata fetching delay
    if (options.disable_html_snapshot) {
      query.push("disable_html_snapshot");
    }
    const url = this.buildUrl(`/api/bookmarks/`, {});
    if (query.length) {
      url.search = query.join("&");
    }

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(bookmark),
    });

    if (response.status === 201) {
      return response.json();
    }

    if (response.status === 400) {
      const body = await response.json().catch(() => ({}));
      throw new Error(`Validation error: ${JSON.stringify(body)}`);
    }

    throw new Error(`Failed to save bookmark: ${response.statusText}`);
  }
}

export function isBookmarkArchived(bookmark) {
  if (!bookmark) {
    return false;
  }
  if (typeof bookmark.is_archived === "boolean") {
    return bookmark.is_archived;
  }
  if (typeof bookmark.archived === "boolean") {
    return bookmark.archived;
  }
  return false;
}

async function computeHash(input) {
  const normalized = typeof input === "string" ? input : "";
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);

  if (!globalThis.crypto?.subtle) {
    throw new Error("Cryptographic hashing not supported in this environment.");
  }

  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  let hash = "";
  for (const byte of bytes) {
    hash += byte.toString(16).padStart(2, "0");
  }
  return hash;
}
