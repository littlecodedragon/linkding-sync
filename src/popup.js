import { LitElement, html } from "lit";
import { getBrowser } from "./browser";
import {
  getConfiguration,
  isConfigurationComplete,
} from "./configuration";
import { LinkdingApi } from "./linkding";

const TAG_DATALIST_ID = "ld-tag-suggestions";

export class Popup extends LitElement {
  static properties = {
    title: { type: String, state: true },
    url: { type: String, state: true },
    tags: { type: String, state: true },
    availableTags: { type: Array, state: true },
    isSaving: { type: Boolean, state: true },
    errorMessage: { type: String, state: true },
    successMessage: { type: String, state: true },
    needsConfiguration: { type: Boolean, state: true },
    loading: { type: Boolean, state: true },
  };

  constructor() {
    super();
    this.title = "";
    this.url = "";
    this.tags = "";
    this.availableTags = [];
    this.isSaving = false;
    this.errorMessage = "";
    this.successMessage = "";
    this.needsConfiguration = false;
    this.loading = true;
    this.api = null;
  }

  createRenderRoot() {
    return this;
  }

  async firstUpdated() {
    await this.initialize();
  }

  async initialize() {
    try {
      const configuration = await getConfiguration();
      if (!isConfigurationComplete(configuration)) {
        this.needsConfiguration = true;
        this.loading = false;
        return;
      }

      this.api = new LinkdingApi(configuration);

      const [tabInfo, tagNames] = await Promise.all([
        this.getCurrentTabInfo(),
        this.loadAvailableTags(),
      ]);

      this.title = tabInfo.title;
      this.url = tabInfo.url;
      this.availableTags = tagNames;
      this.loading = false;
    } catch (error) {
      console.error("Failed to initialize popup", error);
      this.errorMessage =
        error?.message || "Unexpected error while initializing the popup.";
      this.loading = false;
    }
  }

  async getCurrentTabInfo() {
    const browser = getBrowser();
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    if (!tab) {
      return { title: "", url: "" };
    }
    return {
      title: tab.title || "",
      url: tab.url || "",
    };
  }

  async loadAvailableTags() {
    try {
      const result = await this.api.getTags();
      return result.sort((a, b) => a.localeCompare(b));
    } catch (error) {
      console.warn("Failed to load tags", error);
      return [];
    }
  }

  handleInputChange(event, property) {
    this[property] = event.target.value;
  }

  parseTags(value) {
    return (value || "")
      .split(/\s+/)
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
  }

  async handleSubmit(event) {
    event.preventDefault();
    if (!this.api) {
      this.errorMessage = "Extension is not configured yet.";
      return;
    }

    this.isSaving = true;
    this.errorMessage = "";
    this.successMessage = "";

    const bookmark = {
      url: this.url.trim(),
      title: this.title.trim(),
      description: "",
      notes: "",
      unread: false,
      shared: false,
      tag_names: this.parseTags(this.tags),
    };

    if (!bookmark.url) {
      this.errorMessage = "The bookmark URL is required.";
      this.isSaving = false;
      return;
    }

    try {
      await this.api.saveBookmark(bookmark, {
        disable_html_snapshot: true,
      });

      this.successMessage = "Bookmark saved to Linkding.";
      await this.triggerSync();
      window.close();
    } catch (error) {
      console.error("Failed to save bookmark", error);
      this.errorMessage = error?.message || "Failed to save bookmark.";
      this.isSaving = false;
    }
  }

  async triggerSync() {
    try {
      await getBrowser().runtime.sendMessage({ type: "linkding.sync.now" });
    } catch (error) {
      console.warn("Unable to trigger sync after saving", error);
    }
  }

  openOptions() {
    getBrowser().runtime.openOptionsPage();
    window.close();
  }

  renderTagSuggestions() {
    if (!this.availableTags.length) {
      return null;
    }

    return html`
      <datalist id="${TAG_DATALIST_ID}">
        ${this.availableTags.map(
          (tag) => html`<option value="${tag}"></option>`,
        )}
      </datalist>
    `;
  }

  render() {
    if (this.loading) {
      return html`<p>Loading…</p>`;
    }

    if (this.needsConfiguration) {
      return html`
        <p>
          Please configure the extension with your Linkding server details before
          saving bookmarks.
        </p>
        <div class="actions">
          <button class="btn btn-primary" @click=${() => this.openOptions()}>
            Open settings
          </button>
        </div>
      `;
    }

    return html`
      ${this.renderTagSuggestions()}
      <form @submit=${(event) => this.handleSubmit(event)}>
        <label class="form-group">
          <span class="form-label">Title</span>
          <input
            class="form-input"
            type="text"
            required
            .value=${this.title}
            @input=${(event) => this.handleInputChange(event, "title")}
          />
        </label>

        <label class="form-group">
          <span class="form-label">URL</span>
          <input
            class="form-input"
            type="url"
            required
            .value=${this.url}
            @input=${(event) => this.handleInputChange(event, "url")}
          />
        </label>

        <label class="form-group">
          <span class="form-label">Tags</span>
          <input
            class="form-input"
            type="text"
            placeholder="Tags separated by spaces"
            list=${TAG_DATALIST_ID}
            .value=${this.tags}
            @input=${(event) => this.handleInputChange(event, "tags")}
          />
          <span class="tag-hint"
            >Press space to separate tags. Suggestions come from Linkding.</span
          >
        </label>

        ${this.errorMessage
          ? html`<p class="text-error">${this.errorMessage}</p>`
          : null}
        ${this.isSaving
          ? html`<p class="text-secondary">Saving bookmark…</p>`
          : this.successMessage
            ? html`<p class="text-success">${this.successMessage}</p>`
            : null}

        <div class="actions">
          <button type="button" class="btn" @click=${() => window.close()}>
            Cancel
          </button>
          <button class="btn btn-primary" type="submit" ?disabled=${this.isSaving}>
            ${this.isSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    `;
  }
}

customElements.define("ld-popup", Popup);
