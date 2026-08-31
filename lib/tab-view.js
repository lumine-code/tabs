const path = require("path");
const { Disposable, CompositeDisposable, FileState } = require("lumine");

class TabView {
  constructor({ item, pane, didClickCloseIcon, tabs, location }) {
    this.item = item;
    this.pane = pane;
    this.tabs = tabs;
    if (typeof this.item.getPath === "function") {
      this.path = this.item.getPath();
    }

    this.element = document.createElement("li");
    this.element.setAttribute("is", "tabs-tab");
    if (["TextEditor", "TestView"].indexOf(this.item.constructor.name) > -1) {
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

    if (
      location === "center" ||
      !(typeof this.item.isPermanentDockItem === "function"
        ? this.item.isPermanentDockItem()
        : undefined)
    ) {
      const closeIcon = document.createElement("div");
      closeIcon.classList.add("close-icon");
      closeIcon.onclick = didClickCloseIcon;
      this.element.appendChild(closeIcon);
    }

    this.subscriptions = new CompositeDisposable();
    this.vcsResolutionGeneration = 0;

    this.handleEvents();
    this.updateDataAttributes();
    this.updateTitle();
    this.updateIcon();
    this.updateFileState();
    this.setupTooltip();

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
    const titleChangedHandler = () => {
      return this.updateTitle();
    };

    this.subscriptions.add(this.pane.onDidDestroy(() => this.destroy()));
    this.subscriptions.add(
      this.pane.onItemDidTerminatePendingState((item) => {
        if (item === this.item) {
          return this.clearPending();
        }
      }),
    );

    if (typeof this.pane.onItemDidBecomePendingState === "function") {
      this.subscriptions.add(
        this.pane.onItemDidBecomePendingState((item) => {
          if (item === this.item) {
            return this.setPending();
          }
        }),
      );
    }

    if (typeof this.item.onDidChangeTitle === "function") {
      const onDidChangeTitleDisposable = this.item.onDidChangeTitle(titleChangedHandler);
      if (Disposable.isDisposable(onDidChangeTitleDisposable)) {
        this.subscriptions.add(onDidChangeTitleDisposable);
      } else {
        console.warn("::onDidChangeTitle does not return a valid Disposable!", this.item);
      }
    }

    const pathChangedHandler = (path1) => {
      this.path = path1;
      this.updateDataAttributes();
      this.updateTitle();
      this.updateTooltip();
      this.setupVcsStatus();
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
      lumine.repositories.onDidChange(() => {
        this.setupVcsStatus();
      }),
    );

    return this.setupVcsStatus();
  }

  setupTooltip() {
    // Defer creating the tooltip until the tab is moused over
    const onMouseEnter = () => {
      this.mouseEnterSubscription.dispose();
      this.hasBeenMousedOver = true;
      this.updateTooltip();

      // Trigger again so the tooltip shows
      return this.element.dispatchEvent(new CustomEvent("mouseenter", { bubbles: true }));
    };

    this.mouseEnterSubscription = {
      dispose: () => {
        this.element.removeEventListener("mouseenter", onMouseEnter);
        return (this.mouseEnterSubscription = null);
      },
    };

    return this.element.addEventListener("mouseenter", onMouseEnter);
  }

  updateTooltip() {
    if (!this.hasBeenMousedOver) {
      return;
    }

    this.destroyTooltip();

    if (this.path) {
      return (this.tooltip = lumine.tooltips.add(this.element, {
        title: this.path,
        html: false,
        delay: {
          show: 1000,
          hide: 100,
        },
        placement: "bottom",
      }));
    }
  }

  destroyTooltip() {
    if (!this.hasBeenMousedOver) {
      return;
    }
    return this.tooltip != null ? this.tooltip.dispose() : undefined;
  }

  destroy() {
    this.vcsResolutionGeneration++;
    if (this.subscriptions != null) {
      this.subscriptions.dispose();
    }
    if (this.mouseEnterSubscription != null) {
      this.mouseEnterSubscription.dispose();
    }
    if (this.repoSubscriptions != null) {
      this.repoSubscriptions.dispose();
    }
    this.destroyTooltip();
    return this.element.remove();
  }

  updateDataAttributes() {
    let itemClass;
    if (this.path) {
      this.itemTitle.dataset.name = path.basename(this.path);
      this.itemTitle.dataset.path = this.path;
    } else {
      delete this.itemTitle.dataset.name;
      delete this.itemTitle.dataset.path;
    }

    if ((itemClass = this.item.constructor != null ? this.item.constructor.name : undefined)) {
      return (this.element.dataset.type = itemClass);
    } else {
      return delete this.element.dataset.type;
    }
  }

  updateTitle(param) {
    let title;
    if (param == null) {
      param = {};
    }
    let { updateSiblings, useLongTitle } = param;
    if (this.updatingTitle) {
      return;
    }
    this.updatingTitle = true;

    if (updateSiblings === false) {
      title = this.item.getTitle();
      if (useLongTitle) {
        let left;
        title =
          (left =
            typeof this.item.getLongTitle === "function" ? this.item.getLongTitle() : undefined) !=
          null
            ? left
            : title;
      }
      this.itemTitle.textContent = title;
    } else {
      title = this.item.getTitle();
      useLongTitle = false;
      for (let tab of this.tabs) {
        if (tab !== this) {
          if (tab.item.getTitle() === title) {
            tab.updateTitle({ updateSiblings: false, useLongTitle: true });
            useLongTitle = true;
          }
        }
      }
      if (useLongTitle) {
        let left1;
        title =
          (left1 =
            typeof this.item.getLongTitle === "function" ? this.item.getLongTitle() : undefined) !=
          null
            ? left1
            : title;
      }

      this.itemTitle.textContent = title;
    }

    return (this.updatingTitle = false);
  }

  // A tab binds the item itself. The icon registry owns the precedence between
  // its semantic name and path and follows both item change events, while this
  // view still handles path changes for title, data attributes, tooltip and VCS.
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
    if (this.pane.getPendingItem != null) {
      return this.pane.getPendingItem() === this.item;
    } else if (this.item.isPending != null) {
      return this.item.isPending();
    }
  }

