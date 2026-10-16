// Command and drag operations are only needed after a tab interaction.
module.exports = {
  closeTab(tab) {
    if (!tab) return false;
    if (this.location !== "center" && tab.item.isPermanentDockItem?.()) {
      lumine.notifications.addWarning("This tab is permanently attached to its dock.");
      return false;
    }
    return this.pane.destroyItem(tab.item, false, {
      canDestroy: () => !this.destroyed && this.tabsByItem.get(tab.item) === tab,
    });
  },

  async closeTabs(tabs) {
    for (const tab of tabs) {
      if (this.destroyed || !this.tabsByItem.has(tab.item)) continue;
      if (this.location !== "center" && tab.item.isPermanentDockItem?.()) continue;
      if (!(await this.closeTab(tab))) return false;
    }
    return true;
  },

  closeOtherTabs(tab) {
    return tab ? this.closeTabs(this.tabs.filter((other) => other !== tab)) : false;
  },

  closeTabsToRight(tab) {
    const index = this.tabs.indexOf(tab);
    return index < 0 ? false : this.closeTabs(this.tabs.slice(index + 1));
  },

  closeTabsToLeft(tab) {
    const index = this.tabs.indexOf(tab);
    return index < 0 ? false : this.closeTabs(this.tabs.slice(0, index));
  },

  closeSavedTabs() {
    return this.closeTabs(
      this.tabs.filter((tab) => (tab.item.getFileState?.() ?? "unmodified") === "unmodified"),
    );
  },

  closeAllTabs() {
    return this.closeTabs(this.getTabs());
  },

  openInNewWindow(tab) {
    if (!tab) return;
    this.layout.resetWidths();
    return this.transferScope.openInNewWindow(this.pane, tab.item);
  },

  splitTab(direction, tab) {
    if (!tab) return;
    return lumine.workspace.copyPaneItem(tab.item, {
      sourcePane: this.pane,
      splitDirection: direction.slice("split".length).toLowerCase(),
    });
  },

  onDragStart(event) {
    const tab = this.bar.tabForElement(event.target);
    if (!tab) return;
    const descriptor = this.transferScope.createTransfer(this.bar.pane, tab.item);
    this.draggedTab = tab;
    this.dropIndex = null;
    tab.element.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    const uri = descriptor.items[0].uri;
    if (uri != null) {
      event.dataTransfer.setData("text/plain", uri);
      if (process.platform === "darwin") {
        let externalURI;
        try {
          externalURI = new URL(uri).href;
        } catch {
          externalURI = require("node:url").pathToFileURL(uri).href;
        }
        event.dataTransfer.setData("text/uri-list", externalURI);
      }
    }
    lumine.workspaceDrops.write(event.dataTransfer, descriptor);
  },

  updateDropTarget({ offer, native, event }) {
    if (
      offer.kind !== "pane-item" &&
      !((offer.kind === "paths" || offer.kind === "tree-entries") && offer.files) &&
      !(offer.native && (!native.known || native.hasFiles))
    ) {
      this.clearInsertionTarget();
      return;
    }
    const index = this.getDropIndex(event);
    if (index == null || index === this.dropIndex) return;
    this.clearInsertionTarget();
    this.dropIndex = index;
    this.placeholder = this.bar.element.ownerDocument.createElement("li");
    this.placeholder.classList.add("placeholder");
    const next = this.bar.tabs[index];
    const previous = this.bar.tabs[index - 1];
    next?.element.classList.add("is-drop-target");
    if (!next) previous?.element.classList.add("drop-target-is-after");
    this.bar.element.insertBefore(this.placeholder, next?.element ?? null);
  },

  getDropIndex(event) {
    if (event.target === this.placeholder) return;
    const tab = this.bar.tabForElement(event.target) ?? this.bar.tabs.at(-1);
    if (!tab) return 0;
    const { left, width } = tab.element.getBoundingClientRect();
    return this.bar.tabs.indexOf(tab) + (event.clientX < left + width / 2 ? 0 : 1);
  },

  dispatch(event, action) {
    const { bar, tab } = this.resolve(event);
    if (!bar) return;
    return this.run(() => action(bar, tab));
  },

  run(action) {
    try {
      return Promise.resolve(action()).catch((error) => this.report(error));
    } catch (error) {
      this.report(error);
    }
  },

  report(error) {
    if (error?.code === "ABORT_ERR" || error?.name === "AbortError") return;
    lumine.notifications.addWarning("The tab operation could not be completed.", {
      detail: error.message,
      dismissable: true,
    });
  },

  async closeWorkspace() {
    for (const bar of Array.from(this.bars.values())) {
      if (!bar.destroyed && !(await bar.closeAllTabs())) return false;
    }
    return true;
  },
};
