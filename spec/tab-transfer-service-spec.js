const TabTransferService = require("../lib/tab-transfer-service");

describe("TabTransferService", () => {
  let item, pane, service, sessions, workspace, workspaceDrops;

  beforeEach(() => {
    item = { name: "dragged" };
    const items = [{ name: "before" }, item, { name: "after" }];
    pane = {
      destroyItem: jasmine.createSpy("destroyItem").and.callFake((itemToDestroy) => {
        const index = items.indexOf(itemToDestroy);
        if (index !== -1) items.splice(index, 1);
      }),
      getItems: () => items,
    };
    workspace = { paneForItem: (candidate) => (items.includes(candidate) ? pane : null) };
    sessions = new Map();
    workspaceDrops = {
      createSession: jasmine.createSpy("createSession").and.callFake((value, callbacks) => {
        const token = `token-${sessions.size + 1}`;
        sessions.set(token, { value, callbacks });
        return { token };
      }),
      getSession: jasmine
        .createSpy("getSession")
        .and.callFake((token) => sessions.get(token)?.value ?? null),
      commit: jasmine.createSpy("commit").and.callFake(async (token, result) => {
        const session = sessions.get(token);
        if (!session) return false;
        sessions.delete(token);
        await session.callbacks.commit(result, session.value);
        return true;
      }),
      rollback: jasmine.createSpy("rollback").and.callFake(async (token, reason) => {
        const session = sessions.get(token);
        if (!session) return false;
        sessions.delete(token);
        await session.callbacks.rollback({ reason }, session.value);
        return true;
      }),
    };
    service = new TabTransferService({ workspace, workspaceDrops });
  });

  afterEach(() => service.dispose());

  it("registers and resolves the exact pane item through the core session", () => {
    const token = service.createSession(pane, item);

    expect(workspaceDrops.createSession).toHaveBeenCalled();
    expect(service.getSession(token)).toEqual({ pane, item });
  });

  it("commits a remote transfer back to its source window", async () => {
    const token = service.createSession(pane, item);

    expect(await service.commitRemote(9, token, { targetWindowId: 11 })).toBe(true);
    expect(workspaceDrops.commit).toHaveBeenCalledWith(token, {
      sourceWindowId: 9,
      targetWindowId: 11,
    });
    expect(pane.destroyItem).toHaveBeenCalledOnceWith(item, true);
  });

  it("destroys the exact item even when its pane order changed before commit", async () => {
    const token = service.createSession(pane, item);
    pane.getItems().unshift(pane.getItems().pop());

    await workspaceDrops.commit(token, {});

    expect(pane.destroyItem).toHaveBeenCalledOnceWith(item, true);
    expect(pane.getItems().map(({ name }) => name)).toEqual(["after", "before"]);
  });

  it("rolls back every outstanding token on package deactivation", () => {
    const first = service.createSession(pane, item);
    const second = service.createSession(pane, { name: "other" });

    service.dispose();

    expect(workspaceDrops.rollback).toHaveBeenCalledWith(first, "tabs package deactivated");
    expect(workspaceDrops.rollback).toHaveBeenCalledWith(second, "tabs package deactivated");
  });
});
