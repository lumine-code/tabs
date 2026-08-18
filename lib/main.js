const { CompositeDisposable } = require("lumine");
const layout = require("./layout");
const TabBarView = require("./tab-bar-view.js");
const _ = require("@lumine-code/underscore-plus");

// The bar's empty space is its own surface: nothing there names a tab, so the
// menu it deploys is the pane's rather than any tab's. A `menus/` entry cannot
// say that — the context menu walks up from the click target, so a `.tab-bar`
// selector matches a tab's ancestor just as well as the bar itself — and
// `shouldDisplay` is the only thing that can tell the two apart.
const onEmptySpace = (event) => event.target?.closest?.(".tab") == null;

module.exports = {
  activate() {
    this.subscriptions = new CompositeDisposable();
    layout.activate();
    this.tabBarViews = [];

    // If the command bubbles up without being handled by a particular pane,
    // close all tabs in all panes
    this.subscriptions.add(
      lumine.commands.add("lumine-workspace", {
        "tabs:close-all-tabs": () => {
          // We loop backwards because the panes are
          // removed from the array as we go
          for (let i = this.tabBarViews.length - 1; i >= 0; i--) {
            this.tabBarViews[i].closeAllTabs();
          }
        },
      }),
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
      if (!container) {
        return;
      }

      this.subscriptions.add(
        container.observePanes((pane) => {
          const tabBarView = new TabBarView(pane, location);

          const paneElement = pane.getElement();
          paneElement.insertBefore(tabBarView.element, paneElement.firstChild);

          this.tabBarViews.push(tabBarView);
          pane.onDidDestroy(() => _.remove(this.tabBarViews, tabBarView));
        }),
      );
    });
  },

  deactivate() {
    layout.deactivate();
    this.subscriptions.dispose();

    for (let tabBarView of this.tabBarViews) {
      tabBarView.destroy();
    }
  },
};
