class TabCommands {
  constructor(bars) {
    this.bars = bars;
    const command = (action, description) => ({
      ...(description ? { description } : {}),
      didDispatch: (event) => this.dispatch(event, action),
    });
    this.subscription = lumine.commands.add("lumine-workspace", {
      "tabs:keep-pending-tab": command(
        (bar, tab) => tab?.terminatePendingState(),
        "Keep the previewed tab, so the next file does not replace it.",
      ),
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
        description: "Close every tab in every pane of this window.",
        didDispatch: () => this.run(() => this.closeWorkspace()),
      },
      "tabs:open-in-new-window": command(
        (bar, tab) => bar.openInNewWindow(tab),
        "Move this tab into a new window, keeping its unsaved changes.",
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

  resolve(event) {
    const target = event?.target;
    const paneElement = target?.closest?.("lumine-pane");
    const pane = paneElement?.getModel() ?? lumine.workspace.getActivePane();
    const bar = this.bars.get(pane);
    if (!bar || bar.destroyed) return {};
    const tab = bar.tabForElement(target) ?? bar.getActiveTab();
    return { bar, tab };
  }

  dispatch(event, action) {
    const { bar, tab } = this.resolve(event);
    if (!bar) return;
    return this.run(() => action(bar, tab));
  }

  run(action) {
    try {
      return Promise.resolve(action()).catch((error) => this.report(error));
    } catch (error) {
      this.report(error);
    }
  }

  report(error) {
    lumine.notifications.addWarning("The tab operation could not be completed.", {
      detail: error.message,
      dismissable: true,
    });
  }

  async closeWorkspace() {
    for (const bar of Array.from(this.bars.values())) {
      if (!bar.destroyed && !(await bar.closeAllTabs())) return false;
    }
    return true;
  }

  dispose() {
    this.subscription.dispose();
  }
}

module.exports = TabCommands;