  terminatePendingState() {
    if (this.pane.clearPendingItem != null) {
      if (this.pane.getPendingItem() === this.item) {
        return this.pane.clearPendingItem();
      }
    } else if (this.item.terminatePendingState != null) {
      return this.item.terminatePendingState();
    }
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
    if (lumine.config.get("tabs.showIcons")) {
      return this.itemTitle.classList.remove("hide-icon");
    } else {
      return this.itemTitle.classList.add("hide-icon");
    }
  }

  updateFileState(fileState = this.item.getFileState?.() ?? FileState.UNMODIFIED) {
    this.element.dataset.fileState = fileState;
    return fileState;
  }

  setupVcsStatus() {
    if (this.path == null) {
      return;
    }
    const filePath = this.path;
    const generation = ++this.vcsResolutionGeneration;
    return this.repoForPath(filePath).then((repo) => {
      if (generation !== this.vcsResolutionGeneration || filePath !== this.path) return;
      this.unsetVcsStatus();
      this.subscribeToRepo(repo);
      return this.updateVcsStatus(repo);
    });
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
      repo.onDidChangeStatus((event) => {
        if (event.path === this.path) {
          return this.updateVcsStatus(repo);
        }
      }),
    );
    this.repoSubscriptions.add(
      repo.onDidChangeStatusSnapshot(() => {
        this.updateVcsStatus(repo);
      }),
    );
    return this.repoSubscriptions.add(
      repo.onDidChangeStatuses(() => {
        return this.updateVcsStatus(repo);
      }),
    );
  }

  repoForPath(filePath = this.path) {
    return lumine.repositories.resolveForPath(filePath);
  }

  // Update the VCS status property of this tab using the repo.
  updateVcsStatus(repo) {
    if (repo == null) {
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
      return this.updateVcsColoring();
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

  unsetVcsStatus() {
    this.vcsResolutionGeneration++;
    if (this.repoSubscriptions != null) {
      this.repoSubscriptions.dispose();
    }
    delete this.status;
    return this.updateVcsColoring();
  }
}

module.exports = TabView;
