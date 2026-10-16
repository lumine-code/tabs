class TabCommands {
  constructor(bars) {
    this.bars = bars;
    const command = (action, description, kind = "tab") => ({
      ...(description ? { description } : {}),
      isAvailable: (event) => this.isAvailable(event, kind),
      didDispatch: (event) => this.dispatch(event, action),
    });
    this.subscription = lumine.commands.add("lumine-workspace", {
      "tabs:close-tab": command((bar, tab) => bar.closeTab(tab), undefined, "close"),
      "tabs:close-other-tabs": command((bar, tab) => bar.closeOtherTabs(tab)),
      "tabs:close-tabs-to-right": command((bar, tab) => bar.closeTabsToRight(tab)),
      "tabs:close-tabs-to-left": command((bar, tab) => bar.closeTabsToLeft(tab)),
      "tabs:close-saved-tabs": command(
        (bar) => bar.closeSavedTabs(),
        "Close the tabs with nothing unsaved, leaving the rest.",
        "bar",
      ),
      "tabs:close-all-tabs": command((bar) => bar.closeAllTabs(), undefined, "bar"),
      "tabs:close-all-tabs-in-workspace": {
        description: "Close every tab in every pane of this workspace.",
        isAvailable: () =>
          [...this.bars.values()].some(
            (bar) => !bar.destroyed && bar.tabs.some((tab) => this.canClose(bar, tab)),
          ),
        didDispatch: () => this.run(() => this.closeWorkspace()),
      },
      "tabs:open-in-new-window": command(
        (bar, tab) => bar.openInNewWindow(tab),
        "Move this tab into a new window, keeping its unsaved changes.",
        "new-window",
      ),
      "tabs:detach-tab": command(
        (_bar, tab) => tab && lumine.workspace.detachItem(tab.item),
        "Move this tab into an additional window of the same workspace.",
        "detach",
      ),
      "tabs:split-up": command(
        (bar, tab) => bar.splitTab("splitUp", tab),
        "Open a second copy of this tab in a pane above.",
        "copy",
      ),
      "tabs:split-down": command(
        (bar, tab) => bar.splitTab("splitDown", tab),
        "Open a second copy of this tab in a pane below.",
        "copy",
      ),
      "tabs:split-left": command(
        (bar, tab) => bar.splitTab("splitLeft", tab),
        "Open a second copy of this tab in a pane to the left.",
        "copy",
      ),
      "tabs:split-right": command(
        (bar, tab) => bar.splitTab("splitRight", tab),
        "Open a second copy of this tab in a pane to the right.",
        "copy",
      ),
    });
  }

  resolve(event) {
    const target = event?.target;
    const element = target?.nodeType === 1 ? target : target?.parentElement;
    const pane =
      event?.context?.pane ??
      element?.closest("lumine-pane")?.getModel() ??
      event?.context?.window?.getEditorContainer().getActivePane() ??
      lumine.workspace.getActivePane();
    const bar = this.bars.get(pane);
    if (!bar || bar.destroyed) return {};
    const clicked = bar.tabForElement(element);
    const tab = clicked ?? (element?.closest(".tab") ? null : bar.getActiveTab());
    return { bar, tab };
  }

  canClose(bar, tab) {
    return Boolean(
      tab &&
      !tab.item.isDestroyed?.() &&
      (bar.location === "center" || !tab.item.isPermanentDockItem?.()),
    );
  }

  isAvailable(event, kind) {
    const { bar, tab } = this.resolve(event);
    if (!bar) return false;
    if (kind === "bar") return bar.tabs.some((candidate) => this.canClose(bar, candidate));
    const item = tab?.item;
    if (!item || item.isDestroyed?.()) return false;
    if (kind === "close") return this.canClose(bar, tab);
    if (kind === "copy") return typeof item.copy === "function" && item.canCopy?.() !== false;
    if (kind === "detach") return bar.location === "center";
    if (kind === "new-window") {
      const locations = item.getAllowedLocations?.();
      const center = locations
        ? locations.includes("center")
        : (item.getDefaultLocation?.() || "center") === "center";
      return center && (typeof item.getURI?.() === "string" || typeof item.getText === "function");
    }
    return true;
  }

  dispatch(...args) {
    return require("./tab-action-runtime.js").dispatch.apply(this, args);
  }

  run(...args) {
    return require("./tab-action-runtime.js").run.apply(this, args);
  }

  report(...args) {
    return require("./tab-action-runtime.js").report.apply(this, args);
  }

  closeWorkspace(...args) {
    return require("./tab-action-runtime.js").closeWorkspace.apply(this, args);
  }
  dispose() {
    this.subscription.dispose();
  }
}

module.exports = TabCommands;
