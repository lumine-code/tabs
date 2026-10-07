const path = require("path");
const { Disposable, CompositeDisposable } = require("lumine");
const gitStatusUpdateScheduler = require("./git-status-update-scheduler");

class TabView {
  constructor({ item, pane, didClickCloseIcon, didChangeTitle, location }) {
    this.item = item;
    this.pane = pane;
    this.didChangeTitle = didChangeTitle;
    if (typeof this.item.getPath === "function") {
      this.path = this.item.getPath();
    }

    this.element = document.createElement("li");
    this.element.setAttribute("is", "tabs-tab");
    if (lumine.workspace.isTextEditor(this.item)) {
      this.element.classList.add("texteditor");
    }
    this.element.classList.add("tab", "sortable");

    this.itemTitle = document.createElement("div");
    this.itemTitle.classList.add("title");
    this.element.appendChild(this.itemTitle);

    // Dedicated file-state marker, decoupled from the close button so changing
    // state never disturbs the close button's own hover animation.
    this.statusIcon = document.createElement("div");
    this.statusIcon.classList.add("tab-status");
    this.element.appendChild(this.statusIcon);

    if (location === "center" || !this.item.isPermanentDockItem?.()) {
      const closeIcon = document.createElement("div");
      closeIcon.classList.add("close-icon");
      closeIcon.onclick = didClickCloseIcon;
      this.element.appendChild(closeIcon);
    }

    this.subscriptions = new CompositeDisposable();

    this.handleEvents();
    this.updateDataAttributes();
    this.updateTitle();
    this.updateIcon();
    this.updateFileState();

    if (this.isItemPending()) {
      this.itemTitle.classList.add("temp");
      this.element.classList.add("pending-tab");
    }

    this.element.pane = this.pane;
    this.element.item = this.item;
    this.element.itemTitle = this.itemTitle;
    this.element.path = this.path;
  }

  handleEvents() {
    this.subscriptions.add(
      this.pane.onItemDidTerminatePendingState((item) => {
        if (item === this.item) {
          return this.clearPending();
        }
      }),
    );

    this.subscriptions.add(
      this.pane.onItemDidBecomePendingState((item) => {
        if (item === this.item) {
          return this.setPending();
        }
      }),
    );

    if (typeof this.item.onDidChangeTitle === "function") {
      const onDidChangeTitleDisposable = this.item.onDidChangeTitle(() => this.didChangeTitle());
      if (Disposable.isDisposable(onDidChangeTitleDisposable)) {
        this.subscriptions.add(onDidChangeTitleDisposable);
      } else {
        console.warn("::onDidChangeTitle does not return a valid Disposable!", this.item);
      }
    }

    const pathChangedHandler = (path1) => {
      this.path = path1;
      this.updateDataAttributes();
      this.didChangeTitle();
    };

    if (typeof this.item.onDidChangePath === "function") {
      const onDidChangePathDisposable = this.item.onDidChangePath(pathChangedHandler);
      if (Disposable.isDisposable(onDidChangePathDisposable)) {
        this.subscriptions.add(onDidChangePathDisposable);
      } else {
        console.warn("::onDidChangePath does not return a valid Disposable!", this.item);
      }
    }

    if (typeof this.item.onDidChangeFileState === "function") {
      const onDidChangeFileStateDisposable = this.item.onDidChangeFileState((fileState) => {
        this.updateFileState(fileState);
      });
      if (Disposable.isDisposable(onDidChangeFileStateDisposable)) {
        this.subscriptions.add(onDidChangeFileStateDisposable);
      } else {
        console.warn("::onDidChangeFileState does not return a valid Disposable!", this.item);
      }
    }

    if (typeof this.item.onDidSave === "function") {
      const onDidSaveDisposable = this.item.onDidSave((event) => {
        this.terminatePendingState();
        if (event.path !== this.path) {
          this.path = event.path;
          return this.setupVcsStatus();
        }
      });

      if (Disposable.isDisposable(onDidSaveDisposable)) {
        this.subscriptions.add(onDidSaveDisposable);
      } else {
        console.warn("::onDidSave does not return a valid Disposable!", this.item);
      }
    }
    this.subscriptions.add(
      lumine.config.observe("tabs.showIcons", () => {
        return this.updateIconVisibility();
      }),
    );

    return this.setupVcsStatus();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.vcsObservation?.dispose();
    this.vcsReadyResolve?.();
    if (this.subscriptions != null) {
      this.subscriptions.dispose();
    }
    if (this.repoSubscriptions != null) {
      this.repoSubscriptions.dispose();
    }
    return this.element.remove();
  }

  updateDataAttributes() {
    if (this.path) {
      this.element.title = this.path;
      this.itemTitle.dataset.name = path.basename(this.path);
      this.itemTitle.dataset.path = this.path;
    } else {
      this.element.removeAttribute("title");
      delete this.itemTitle.dataset.name;
      delete this.itemTitle.dataset.path;
    }

    const itemType = this.item.constructor?.name;
    if (itemType) {
      this.element.dataset.type = itemType;
    } else {
      delete this.element.dataset.type;
    }
  }

