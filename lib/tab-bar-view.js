const { CompositeDisposable, Disposable } = require("lumine");
const TabView = require("./tab-view.js");

const hoverTrackers = new WeakMap();

// Chromium can leave :hover behind after native mouse capture. Resolve the
// real target from the pointer position without changing focus or clicking.
class TabHoverTracker {
  constructor(document) {
    this.document = document;
    this.bars = new Map();
    this.hoveredTab = null;
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseOut = this.onMouseOut.bind(this);
    this.clear = this.clear.bind(this);
    document.addEventListener("mousemove", this.onMouseMove, { capture: true, passive: true });
    document.addEventListener("mouseout", this.onMouseOut, { capture: true, passive: true });
    document.addEventListener("dragstart", this.clear, { capture: true, passive: true });
    document.defaultView.addEventListener("blur", this.clear);
  }

  add(bar) {
    this.bars.set(bar.element, bar);
    return new Disposable(() => {
      this.clearBar(bar);
      this.bars.delete(bar.element);
      if (this.bars.size > 0) return;
      this.document.removeEventListener("mousemove", this.onMouseMove, true);
      this.document.removeEventListener("mouseout", this.onMouseOut, true);
      this.document.removeEventListener("dragstart", this.clear, true);
      this.document.defaultView.removeEventListener("blur", this.clear);
      hoverTrackers.delete(this.document);
    });
  }

  onMouseMove(event) {
    const element = this.document.elementFromPoint(event.clientX, event.clientY);
    const bar = this.bars.get(element?.closest?.(".tab-bar"));
    const tab = bar?.tabForElement(element);
    const fallback = tab && !tab.element.matches(":hover") ? tab : null;
    if (fallback === this.hoveredTab) return;
    this.clear();
    this.hoveredTab = fallback;
    fallback?.element.classList.add("is-hovered");
  }

  onMouseOut(event) {
    if (event.relatedTarget == null) this.clear();
  }

  clearBar(bar) {
    if (this.hoveredTab && bar.tabsByElement.has(this.hoveredTab.element)) this.clear();
  }

  clear() {
    this.hoveredTab?.element.classList.remove("is-hovered");
    this.hoveredTab = null;
  }
}

class TabTitleManager {
  constructor(tabs) {
    this.tabs = tabs;
  }

  refresh() {
    const titles = this.tabs.map((tab) => tab.item.getTitle());
    const counts = new Map();
    for (const title of titles) counts.set(title, (counts.get(title) ?? 0) + 1);

    this.tabs.forEach((tab, index) => {
      const title = titles[index];
      const resolvedTitle = counts.get(title) > 1 ? (tab.item.getLongTitle?.() ?? title) : title;
      tab.updateTitle(resolvedTitle);
    });
  }
}

class TabBarLayout {
  constructor(bar) {
    this.bar = bar;
    this.frame = null;
    this.disposed = false;
    this.bindWindow();
  }

  bindWindow() {
    if (this.frame != null) this.window.cancelAnimationFrame(this.frame);
    this.frame = null;
    this.resizeObserver?.disconnect();
    this.window = this.bar.element.ownerDocument.defaultView;
    this.resizeObserver = new this.window.ResizeObserver(() => this.scheduleOccupancyUpdate());
    this.resizeObserver.observe(this.bar.element);
    for (const tab of this.bar.tabs) this.resizeObserver.observe(tab.element);
    this.scheduleOccupancyUpdate();
  }

  observe(tab) {
    this.resizeObserver.observe(tab.element);
    this.scheduleOccupancyUpdate();
  }

  unobserve(tab) {
    this.resizeObserver.unobserve(tab.element);
    this.scheduleOccupancyUpdate();
  }

  scheduleOccupancyUpdate() {
    if (this.disposed || this.frame != null) return;
    this.frame = this.window.requestAnimationFrame(() => {
      this.frame = null;
      this.updateOccupancy();
    });
  }

  updateOccupancy() {
    const lastTab = this.bar.tabs.at(-1)?.element;
    let occupied = false;
    if (lastTab) {
      const barRect = this.bar.element.getBoundingClientRect();
      const tabRect = lastTab.getBoundingClientRect();
      const margin = Number.parseFloat(this.window.getComputedStyle(lastTab).marginRight) || 0;
      occupied = barRect.width > 0 && tabRect.right + margin >= barRect.right - 1;
    }
    this.bar.element.classList.toggle("is-fully-occupied", occupied);
    return occupied;
  }

