const TabDropProvider = require("../lib/tab-drop-provider");

describe("TabDropProvider", () => {
  let item;
  let provider;
  let sourcePane;
  let tabTransferService;
  let targetPane;
  let windowService;
  let workspace;

  function createPane(id, items = []) {
    const pane = {
      id,
      items,
      activeItem: items[0] || null,
      getItems: () => pane.items,
      getActiveItem: () => pane.activeItem,
      getActiveItemIndex: () => pane.items.indexOf(pane.activeItem),
      moveItem: jasmine.createSpy("moveItem").and.callFake((movedItem, index) => {
        pane.items.splice(pane.items.indexOf(movedItem), 1);
        pane.items.splice(index, 0, movedItem);
      }),
      moveItemToPane: jasmine
        .createSpy("moveItemToPane")
        .and.callFake((movedItem, otherPane, index) => {
          pane.items.splice(pane.items.indexOf(movedItem), 1);
          otherPane.items.splice(index, 0, movedItem);
        }),
      activateItem: jasmine.createSpy("activateItem").and.callFake((activeItem) => {
        pane.activeItem = activeItem;
      }),
      activate: jasmine.createSpy("activate"),
      destroyItem: jasmine.createSpy("destroyItem").and.callFake(async (destroyedItem) => {
        const index = pane.items.indexOf(destroyedItem);
        if (index < 0) return false;
        pane.items.splice(index, 1);
        return true;
      }),
    };
    return pane;
  }

  function descriptor(overrides = {}) {
    return {
      kind: "pane-item",
      token: "transfer-token",
      effect: "move",
      allowedLocations: ["center"],
      source: { windowId: 7, paneId: sourcePane.id, onlyItem: false },
      items: [{ type: "pane-item", uri: "C:\\project\\file.txt" }],
      ...overrides,
    };
  }

  function context(pane = targetPane, index = 1, overrides = {}) {
    return {
      pane,
      index,
      surface: "tab-bar",
      resolvePane: jasmine.createSpy("resolvePane").and.returnValue(pane),
      ...overrides,
    };
  }

  beforeEach(() => {
    item = { name: "dragged" };
    sourcePane = createPane(10, [{ name: "before" }, item, { name: "after" }]);
    targetPane = createPane(20, [{ name: "target" }]);
    workspace = {
      paneForItem: jasmine.createSpy("paneForItem").and.callFake((candidate) => {
        if (sourcePane.items.includes(candidate)) return sourcePane;
        if (targetPane.items.includes(candidate)) return targetPane;
        return null;
      }),
      open: jasmine.createSpy("open"),
      getPaneItems: () => [...sourcePane.items, ...targetPane.items],
    };
    tabTransferService = {
      getSession: jasmine.createSpy("getSession").and.returnValue({ pane: sourcePane, item }),
      release: jasmine.createSpy("release"),
      commitRemote: jasmine.createSpy("commitRemote").and.resolveTo(true),
    };
    windowService = {
      getId: () => 7,
      focus: jasmine.createSpy("focus").and.resolveTo(),
    };
    provider = new TabDropProvider(tabTransferService, { workspace, windowService });
  });

  it("claims pane items and suppresses a split for the only item over its own pane", () => {
    expect(
      provider.propose({
        offer: descriptor({ source: { windowId: 7, paneId: 10, onlyItem: true } }),
        pane: sourcePane,
      }),
    ).toEqual({ effect: "move", allowedLocations: ["center"], allowSplit: false });
    expect(provider.propose({ offer: descriptor(), pane: targetPane }).allowSplit).toBe(true);
    expect(provider.propose({ offer: { kind: "paths" }, pane: targetPane })).toBeNull();
  });

  it("validates the complete descriptor and resolves the exact same-window session", () => {
    const payload = descriptor();
    const prepared = provider.prepareDrop({ descriptor: payload, pane: targetPane });

    expect(tabTransferService.getSession).toHaveBeenCalledOnceWith("transfer-token");
    expect(prepared).toEqual(
      jasmine.objectContaining({
        descriptor: payload,
        transferItem: payload.items[0],
        sourceWindowId: 7,
        sameWindow: true,
        session: { pane: sourcePane, item },
        allowSplit: true,
      }),
    );
    expect(
      provider.prepareDrop({ descriptor: descriptor({ token: "" }), pane: targetPane }),
    ).toBeNull();
    expect(
      provider.prepareDrop({ descriptor: descriptor({ items: [] }), pane: targetPane }),
    ).toBeNull();
    tabTransferService.getSession.and.returnValue(null);
    expect(provider.prepareDrop({ descriptor: payload, pane: targetPane })).toBeNull();
  });

  it("moves the exact local item, activates the target and releases the session", async () => {
    const payload = descriptor();
    const prepared = provider.prepareDrop({ descriptor: payload, pane: targetPane });
    const dropContext = context(targetPane, 1);

    const result = await provider.perform(dropContext, prepared);

    expect(dropContext.resolvePane).toHaveBeenCalledOnceWith({ allowSplit: true });
    expect(sourcePane.moveItemToPane).toHaveBeenCalledOnceWith(item, targetPane, 1);
    expect(targetPane.activateItem).toHaveBeenCalledOnceWith(item);
    expect(targetPane.activate).toHaveBeenCalled();
    expect(tabTransferService.release).toHaveBeenCalledOnceWith(
      "transfer-token",
      "item moved within its source window",
    );
    expect(result).toEqual({ pane: targetPane, item });
  });

  it("marks the target tab bar while an item crosses pane boundaries", async () => {
    const targetTabBar = { isItemMovingBetweenPanes: false };
    provider = new TabDropProvider(tabTransferService, {
      workspace,
      windowService,
      getTabBarForPane: (pane) => (pane === targetPane ? targetTabBar : null),
    });
    sourcePane.moveItemToPane.and.callFake((movedItem, otherPane, index) => {
      expect(targetTabBar.isItemMovingBetweenPanes).toBe(true);
      sourcePane.items.splice(sourcePane.items.indexOf(movedItem), 1);
      otherPane.items.splice(index, 0, movedItem);
    });
    const prepared = provider.prepareDrop({ descriptor: descriptor(), pane: targetPane });

    await provider.perform(context(targetPane, 1), prepared);

    expect(targetTabBar.isItemMovingBetweenPanes).toBe(false);
  });

  it("uses the exact session item even when the source pane order changed", async () => {
    sourcePane.items.unshift(sourcePane.items.pop());
    const prepared = provider.prepareDrop({ descriptor: descriptor(), pane: targetPane });

    await provider.perform(context(targetPane, 1), prepared);

    expect(sourcePane.moveItemToPane).toHaveBeenCalledOnceWith(item, targetPane, 1);
  });

  it("does not reorder a tab dropped on the center of its current pane", async () => {
    const prepared = provider.prepareDrop({ descriptor: descriptor(), pane: sourcePane });
    const dropContext = context(sourcePane, 3, {
      surface: "pane",
      candidateSplit: null,
    });

    await provider.perform(dropContext, prepared);

    expect(dropContext.resolvePane).not.toHaveBeenCalled();
    expect(sourcePane.moveItem).not.toHaveBeenCalled();
    expect(sourcePane.moveItemToPane).not.toHaveBeenCalled();
    expect(sourcePane.activateItem).not.toHaveBeenCalled();
    expect(sourcePane.activate).not.toHaveBeenCalled();
    expect(tabTransferService.release).toHaveBeenCalledOnceWith(
      "transfer-token",
      "item dropped on its current pane",
    );
  });

  it("reorders a local pane without creating a split or releasing a wrong item", async () => {
    const prepared = provider.prepareDrop({ descriptor: descriptor(), pane: sourcePane });
    const dropContext = context(sourcePane, 3);

    await provider.perform(dropContext, prepared);

    expect(sourcePane.moveItem).toHaveBeenCalledOnceWith(item, 2);
    expect(sourcePane.items.map(({ name }) => name)).toEqual(["before", "after", "dragged"]);
    expect(sourcePane.moveItemToPane).not.toHaveBeenCalled();
  });

  it("opens a remote item in the resolved pane, restores text, focuses and then commits", async () => {
    const remoteItem = { setText: jasmine.createSpy("setText") };
    const openedPane = createPane(30, [remoteItem]);
    workspace.open.and.resolveTo(remoteItem);
    workspace.paneForItem.and.callFake((candidate) =>
      candidate === remoteItem ? openedPane : null,
    );
    const payload = descriptor({
      source: { windowId: 8, paneId: 11, onlyItem: true },
      items: [{ type: "pane-item", uri: "", modifiedText: "unsaved text" }],
    });
    const prepared = provider.prepareDrop({ descriptor: payload, pane: targetPane });
    const dropContext = context(targetPane, 1);
    const order = [];
    targetPane.activate.and.callFake(() => order.push("activate"));
    windowService.focus.and.callFake(async () => order.push("focus"));
    tabTransferService.commitRemote.and.callFake(async () => {
      order.push("commit");
      return true;
    });

    const result = await provider.perform(dropContext, prepared);

    expect(workspace.open).toHaveBeenCalledOnceWith("", {
      pane: targetPane,
      activateItem: false,
      activatePane: false,
      pending: false,
    });
    expect(openedPane.moveItemToPane).toHaveBeenCalledOnceWith(remoteItem, targetPane, 1);
    expect(remoteItem.setText).toHaveBeenCalledOnceWith("unsaved text");
    expect(targetPane.activateItem).toHaveBeenCalledOnceWith(remoteItem);
    expect(order).toEqual(["activate", "commit", "focus"]);
    expect(tabTransferService.commitRemote).toHaveBeenCalledOnceWith(8, "transfer-token");
    expect(result).toEqual({ pane: targetPane, item: remoteItem });
  });

  it("removes a newly opened remote item when its source rejects the move", async () => {
    const remoteItem = { setText: jasmine.createSpy("setText") };
    const openedPane = createPane(30, [remoteItem]);
    workspace.getPaneItems = () => [...sourcePane.items, ...targetPane.items];
    workspace.open.and.resolveTo(remoteItem);
    workspace.paneForItem.and.callFake((candidate) => {
      if (openedPane.items.includes(candidate)) return openedPane;
      if (targetPane.items.includes(candidate)) return targetPane;
      return null;
    });
    tabTransferService.commitRemote.and.resolveTo(false);
    const payload = descriptor({
      source: { windowId: 8, paneId: 11, onlyItem: false },
      items: [{ type: "pane-item", uri: "remote.txt", modifiedText: "remote text" }],
    });
    const prepared = provider.prepareDrop({ descriptor: payload, pane: targetPane });

    await expectAsync(provider.perform(context(targetPane, 1), prepared)).toBeRejectedWithError(
      "The source window rejected the tab transfer",
    );

    expect(targetPane.destroyItem).toHaveBeenCalledOnceWith(remoteItem, true);
    expect(targetPane.items).not.toContain(remoteItem);
    expect(windowService.focus).not.toHaveBeenCalled();
  });

  it("does not commit a remote transfer when opening fails", async () => {
    workspace.open.and.resolveTo(null);
    const payload = descriptor({ source: { windowId: 8, paneId: 11, onlyItem: false } });
    const prepared = provider.prepareDrop({ descriptor: payload, pane: targetPane });

    await expectAsync(provider.perform(context(), prepared)).toBeRejectedWithError(
      "The target window could not open the dragged pane item",
    );

    expect(tabTransferService.commitRemote).not.toHaveBeenCalled();
    expect(windowService.focus).not.toHaveBeenCalled();
  });
});
