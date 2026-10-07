const path = require("path");

describe("pending tab close operations", () => {
  let main, pane, bar, first, second, releaseClose, listener;

  beforeEach(async () => {
    main = (await lumine.packages.activatePackage(path.join(__dirname, ".."))).mainModule;
    first = await lumine.workspace.open();
    pane = lumine.workspace.paneForItem(first);
    second = lumine.workspace.buildTextEditor();
    pane.addItem(second);
    bar = main.tabBarViews.get(pane);
  });

  afterEach(() => {
    releaseClose?.();
    listener?.dispose();
  });

  const deferFirstClose = () => {
    const pending = new Promise((resolve) => (releaseClose = resolve));
    const requested = [];
    listener = pane.onWillDestroyItem(({ item }) => {
      requested.push(item);
      if (item === first) return pending;
    });
    return requested;
  };

  it("retains the items when the package is deactivated during a pending close", async () => {
    const requested = deferFirstClose();
    const closing = bar.closeAllTabs();
    await conditionPromise(() => requested.length === 1);

    await lumine.packages.deactivatePackage("tabs");
    releaseClose();

    expect(await closing).toBe(false);
    expect(pane.getItems()).toEqual([first, second]);
    expect(first.isDestroyed()).toBe(false);
    expect(second.isDestroyed()).toBe(false);
    expect(requested).toEqual([first]);
  });

  it("does not close an item that moved to another pane while the close was pending", async () => {
    const destinationItem = lumine.workspace.buildTextEditor();
    const destination = pane.splitRight({ items: [destinationItem] });
    const requested = deferFirstClose();
    const closing = bar.closeAllTabs();
    await conditionPromise(() => requested.length === 1);

    pane.moveItemToPane(first, destination, 0);
    releaseClose();

    expect(await closing).toBe(false);
    expect(pane.getItems()).toEqual([second]);
    expect(destination.getItems()).toEqual([first, destinationItem]);
    expect(first.isDestroyed()).toBe(false);
    expect(requested).toEqual([first]);
  });
});