  lockWidths() {
    const widths = this.bar.tabs.map((tab) => tab.element.getBoundingClientRect().width);
    this.bar.tabs.forEach((tab, index) => {
      tab.element.style.maxWidth = `${widths[index].toFixed(2)}px`;
    });
  }

  resetWidths() {
    for (const tab of this.bar.tabs) tab.element.style.maxWidth = "";
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.frame != null) this.window.cancelAnimationFrame(this.frame);
    this.frame = null;
    this.resizeObserver.disconnect();
    this.resetWidths();
  }
}

class TabBarInteraction {
  constructor(bar, transferScope) {
    this.bar = bar;
    this.transferScope = transferScope;
    this.subscriptions = new CompositeDisposable();
    this.wheelDelta = 0;
    this.dropIndex = null;
    const listen = (name, handler, options) => {
      const callback = handler.bind(this);
      bar.element.addEventListener(name, callback, options);
      this.subscriptions.add(
        new Disposable(() => bar.element.removeEventListener(name, callback, options)),
      );
    };
    listen("mouseenter", () => bar.layout.lockWidths());
    listen("mouseleave", () => bar.layout.resetWidths());
    listen("wheel", this.onWheel, { passive: true });
    listen("mousedown", this.onMouseDown);
    listen("click", this.onClick);
    listen("auxclick", this.onClick);
    listen("dblclick", this.onDoubleClick);
    listen("dragstart", this.onDragStart);
    listen("dragend", this.onDragEnd);
    listen("dragleave", (event) => {
      if (!bar.element.contains(event.relatedTarget)) bar.layout.resetWidths();
    });
    this.subscriptions.add(
      lumine.config.observe("tabs.tabScrolling", (value) => {
        this.scrolling = value === "platform" ? process.platform === "linux" : value;
      }),
      lumine.config.observe("tabs.tabScrollingThreshold", (value) => {
        this.scrollingThreshold = Math.max(1, value);
      }),
      lumine.workspaceDrops.addTarget(
        bar.element,
        {
          surface: "tab-bar",
          getPane: () => bar.pane,
          dropElement: bar.element,
          getIndex: (event) => this.getDropIndex(event),
          onDragEnter: (context) => this.updateDropTarget(context),
          onDragOver: (context) => this.updateDropTarget(context),
          onDragLeave: () => this.clearInsertionTarget(),
          onDropFinished: () => this.clearInsertionTarget(),
        },
        { priority: 100 },
      ),
    );
  }

  onMouseDown(event) {
    const { bar } = this;
    const tab = bar.tabForElement(event.target);
    const context =
      event.button === 2 || (event.button === 0 && event.ctrlKey && process.platform === "darwin");
    this.tabFocusToRestore = null;
    if (!bar.pane.isDestroyed()) {
      // Select before focus publishes the pane, so observers see only the
      // chosen item rather than its previously selected item first.
      if (tab && event.button === 0 && !context && !event.target.closest(".close-icon")) {
        const view = bar.paneElement.getActiveView();
        const focused = bar.element.ownerDocument.activeElement;
        if (bar.pane.getActiveItem() === tab.item && focused !== view && view?.contains(focused)) {
          // Native mousedown focuses the draggable bar after this handler.
          // Retain the panel's current control until the click completes.
          this.tabFocusToRestore = { tab, element: focused };
        }
        bar.pane.activateItem(tab.item, { activatePane: true });
      } else {
        bar.pane.activate();
      }
    }
    if (context) {
      bar.layout.resetWidths();
      this.setContextTab(tab);
    }
    if (tab && (context || event.button === 1)) event.preventDefault();
  }

