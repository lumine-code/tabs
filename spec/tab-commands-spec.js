const path = require("path");

describe("tab command targets", () => {
  let main, pane, first, active, otherPane, other;

  beforeEach(async () => {
    main = (await lumine.packages.activatePackage(path.join(__dirname, ".."))).mainModule;
    first = await lumine.workspace.open();
    pane = lumine.workspace.paneForItem(first);
    active = lumine.workspace.buildTextEditor();
    pane.addItem(active);
    pane.activateItem(active);
    other = lumine.workspace.buildTextEditor();
    otherPane = pane.splitRight({ items: [other] });
    pane.activate();
    jasmine.attachToDOM(lumine.workspace.getElement());
  });

  const barFor = (targetPane) => main.tabBarViews.get(targetPane);

  it("uses the dispatch target without requiring an earlier context click", () => {
    lumine.commands.dispatch(barFor(pane).tabForItem(first).itemTitle, "tabs:close-tab");
    expect(pane.getItems()).toEqual([active]);
    expect(active.isDestroyed()).toBe(false);
  });

  it("uses the active tab from the palette after another tab was right-clicked", () => {
    barFor(pane)
      .tabForItem(first)
      .element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 2 }));
    const scope = main.transferScope;
    spyOn(scope, "openInNewWindow").and.resolveTo({});
    lumine.commands.dispatch(pane.getElement(), "tabs:open-in-new-window");
    expect(scope.openInNewWindow).toHaveBeenCalledOnceWith(pane, active);
    expect(pane.getItems()).toEqual([first, active]);
  });

  it("closes only the active pane when dispatched from the workspace", async () => {
    lumine.commands.dispatch(lumine.workspace.getElement(), "tabs:close-all-tabs");
    await conditionPromise(() => pane.getItems().length === 0);
    expect(otherPane.getItems()).toEqual([other]);
  });

  it("has a separate command for closing every pane", async () => {
    lumine.commands.dispatch(lumine.workspace.getElement(), "tabs:close-all-tabs-in-workspace");
    await conditionPromise(() => lumine.workspace.getPaneItems().length === 0);
  });

  it("stops batch close after a refused item", async () => {
    const originalDestroyItem = pane.destroyItem.bind(pane);
    spyOn(pane, "destroyItem").and.callFake((item) =>
      item === first ? Promise.resolve(false) : originalDestroyItem(item),
    );
    const closed = await barFor(pane).closeAllTabs();
    expect(closed).toBe(false);
    expect(pane.destroyItem.calls.count()).toBe(1);
    expect(pane.destroyItem.calls.first().args[0]).toBe(first);
    expect(pane.getItems()).toEqual([first, active]);
  });

  it("offers split commands from an editor as well as a tab", () => {
    lumine.commands.dispatch(pane.getElement(), "tabs:split-down");
    const copy = lumine.workspace
      .getCenter()
      .getPanes()
      .find((candidate) =>
        candidate.getItems().some((item) => item !== first && item !== active && item !== other),
      );
    expect(copy).toBeDefined();
  });
});
