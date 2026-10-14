class TabCommands {
  constructor(bars) {
    this.bars = bars;
    const command = (action, description) => ({
      ...(description ? { description } : {}),
      didDispatch: (event) => this.dispatch(event, action),
    });
    this.subscription = lumine.commands.add("lumine-workspace", {
      "tabs:close-tab": command((bar, tab) => bar.closeTab(tab)),
      "tabs:close-other-tabs": command((bar, tab) => bar.closeOtherTabs(tab)),
      "tabs:close-tabs-to-right": command((bar, tab) => bar.closeTabsToRight(tab)),
      "tabs:close-tabs-to-left": command((bar, tab) => bar.closeTabsToLeft(tab)),
      "tabs:close-saved-tabs": command(
        (bar) => bar.closeSavedTabs(),
        "Close the tabs with nothing unsaved, leaving the rest.",
      ),
      "tabs:close-all-tabs": command((bar) => bar.closeAllTabs()),
      "tabs:close-all-tabs-in-workspace": {
        description: "Close every tab in every pane of this workspace.",
        didDispatch: () => this.run(() => this.closeWorkspace()),
      },
      "tabs:open-in-new-window": command(
        (bar, tab) => bar.openInNewWindow(tab),
        "Move this tab into a new window, keeping its unsaved changes.",
      ),
      "tabs:detach-tab": command(
        (_bar, tab) => tab && lumine.workspace.detachItem(tab.item),
        "Move this tab into an additional window of the same workspace.",
      ),
      "tabs:split-up": command(
        (bar, tab) => bar.splitTab("splitUp", tab),
        "Open a second copy of this tab in a pane above.",
      ),
      "tabs:split-down": command(
        (bar, tab) => bar.splitTab("splitDown", tab),
        "Open a second copy of this tab in a pane below.",
      ),
      "tabs:split-left": command(
        (bar, tab) => bar.splitTab("splitLeft", tab),
        "Open a second copy of this tab in a pane to the left.",
      ),
      "tabs:split-right": command(
        (bar, tab) => bar.splitTab("splitRight", tab),
        "Open a second copy of this tab in a pane to the right.",
      ),
    });
  }

  resolve(...args) {
    return require("./tab-action-runtime.js").resolve.apply(this, args);
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