  onClick(event) {
    const { bar } = this;
    const focusToRestore = this.tabFocusToRestore;
    this.tabFocusToRestore = null;
    const tab = bar.tabForElement(event.target);
    if (!tab) return;
    event.preventDefault();
    if (
      event.button === 2 ||
      (event.button === 0 && event.ctrlKey && process.platform === "darwin")
    )
      return;
    if (event.button === 0 && !event.target.closest(".close-icon")) {
      bar.pane.activateItem(tab.item);
      const view = bar.paneElement.getActiveView();
      const document = bar.element.ownerDocument;
      if (
        focusToRestore?.tab === tab &&
        focusToRestore.element.isConnected &&
        view?.contains(focusToRestore.element)
      ) {
        focusToRestore.element.focus({ preventScroll: true });
      }
      // Keep a control that already owns focus. Focusing the root again can
      // reset an input or a panel's remembered selection.
      if (view?.contains(document.activeElement) && document.activeElement !== view) return;
      // Panel models can name a more useful target than their DOM root, such
      // as a navigation list or a terminal input. A root focused by mousedown
      // must still reach that delegate on release.
      if (tab.item !== view && typeof tab.item.focus === "function") tab.item.focus();
      // Chromium can focus the draggable bar after mousedown. Reach the view
      // directly rather than relying on another native pane focus event.
      if (!view?.contains(document.activeElement)) bar.paneElement.focusActiveView();
    } else if (event.button === 1) {
      void bar.closeTab(tab);
    }
  }

  onDoubleClick(event) {
    if (
      event.button !== 0 ||
      (event.ctrlKey && process.platform === "darwin") ||
      event.target.closest(".close-icon")
    )
      return;
    const tab = this.bar.tabForElement(event.target);
    if (tab) {
      this.bar.pane.activateItem(tab.item);
      this.bar.pane.togglePendingItem();
    } else if (event.target === this.bar.element) {
      lumine.commands.dispatch(this.bar.element, "application:new-file");
      event.preventDefault();
    }
  }

  onWheel(event) {
    if (event.shiftKey || !this.scrolling) return;
    const scale =
      event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? this.bar.element.clientHeight : 1;
    this.wheelDelta += event.deltaY * scale;
    if (this.wheelDelta >= this.scrollingThreshold) {
      this.wheelDelta = 0;
      this.bar.pane.activateNextItem();
    } else if (this.wheelDelta <= -this.scrollingThreshold) {
      this.wheelDelta = 0;
      this.bar.pane.activatePreviousItem();
    }
  }

  setContextTab(tab) {
    this.contextTab?.element.classList.remove("right-clicked");
    this.contextTab = tab;
    tab?.element.classList.add("right-clicked");
  }

  onDragStart(...args) {
    this.tabFocusToRestore = null;
    return require("./tab-action-runtime.js").onDragStart.apply(this, args);
  }
  onDragEnd() {
    this.tabFocusToRestore = null;
    // Core's session TTL handles abandoned drags; dragend can arrive before
    // a destination window acknowledges a successful transfer.
    this.bar.layout.resetWidths();
    this.bar.hoverTracker?.clearBar(this.bar);
    this.draggedTab?.element.classList.remove("is-dragging");
    this.draggedTab = null;
    this.clearInsertionTarget();
  }

  removeTab(tab) {
    if (this.tabFocusToRestore?.tab === tab) this.tabFocusToRestore = null;
    this.bar.hoverTracker?.clearBar(this.bar);
    if (tab === this.draggedTab) this.onDragEnd();
    if (tab === this.contextTab) this.setContextTab(undefined);
  }

  updateDropTarget(...args) {
    return require("./tab-action-runtime.js").updateDropTarget.apply(this, args);
  }

  getDropIndex(...args) {
    return require("./tab-action-runtime.js").getDropIndex.apply(this, args);
  }
  clearInsertionTarget() {
    this.dropIndex = null;
    for (const tab of this.bar.tabs) {
      tab.element.classList.remove("is-drop-target", "drop-target-is-after");
    }
    this.placeholder?.remove();
    this.placeholder = null;
  }

  dispose() {
    this.subscriptions.dispose();
    this.onDragEnd();
    this.setContextTab(undefined);
  }
}