  updateTitle(title = this.item.getTitle()) {
    this.itemTitle.textContent = title;
  }

  // A tab binds the item itself. The icon registry owns the precedence between
  // its semantic name and path and follows both item change events, while this
  // view still handles path changes for title, data attributes and VCS.
  // Whether the icon is shown is the `tabs.showIcons` setting, applied as a
  // class by `updateIconVisibility`.
  //
  // `updateDataAttributes` owns `data-name`/`data-path` here — it deletes them
  // when there is no path — so the registry must not also write them.
  updateIcon() {
    this.iconDisposable?.dispose();
    this.iconDisposable = lumine.icons.applyTo(
      this.itemTitle,
      { item: this.item, context: "tabs" },
      { setData: false },
    );
    this.subscriptions.add(this.iconDisposable);
  }

  isItemPending() {
    return this.pane.getPendingItem() === this.item;
  }

  terminatePendingState() {
    if (this.isItemPending()) this.pane.clearPendingItem();
  }

  setPending() {
    this.itemTitle.classList.add("temp");
    return this.element.classList.add("pending-tab");
  }

  clearPending() {
    this.itemTitle.classList.remove("temp");
    return this.element.classList.remove("pending-tab");
  }

  updateIconVisibility() {
    this.itemTitle.classList.toggle("hide-icon", !lumine.config.get("tabs.showIcons"));
  }

  updateFileState(fileState = this.item.getFileState?.() ?? "unmodified") {
    this.element.dataset.fileState = fileState;
    return fileState;
  }

  setupVcsStatus() {
    this.vcsObservation?.dispose();
    this.vcsReadyResolve?.();
    this.unsetVcsStatus({ preserveStatus: this.path === this.vcsStatusPath });
    const ready = new Promise((resolve) => {
      this.vcsReadyResolve = resolve;
    });
    this.vcsObservation = lumine.repositories.observeForPath(
      () => this.path,
      (repository, state) => {
        if (state.path !== this.vcsStatusPath) {
          this.unsetVcsStatus();
          this.vcsStatusPath = state.path;
        }
        if (repository !== this.repository) {
          this.unsetVcsStatus({ preserveStatus: state.path === this.vcsStatusPath });
          this.repository = repository;
          if (repository) this.subscribeToRepo(repository);
        }
        // Paint initialized cached data synchronously, before the tab enters the DOM.
        if (repository) this.updateVcsStatus(repository);
        else if (state.ready) {
          delete this.status;
          this.updateVcsColoring();
        }
        if (state.error) console.error("Unable to load tab Git status", state.error);
        if (state.ready || state.error) {
          this.vcsReadyResolve?.();
          this.vcsReadyResolve = null;
        }
      },
      {
        onDidChangePath: (callback) => this.item.onDidChangePath?.(callback) ?? new Disposable(),
        snapshots: "status",
      },
    );
    return ready;
  }

  // Subscribe to the project's repo for changes to the VCS status of the file.
  subscribeToRepo(repo) {
    if (repo == null) {
      return;
    }

    // Remove previous repo subscriptions.
    if (this.repoSubscriptions != null) {
      this.repoSubscriptions.dispose();
    }
    this.repoSubscriptions = new CompositeDisposable();

    this.repoSubscriptions.add(
      gitStatusUpdateScheduler.subscribe(repo, () => this.updateVcsStatus(repo)),
    );
    return this.updateVcsStatus(repo);
  }

  // Update the VCS status property of this tab using the repo.
  updateVcsStatus(repo) {
    if (repo == null || !repo.getStatusSnapshot().initialized) {
      return;
    }

    let newStatus = null;
    if (repo.isPathIgnoredCached(this.path)) {
      newStatus = "ignored";
    } else {
      const summary = repo.getPathStatusSummary(this.path);
      if (summary != null) {
        if (summary.conflicted) {
          newStatus = "conflicted";
        } else if (summary.modified) {
          newStatus = "modified";
        } else if (summary.added) {
          newStatus = "added";
        }
      }
    }

    if (newStatus !== this.status) {
      this.status = newStatus;
      this.updateVcsColoring();
    }
  }

  updateVcsColoring() {
    this.itemTitle.classList.remove(
      "status-ignored",
      "status-modified",
      "status-added",
      "status-conflicted",
    );
    if (this.status) {
      return this.itemTitle.classList.add(`status-${this.status}`);
    }
  }

  unsetVcsStatus({ preserveStatus = false } = {}) {
    this.repository = null;
    if (this.repoSubscriptions != null) {
      this.repoSubscriptions.dispose();
      this.repoSubscriptions = null;
    }
    // Keep the last known color for this path until its replacement is ready.
    if (!preserveStatus) {
      delete this.status;
      this.updateVcsColoring();
    }
  }
}

module.exports = TabView;
