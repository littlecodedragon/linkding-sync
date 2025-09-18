import { LitElement, html } from "lit";
import { getBrowser } from "./browser";
import {
  getConfiguration,
  saveConfiguration,
} from "./configuration";
import { LinkdingApi } from "./linkding";
import {
  SYNC_STATE_KEY,
  getSyncState,
} from "./sync-state";

export class Options extends LitElement {
  static properties = {
    baseUrl: { type: String, state: true },
    token: { type: String, state: true },
    syncIntervalMinutes: { type: Number, state: true },
    isSaving: { type: Boolean, state: true },
    saveSuccess: { type: Boolean, state: true },
    saveError: { type: String, state: true },
    syncState: { type: Object, state: true },
    manualSyncInProgress: { type: Boolean, state: true },
    manualSyncError: { type: String, state: true },
  };

  constructor() {
    super();
    this.baseUrl = "";
    this.token = "";
    this.syncIntervalMinutes = 30;
    this.isSaving = false;
    this.saveSuccess = false;
    this.saveError = "";
    this.syncState = null;
    this.manualSyncInProgress = false;
    this.manualSyncError = "";
    this._storageListener = null;
  }

  createRenderRoot() {
    return this;
  }

  async firstUpdated() {
    this.classList.add("options");
    await this.loadConfiguration();
    await this.loadSyncState();
    this.subscribeToSyncStateUpdates();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._storageListener) {
      getBrowser().storage.onChanged.removeListener(this._storageListener);
      this._storageListener = null;
    }
  }

  async loadConfiguration() {
    const config = await getConfiguration();
    this.baseUrl = config.baseUrl;
    this.token = config.token;
    this.syncIntervalMinutes = config.syncIntervalMinutes;
  }

  async loadSyncState() {
    this.syncState = await getSyncState();
  }

  subscribeToSyncStateUpdates() {
    const browser = getBrowser();
    this._storageListener = (changes, area) => {
      if (area !== "local") {
        return;
      }
      if (Object.prototype.hasOwnProperty.call(changes, SYNC_STATE_KEY)) {
        this.loadSyncState();
      }
    };
    browser.storage.onChanged.addListener(this._storageListener);
  }

  handleInputChange(event, property) {
    if (event.target.type === "number") {
      const value = Number.isNaN(event.target.valueAsNumber)
        ? this.syncIntervalMinutes
        : event.target.valueAsNumber;
      this[property] = value;
    } else {
      this[property] = event.target.value;
    }
  }

  async handleSubmit(event) {
    event.preventDefault();
    this.isSaving = true;
    this.saveSuccess = false;
    this.saveError = "";

    const config = {
      baseUrl: this.baseUrl,
      token: this.token,
      syncIntervalMinutes: this.syncIntervalMinutes,
    };

    const api = new LinkdingApi(config);
    const isValid = await api.testConnection();

    if (!isValid) {
      this.isSaving = false;
      this.saveSuccess = false;
      this.saveError =
        "Could not connect to the Linkding API. Please verify the URL and API token.";
      return;
    }

    await saveConfiguration(config);

    this.isSaving = false;
    this.saveSuccess = true;
    this.saveError = "";
  }

  async handleManualSync() {
    this.manualSyncInProgress = true;
    this.manualSyncError = "";

    try {
      const response = await getBrowser().runtime.sendMessage({
        type: "linkding.sync.now",
      });

      if (!response || response.status !== "ok") {
        const message = response?.message || "Sync failed for an unknown reason.";
        this.manualSyncError = message;
      }
    } catch (error) {
      this.manualSyncError = error?.message || String(error);
    } finally {
      this.manualSyncInProgress = false;
      await this.loadSyncState();
    }
  }

  formatTimestamp(timestamp) {
    if (!timestamp) {
      return "Never";
    }
    try {
      return new Date(timestamp).toLocaleString();
    } catch (error) {
      return "Never";
    }
  }

  renderSyncSummary() {
    if (!this.syncState) {
      return html`<p>Sync state is not available yet.</p>`;
    }

    const {
      lastRun,
      lastAttempt,
      lastFailure,
      lastError,
      remoteBookmarkCount,
      createdBrowserNodes,
      inProgress,
    } = this.syncState;

    return html`
      <div class="sync-summary">
        <p><strong>Last successful sync:</strong> ${this.formatTimestamp(lastRun)}</p>
        <p><strong>Last attempt:</strong> ${this.formatTimestamp(lastAttempt)}</p>
        <p><strong>Last failure:</strong> ${this.formatTimestamp(lastFailure)}</p>
        <p><strong>Bookmarks processed:</strong> ${remoteBookmarkCount}</p>
        <p><strong>Browser entries created:</strong> ${createdBrowserNodes}</p>
        <p><strong>Sync in progress:</strong> ${inProgress ? "Yes" : "No"}</p>
        ${lastError
          ? html`<p class="text-error"><strong>Last error:</strong> ${lastError}</p>`
          : null}
      </div>
    `;
  }

  render() {
    return html`
      <h1 class="h6">Linkding Bookmark Sync</h1>
      <p>
        Configure the extension with your Linkding server URL and an API token.
        The extension keeps a <strong>Linkding</strong> bookmark folder in sync,
        mirroring your tags as subfolders. Archived bookmarks are ignored and
        untagged entries appear in the <strong>Untagged</strong> subfolder.
      </p>

      <form class="form" @submit=${(event) => this.handleSubmit(event)}>
        <div class="form-group">
          <label class="form-label" for="input-base-url">
            Base URL <span class="text-error">*</span>
          </label>
          <input
            class="form-input"
            type="text"
            id="input-base-url"
            required
            placeholder="https://linkding.example.com"
            .value=${this.baseUrl}
            @input=${(event) => this.handleInputChange(event, "baseUrl")}
          />
          <div class="form-input-hint">
            Enter the root URL of your Linkding instance without a trailing slash.
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="input-token">
            API Token <span class="text-error">*</span>
          </label>
          <input
            class="form-input"
            type="password"
            id="input-token"
            required
            placeholder="Token"
            .value=${this.token}
            @input=${(event) => this.handleInputChange(event, "token")}
          />
          <div class="form-input-hint">
            Create an API token from your Linkding settings page and paste it here.
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="input-sync-interval">
            Sync interval (minutes)
          </label>
          <input
            class="form-input"
            type="number"
            id="input-sync-interval"
            min="5"
            max="720"
            .value=${this.syncIntervalMinutes}
            @input=${(event) => this.handleInputChange(event, "syncIntervalMinutes")}
          />
          <div class="form-input-hint">
            How often the extension should refresh bookmarks automatically.
          </div>
        </div>

        <div class="form-group">
          <button class="btn btn-primary" type="submit" ?disabled=${this.isSaving}>
            ${this.isSaving ? "Saving..." : "Save and Test"}
          </button>
        </div>

        ${this.saveSuccess
          ? html`<p class="text-success">Configuration saved successfully.</p>`
          : null}
        ${this.saveError
          ? html`<p class="text-error">${this.saveError}</p>`
          : null}
      </form>

      <hr />

      <section>
        <h2 class="h6">Sync Status</h2>
        ${this.renderSyncSummary()}
        <button
          class="btn"
          @click=${() => this.handleManualSync()}
          ?disabled=${this.manualSyncInProgress}
        >
          ${this.manualSyncInProgress ? "Syncing..." : "Sync now"}
        </button>
        ${this.manualSyncError
          ? html`<p class="text-error">${this.manualSyncError}</p>`
          : null}
      </section>
    `;
  }
}

customElements.define("ld-options", Options);
