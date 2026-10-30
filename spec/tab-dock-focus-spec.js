const path = require("path");

describe("focus after selecting dock tabs", () => {
  let main, centerPane, centerItem;

  function buildItem(title, { delegate = false, focusable = true } = {}) {
    const element = document.createElement("div");
    if (focusable) element.tabIndex = -1;
    const child = document.createElement("input");
    child.setAttribute("aria-label", `${title} input`);
    element.appendChild(child);
    if (delegate) element.focus = (options) => child.focus(options);
    return {
      element,
      child,
      canCopy: () => false,
      getAllowedLocations: () => ["center", "left", "right", "bottom"],
      getTitle: () => title,
      getIconName: () => "tools",
    };
  }

  function mouse(target, type) {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
  }

  function finishTabClickWithoutFocusEvents(target) {
    // Native focus handoff can leave Chromium without renderer focus events.
    // Core's PaneElement regression specs use the same capture suppression.
    const swallow = (event) => event.stopPropagation();
    document.addEventListener("focus", swallow, { capture: true });
    try {
      mouse(target, "mouseup");
      mouse(target, "click");
    } finally {
      document.removeEventListener("focus", swallow, { capture: true });
    }
  }

  beforeEach(async () => {
    jasmine.useRealClock();
    main = (await lumine.packages.activatePackage(path.join(__dirname, ".."))).mainModule;
    const workspace = lumine.workspace.getElement();
    Object.assign(workspace.style, { width: "900px", height: "500px" });
    jasmine.attachToDOM(workspace);
    centerPane = lumine.workspace.getCenter().getActivePane();
    centerItem = buildItem("Center document");
    centerPane.addItem(centerItem);
  });

  for (const location of ["left", "right", "bottom"]) {
    for (const mode of ["titles", "icons"]) {
      describe(`${location} dock with ${mode}`, () => {
        let pane, bar;

        beforeEach(() => {
          lumine.config.set("tabs.dockTabsMode", mode);
          const dock = {
            left: lumine.workspace.getLeftDock(),
            right: lumine.workspace.getRightDock(),
            bottom: lumine.workspace.getBottomDock(),
          }[location];
          pane = dock.getActivePane();
          bar = main.tabBarViews.get(pane);
          dock.show();
        });

        for (const delegate of [false, true]) {
          it(`focuses the ${delegate ? "panel's delegated input" : "focusable panel root"} after native tab-bar focus for both selected and switched tabs`, () => {
            const previous = buildItem("Previous panel", { delegate });
            const chosen = buildItem("Chosen panel", { delegate });
            pane.addItem(previous, { index: 0 });
            pane.addItem(chosen, { index: 1 });
            const target = bar.tabForItem(chosen).itemTitle;
            const expectedFocus = delegate ? chosen.child : chosen.element;

            for (const selectedBeforeClick of [true, false]) {
              pane.activateItem(selectedBeforeClick ? chosen : previous);
              centerPane.activateItem(centerItem, { activatePane: true });
              centerItem.element.focus();
              mouse(target, "mousedown");
              // Chromium may focus the draggable bar after its mousedown
              // listener has already activated and focused the chosen item.
              bar.element.focus();
              expect(document.activeElement).toBe(bar.element);

              finishTabClickWithoutFocusEvents(target);

              expect(pane.getActiveItem()).toBe(chosen);
              expect(lumine.workspace.getActivePane()).toBe(pane);
              expect(document.activeElement).toBe(expectedFocus);
              expect(chosen.element.contains(document.activeElement)).toBeTrue();
            }
          });
        }

        it("reaches the model's focus delegate with either a focusable or unfocusable view root", () => {
          for (const focusable of [true, false]) {
            const item = buildItem("Panel with model focus", { focusable });
            item.focus = (options) => item.child.focus(options);
            pane.addItem(item, { index: pane.getItems().length });
            pane.activateItem(item);
            centerPane.activateItem(centerItem, { activatePane: true });
            centerItem.element.focus();
            const target = bar.tabForItem(item).itemTitle;

            mouse(target, "mousedown");
            if (focusable) expect(document.activeElement).toBe(item.element);
            bar.element.focus();
            finishTabClickWithoutFocusEvents(target);

            expect(pane.getActiveItem()).toBe(item);
            expect(document.activeElement).toBe(item.child);
          }
        });

        it("restores the selected panel's focused child after native tab-bar focus", () => {
          const item = buildItem("Panel with focused input");
          pane.addItem(item);
          pane.activateItem(item, { activatePane: true });
          item.child.focus();
          expect(document.activeElement).toBe(item.child);
          const target = bar.tabForItem(item).itemTitle;

          mouse(target, "mousedown");
          bar.element.focus();
          expect(document.activeElement).toBe(bar.element);
          mouse(target, "mouseup");
          mouse(target, "click");

          expect(pane.getActiveItem()).toBe(item);
          expect(document.activeElement).toBe(item.child);
        });
      });
    }
  }

  it("uses the normal panel focus delegate when its previous control is detached during the press", () => {
    lumine.config.set("tabs.dockTabsMode", "icons");
    const dock = lumine.workspace.getLeftDock();
    const pane = dock.getActivePane();
    const item = buildItem("Panel with replaced input");
    const replacement = document.createElement("input");
    replacement.setAttribute("aria-label", "Replacement input");
    item.element.appendChild(replacement);
    item.focus = (options) => replacement.focus(options);
    pane.addItem(item);
    dock.show();
    pane.activateItem(item, { activatePane: true });
    item.child.focus();
    const bar = main.tabBarViews.get(pane);
    const target = bar.tabForItem(item).itemTitle;

    mouse(target, "mousedown");
    bar.element.focus();
    item.child.remove();
    finishTabClickWithoutFocusEvents(target);

    expect(pane.getActiveItem()).toBe(item);
    expect(document.activeElement).toBe(replacement);
  });

  it("keeps focus in the pane when its active view has no usable focus target", () => {
    lumine.config.set("tabs.dockTabsMode", "icons");
    const dock = lumine.workspace.getLeftDock();
    const pane = dock.getActivePane();
    const item = buildItem("Panel without a focus target", { focusable: false });
    pane.addItem(item);
    dock.show();
    const bar = main.tabBarViews.get(pane);
    const target = bar.tabForItem(item).itemTitle;

    mouse(target, "mousedown");
    bar.element.focus();
    finishTabClickWithoutFocusEvents(target);

    expect(pane.getActiveItem()).toBe(item);
    expect(document.activeElement).toBe(pane.getElement());
    expect(document.activeElement).not.toBe(bar.element);
  });
});
