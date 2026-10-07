const TabDropProvider = require("../lib/tab-drop-provider");

describe("TabDropProvider", () => {
  let provider, transferScope;
  const pane = { id: 10 };
  const descriptor = {
    kind: "pane-item",
    token: "transfer-token",
    effect: "move",
    allowedLocations: ["center"],
    source: { windowId: 7, paneId: 10, onlyItem: true },
    items: [{ type: "pane-item", uri: "sample.txt" }],
  };

  beforeEach(() => {
    transferScope = jasmine.createSpyObj("transferScope", ["prepareDrop", "performDrop"]);
    provider = new TabDropProvider(transferScope, { windowService: { getId: () => 7 } });
  });

  it("claims pane items with their allowed locations and leaves other drops to core", () => {
    expect(provider.propose({ offer: descriptor, pane })).toEqual({
      effect: "move",
      allowedLocations: ["center"],
      allowSplit: false,
    });
    expect(provider.propose({ offer: { kind: "tree-entries" }, pane })).toBeNull();
    expect(provider.propose({ offer: null, pane })).toBeNull();
  });

  it("suppresses splitting only for the last item of this window's target pane", () => {
    for (const source of [
      { windowId: 7, paneId: 11, onlyItem: true },
      { windowId: 8, paneId: 10, onlyItem: true },
      { windowId: 7, paneId: 10, onlyItem: false },
    ]) {
      expect(provider.propose({ offer: { ...descriptor, source }, pane }).allowSplit).toBe(true);
    }
  });

  it("uses core's validated transfer and split decision", () => {
    const prepared = { descriptor, allowSplit: true, sameWindow: false };
    transferScope.prepareDrop.and.returnValue(prepared);

    expect(provider.prepareDrop({ descriptor, pane })).toBe(prepared);
    expect(transferScope.prepareDrop).toHaveBeenCalledOnceWith(descriptor, pane);

    transferScope.prepareDrop.and.returnValue(null);
    expect(provider.prepareDrop({ descriptor, pane })).toBeNull();
  });

  it("passes the target and insertion context to core and propagates its result", async () => {
    const context = { pane, index: 2, surface: "tab-bar", resolvePane: () => pane };
    const prepared = { descriptor, allowSplit: false };
    const result = { pane, item: { name: "moved" } };
    transferScope.performDrop.and.resolveTo(result);

    expect(await provider.perform(context, prepared)).toBe(result);
    expect(transferScope.performDrop).toHaveBeenCalledOnceWith(context, prepared);

    transferScope.performDrop.and.rejectWith(new Error("transfer cancelled"));
    await expectAsync(provider.perform(context, prepared)).toBeRejectedWithError(
      "transfer cancelled",
    );
  });
});