class TabBarView {
  constructor(pane, location, transferScope) {
    this.pane = pane;
    this.location = location;
    this.transferScope = transferScope;
    this.paneElement = pane.getElement();
    this.element = this.paneElement.ownerDocument.createElement("ul");
    this.element.classList.add("list-inline", "tab-bar", "inset-panel");
    this.element.setAttribute("is", "lumine-tabs");
    this.element.setAttribute("tabindex", -1);
    this.element.setAttribute("location", location);
    this.tabs = [];
    this.tabsByItem = new Map();
    this.tabsByElement = new WeakMap();
    this.titleManager = new TabTitleManager(this.tabs);
    if (["left", "right", "bottom"].includes(location)) {
      this.closeButton = this.paneElement.ownerDocument.createElement("button");
      this.closeButton.type = "button";
      this.closeButton.classList.add("dock-tab-close");
      this.closeButton.setAttribute("aria-label", "Close Active Tab");
      this.closeButton.title = "Close Active Tab";
      const closeIcon = this.paneElement.ownerDocument.createElement("span");
      closeIcon.classList.add("close-icon");
      closeIcon.setAttribute("aria-hidden", "true");
      this.closeButton.appendChild(closeIcon);
      this.closeButton.hidden = true;
      this.closeButton.disabled = true;
      this.closeButton.onmousedown = (event) => {
        // Keep the item's focus until its normal close/save flow takes over.
        if (event.button === 0) event.preventDefault();
      };
      this.closeButton.onclick = (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        void this.closeActiveTab();
      };
      // Pane overlays follow item-views; the tab list stays a pure drag surface.
      this.paneElement.appendChild(this.closeButton);
    }
    this.layout = new TabBarLayout(this);
    this.interaction = new TabBarInteraction(this, transferScope);
    this.bindHoverWindow();
    this.subscriptions = new CompositeDisposable(
      this.layout,
      this.interaction,
      new Disposable(() => {
        this.hoverSubscription?.dispose();
        this.hoverSubscription = null;
        this.hoverTracker = null;
      }),
    );
    if (this.closeButton) {
      this.subscriptions.add(
        lumine.workspaceDrops.addTarget(this.closeButton, {
          getPane: () => this.pane,
          canDrop: () => false,
        }),
      );
    }

    for (const item of pane.getItems()) this.addTabForItem(item);
    this.subscriptions.add(
      pane.onDidDestroy(() => this.destroy()),
      pane.onDidAddItem(({ item, index, moved, transferred }) =>
        this.addTabForItem(item, index, { moved: moved || transferred }),
      ),
      pane.onDidMoveItem(({ item, newIndex }) => this.moveItemTabToIndex(item, newIndex)),
      pane.onDidRemoveItem(({ item }) => this.removeTabForItem(item)),
      pane.onDidChangeActiveItem(() => this.updateActiveTab()),
      pane.onDidChangeWindow(() => {
        this.interaction.onDragEnd();
        this.bindHoverWindow();
        this.layout.bindWindow();
      }),
      lumine.config.observe("tabs.alwaysShowTabBar", () => this.updateTabBarVisibility()),
      lumine.config.observe("tabs.dockTabsMode", () => this.updateTabPresentation()),
    );
    this.updateActiveTab();
  }

  bindHoverWindow() {
    this.hoverSubscription?.dispose();
    const document = this.element.ownerDocument;
    let tracker = hoverTrackers.get(document);
    if (!tracker) {
      tracker = new TabHoverTracker(document);
      hoverTrackers.set(document, tracker);
    }
    this.hoverTracker = tracker;
    this.hoverSubscription = tracker.add(this);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.subscriptions.dispose();
    for (const tab of this.tabs) tab.destroy();
    this.tabs.length = 0;
    this.tabsByItem.clear();
    this.tabsByElement = new WeakMap();
    this.activeTab = null;
    this.closeButton?.remove();
    this.element.remove();
  }

  addTabForItem(item, index, { moved = false } = {}) {
    const tab = new TabView({
      item,
      pane: this.pane,
      location: this.location,
      didChangeTitle: () => this.titleManager.refresh(),
      didClickCloseIcon: () => this.closeTab(tab),
    });
    tab.setIconsOnly(Boolean(this.iconsOnly));
    if (moved) tab.terminatePendingState();
    this.tabsByItem.set(item, tab);
    this.tabsByElement.set(tab.element, tab);
    this.insertTabAtIndex(tab, index);
    if (!moved && lumine.config.get("tabs.addNewTabsAtEnd")) {
      this.pane.moveItem(item, this.pane.getItems().length - 1);
    }
  }

  moveItemTabToIndex(item, index) {
    const tab = this.tabsByItem.get(item);
    if (!tab) return;
    this.tabs.splice(this.tabs.indexOf(tab), 1);
    this.insertTabAtIndex(tab, index);
    lumine.commands.invalidateAvailability();
  }

  insertTabAtIndex(tab, index = this.tabs.length) {
    this.element.insertBefore(tab.element, this.tabs[index]?.element ?? null);
    this.tabs.splice(index, 0, tab);
    this.titleManager.refresh();
    this.layout.observe(tab);
    this.updateTabBarVisibility();
  }

