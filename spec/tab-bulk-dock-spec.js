const path = require("path");

describe("bulk tab closing in docks", () => {
  let main, dockPane, permanent, closable, closeSubscription;

  const permanentItem = () => ({
    element: document.createElement("div"),
    getTitle: () => "Permanent Dock Item",
    isPermanentDockItem: () => true,
  });

  beforeEach(async () => {
    main = (await lumine.packages.activatePackage(path.join(__dirname, ".."))).mainModule;
    dockPane = lumine.workspace.getLeftDock().getActivePane();
    permanent = permanentItem();
    closable = lumine.workspace.buildTextEditor();
    dockPane.addItem(permanent);
    dockPane.addItem(closable);
  });

  afterEach(() => closeSubscription?.dispose());

  it("skips permanent dock tabs while closing the remaining tabs in that pane", async () => {
    expect(await main.tabBarViews.get(dockPane).closeAllTabs()).toBe(true);

    expect(dockPane.getItems()).toEqual([permanent]);
    expect(closable.isDestroyed()).toBe(true);
  });

  it("continues through later docks when closing every tab in the workspace", async () => {
    const rightPane = lumine.workspace.getRightDock().getActivePane();
    const rightItem = lumine.workspace.buildTextEditor();
    rightPane.addItem(rightItem);
    jasmine.attachToDOM(lumine.workspace.getElement());

    lumine.commands.dispatch(lumine.workspace.getElement(), "tabs:close-all-tabs-in-workspace");
    await flushMicrotasks();

    expect(dockPane.getItems()).toEqual([permanent]);
    expect(closable.isDestroyed()).toBe(true);
    expect(rightItem.isDestroyed()).toBe(true);
  });

  it("still stops after a genuine close refusal following a permanent dock tab", async () => {
    const later = lumine.workspace.buildTextEditor();
    dockPane.addItem(later, { index: dockPane.getItems().length });
    const requested = [];
    closeSubscription = lumine.workspace.onWillDestroyPaneItem(({ item, prevent }) => {
      requested.push(item);
      if (item === closable) prevent();
    });

    expect(await main.tabBarViews.get(dockPane).closeAllTabs()).toBe(false);

    expect(dockPane.getItems()).toEqual([permanent, closable, later]);
    expect(requested).toEqual([closable]);
    expect(later.isDestroyed()).toBe(false);
  });

  it("closes a center item even when it declares dock permanence", async () => {
    const pane = lumine.workspace.getCenter().getActivePane();
    const item = permanentItem();
    pane.addItem(item);

    expect(await main.tabBarViews.get(pane).closeAllTabs()).toBe(true);

    expect(pane.getItems()).toEqual([]);
  });
});
