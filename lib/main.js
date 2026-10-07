const { CompositeDisposable } = require("lumine");
const TabBarView = require("./tab-bar-view.js");
const TabDropProvider = require("./tab-drop-provider.js");
const TabCommands = require("./tab-commands.js");

// The bar's empty space is its own surface: nothing there names a tab, so the
// menu it deploys is the pane's rather than any tab's. A `menus/` entry cannot
// say that — the context menu walks up from the click target, so a `.tab-bar`
// selector matches a tab's ancestor just as well as the bar itself — and
// `shouldDisplay` is the only thing that can tell the two apart.
const onEmptySpace = (event) => event.target?.closest?.(".tab") == null;

module.exports = {
  provideBackgroundTips() {
    return {
      packageName: "tabs",
      tips: [
        "{% if keys['tabs:close-other-tabs'] %}You can close every tab but the active one with {{ 'tabs:close-other-tabs' | keystroke }}{% else %}You can close every tab but the active one from the tab's context menu.{% endif %}",
      ],
    };
  },

  activate() {
    if (this.subscriptions != null) return;
    this.subscriptions = new CompositeDisposable();
    this.tabBarViews = new Map();
    this.transferScope = lumine.paneItemTransfers.createScope();
    this.subscriptions.add(this.transferScope, new TabCommands(this.tabBarViews));
    this.subscriptions.add(
      lumine.workspaceDrops.addProvider(new TabDropProvider(this.transferScope), { priority: 100 }),
    );

    this.subscriptions.add(
      lumine.contextMenu.add({
        ".tab-bar": [
          { type: "separator" },
          {
            label: "Close Saved Tabs",
            command: "tabs:close-saved-tabs",
            shouldDisplay: onEmptySpace,
          },
          {
            label: "Close All Tabs",
            command: "tabs:close-all-tabs",
            shouldDisplay: onEmptySpace,
          },
          { type: "separator" },
          {
            label: "Close Pane",
            command: "pane:close",
            shouldDisplay: onEmptySpace,
          },
          { type: "separator" },
        ],
      }),
    );

    const paneContainers = {
      center: lumine.workspace.getCenter(),
      left: lumine.workspace.getLeftDock(),
      right: lumine.workspace.getRightDock(),
      bottom: lumine.workspace.getBottomDock(),
    };

    Object.keys(paneContainers).forEach((location) => {
      const container = paneContainers[location];
      this.subscriptions.add(
        container.observePanes((pane) => {
          const tabBarView = new TabBarView(pane, location, this.transferScope);

          const paneElement = pane.getElement();
          paneElement.insertBefore(tabBarView.element, paneElement.firstChild);

          this.tabBarViews.set(pane, tabBarView);
          const paneSubscriptions = new CompositeDisposable();
          paneSubscriptions.add(
            pane.onDidDestroy(() => {
              this.tabBarViews.delete(pane);
              this.subscriptions.remove(paneSubscriptions);
              paneSubscriptions.dispose();
            }),
          );
          this.subscriptions.add(paneSubscriptions);
        }),
      );
    });
  },

  deactivate() {
    if (this.subscriptions == null) return;
    this.subscriptions.dispose();
    this.subscriptions = null;

    for (const tabBarView of this.tabBarViews.values()) {
      tabBarView.destroy();
    }
    this.tabBarViews.clear();
    this.transferScope = null;
  },
};