  removeTabForItem(item) {
    const tab = this.tabsByItem.get(item);
    if (!tab) return;
    this.tabs.splice(this.tabs.indexOf(tab), 1);
    this.tabsByItem.delete(item);
    this.interaction.removeTab(tab);
    this.tabsByElement.delete(tab.element);
    this.layout.unobserve(tab);
    if (tab === this.activeTab) this.activeTab = null;
    tab.destroy();
    this.titleManager.refresh();
    this.updateTabBarVisibility();
  }

  updateTabBarVisibility() {
    this.element.classList.toggle(
      "hidden",
      !lumine.config.get("tabs.alwaysShowTabBar") && this.tabs.length <= 1,
    );
    this.updateCloseButton();
  }

  updateTabPresentation() {
    this.iconsOnly =
      ["left", "right", "bottom"].includes(this.location) &&
      lumine.config.get("tabs.dockTabsMode") === "icons";
    // A width lock or drag marker measured against title tabs is stale after
    // switching presentation, even if the pointer has not left the bar yet.
    this.layout.resetWidths();
    this.interaction.clearInsertionTarget();
    this.element.classList.toggle("icons-only", this.iconsOnly);
    for (const tab of this.tabs) tab.setIconsOnly(this.iconsOnly);
    this.updateCloseButton();
    this.layout.scheduleOccupancyUpdate();
    this.activeTab?.element.scrollIntoView(false);
  }

  getTabs() {
    return this.tabs.slice();
  }

  tabAtIndex(index) {
    return this.tabs[index];
  }

  tabForItem(item) {
    return this.tabsByItem.get(item);
  }

  tabForElement(element) {
    return this.tabsByElement.get(element?.closest?.(".tab"));
  }

  getActiveTab() {
    return this.tabForItem(this.pane.getActiveItem());
  }

  updateActiveTab() {
    const tab = this.getActiveTab();
    this.updateCloseButton();
    if (tab === this.activeTab) return;
    this.activeTab?.element.classList.remove("active");
    this.activeTab = tab ?? null;
    if (tab) {
      tab.element.classList.add("active");
      tab.element.scrollIntoView(false);
    }
  }

  updateCloseButton() {
    if (!this.closeButton) return;
    const tab = this.getActiveTab();
    this.closeButton.hidden =
      !this.iconsOnly || this.tabs.length === 0 || this.element.classList.contains("hidden");
    this.closeButton.disabled =
      !tab ||
      Boolean(this.closingActiveTab) ||
      Boolean(tab.item.isDestroyed?.()) ||
      Boolean(tab.item.isPermanentDockItem?.());
  }

  async closeActiveTab() {
    if (this.destroyed) return false;
    this.updateCloseButton();
    if (!this.closeButton || this.closeButton.hidden || this.closeButton.disabled) return false;
    const tab = this.getActiveTab();
    this.closingActiveTab = true;
    this.updateCloseButton();
    try {
      return await this.closeTab(tab);
    } catch (error) {
      require("./tab-action-runtime.js").report(error);
      return false;
    } finally {
      this.closingActiveTab = false;
      if (!this.destroyed) this.updateCloseButton();
    }
  }

  closeTab(...args) {
    return require("./tab-action-runtime.js").closeTab.apply(this, args);
  }

  closeTabs(...args) {
    return require("./tab-action-runtime.js").closeTabs.apply(this, args);
  }

  closeOtherTabs(...args) {
    return require("./tab-action-runtime.js").closeOtherTabs.apply(this, args);
  }

  closeTabsToRight(...args) {
    return require("./tab-action-runtime.js").closeTabsToRight.apply(this, args);
  }

  closeTabsToLeft(...args) {
    return require("./tab-action-runtime.js").closeTabsToLeft.apply(this, args);
  }

  closeSavedTabs(...args) {
    return require("./tab-action-runtime.js").closeSavedTabs.apply(this, args);
  }

  closeAllTabs(...args) {
    return require("./tab-action-runtime.js").closeAllTabs.apply(this, args);
  }

  openInNewWindow(...args) {
    return require("./tab-action-runtime.js").openInNewWindow.apply(this, args);
  }

  splitTab(...args) {
    return require("./tab-action-runtime.js").splitTab.apply(this, args);
  }
}

module.exports = TabBarView;
Object.assign(TabBarView, { TabTitleManager, TabBarLayout, TabBarInteraction });
