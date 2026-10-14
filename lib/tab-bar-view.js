const { CompositeDisposable } = require("lumine");
const TabView = require("./tab-view.js");
const TabTitleManager = require("./tab-title-manager.js");
const TabBarLayout = require("./tab-bar-layout.js");
const TabBarInteraction = require("./tab-bar-interaction.js");

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
    this.layout = new TabBarLayout(this);
    this.interaction = new TabBarInteraction(this, transferScope);
    this.subscriptions = new CompositeDisposable(this.layout, this.interaction);

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
        this.layout.bindWindow();
      }),
      lumine.config.observe("tabs.alwaysShowTabBar", () => this.updateTabBarVisibility()),
    );
    this.updateActiveTab();
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
    this.tabsByElement.delete(tab.element);
    this.interaction.removeTab(tab);
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
    if (tab === this.activeTab) return;
    this.activeTab?.element.classList.remove("active");
    this.activeTab = tab ?? null;
    if (tab) {
      tab.element.classList.add("active");
      tab.element.scrollIntoView(false);
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
