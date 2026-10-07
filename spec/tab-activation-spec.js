const path = require("path");

const packageRoot = path.join(__dirname, "..");

describe("tab activation across panes", () => {
  let center, main, leftPane, rightPane, leftEditor, previousEditor, chosenEditor, bar;
  let changes, subscription;

  const changedItemIds = () => changes.map((item) => item?.id);

  function mouse(target, type, options = {}) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...options });
    target.dispatchEvent(event);
    return event;
  }

  async function press(target, options = {}, focusBar = false) {
    const event = mouse(target, "mousedown", options);
    if (focusBar) bar.element.focus();
    await waitForFrames(() => true);
    return event;
  }

  function release(target, options = {}) {
    mouse(target, "mouseup", options);
    mouse(target, options.button === 1 ? "auxclick" : "click", options);
  }

  function prepareLocalDrop(sourcePane, item, targetPane, allowedLocations = ["center"]) {
    const TabDropProvider = require("../lib/tab-drop-provider");
    const provider = new TabDropProvider(main.tabTransferService, {
      getTabBarForPane: (pane) => main.tabBarViews.find((view) => view.pane === pane),
    });
    const token = main.tabTransferService.createSession(sourcePane, item);
    const descriptor = {
      kind: "pane-item",
      token,
      effect: "move",
      allowedLocations,
      source: {
        windowId: lumine.window.getId(),
        paneId: sourcePane.id,
        onlyItem: sourcePane.getItems().length === 1,
      },
      items: [{ type: "pane-item", uri: item.getURI() }],
    };
    return {
      provider,
      token,
      prepared: provider.prepareDrop({ descriptor, pane: targetPane }),
    };
  }

  beforeEach(async () => {
    const workspaceElement = lumine.workspace.getElement();
    workspaceElement.style.width = "800px";
    workspaceElement.style.height = "400px";
    jasmine.attachToDOM(workspaceElement);
    main = (await lumine.packages.activatePackage(packageRoot)).mainModule;
    leftEditor = await lumine.workspace.open();
    leftPane = lumine.workspace.paneForItem(leftEditor);
    previousEditor = lumine.workspace.buildTextEditor();
    chosenEditor = lumine.workspace.buildTextEditor();
    rightPane = leftPane.splitRight({ items: [previousEditor, chosenEditor] });
    rightPane.activateItem(previousEditor);
    leftPane.activate();
    center = lumine.workspace.getCenter();
    bar = main.tabBarViews.find((view) => view.pane === rightPane);
    changes = [];
    subscription = center.onDidChangeActivePaneItem((item) => changes.push(item));
  });

  afterEach(() => subscription?.dispose());

  for (const focusBar of [false, true]) {
    it(`publishes only the chosen tab in an inactive pane${focusBar ? " after native bar focus" : ""}`, async () => {
      const target = bar.tabForItem(chosenEditor).itemTitle;
      const down = await press(target, { button: 0 }, focusBar);

      expect(rightPane.getActiveItem() === chosenEditor).toBe(true);
      expect(center.getActivePaneItem() === chosenEditor).toBe(true);
      expect(changedItemIds()).toEqual([chosenEditor.id]);
      expect(down.defaultPrevented).toBe(false);

      release(target, { button: 0 });
      await waitForFrames(() => true);
      expect(changedItemIds()).toEqual([chosenEditor.id]);
      expect(lumine.views.getView(chosenEditor).contains(document.activeElement)).toBe(true);
    });
  }

  it("focuses an inactive pane's already selected tab once", async () => {
    const target = bar.tabForItem(previousEditor).itemTitle;
    await press(target, { button: 0 }, true);
    expect(changedItemIds()).toEqual([previousEditor.id]);

    release(target, { button: 0 });
    await waitForFrames(() => true);
    expect(changedItemIds()).toEqual([previousEditor.id]);
    expect(lumine.views.getView(previousEditor).contains(document.activeElement)).toBe(true);
  });

  it("selects another tab in the active pane before mouse release", async () => {
    rightPane.activate();
    changes.length = 0;
    const target = bar.tabForItem(chosenEditor).itemTitle;
    await press(target, { button: 0 }, true);
    expect(rightPane.getActiveItem() === chosenEditor).toBe(true);
    expect(changedItemIds()).toEqual([chosenEditor.id]);

    release(target, { button: 0 });
    await waitForFrames(() => true);
    expect(changedItemIds()).toEqual([chosenEditor.id]);
    expect(lumine.views.getView(chosenEditor).contains(document.activeElement)).toBe(true);
  });

  it("keeps the active pane's selected tab and restores its editor focus", async () => {
    rightPane.activate();
    changes.length = 0;
    const target = bar.tabForItem(previousEditor).itemTitle;
    await press(target, { button: 0 }, true);
    release(target, { button: 0 });
    await waitForFrames(() => true);

    expect(changes).toEqual([]);
    expect(rightPane.getActiveItem()).toBe(previousEditor);
    expect(lumine.views.getView(previousEditor).contains(document.activeElement)).toBe(true);
  });

  it("publishes only the moved tab when its source pane selects a fallback", async () => {
    rightPane.activateItem(chosenEditor);
    rightPane.activate();
    const { provider, token, prepared } = prepareLocalDrop(rightPane, chosenEditor, leftPane);
    changes.length = 0;

    const result = await provider.perform(
      {
        pane: leftPane,
        index: 0,
        surface: "tab-bar",
        resolvePane: () => leftPane,
      },
      prepared,
    );

    expect(result.item).toBe(chosenEditor);
    expect(result.pane).toBe(leftPane);
    expect(rightPane.getActiveItem()).toBe(previousEditor);
    expect(leftPane.getActiveItem()).toBe(chosenEditor);
    expect(center.getActivePane()).toBe(leftPane);
    expect(changedItemIds()).toEqual([chosenEditor.id]);
    expect(main.tabTransferService.getSession(token)).toBeNull();
    expect(lumine.views.getView(chosenEditor).contains(document.activeElement)).toBe(true);
  });

  it("publishes only the moved tab when resolving the drop creates a split", async () => {
    rightPane.activateItem(chosenEditor);
    rightPane.activate();
    const { provider, prepared } = prepareLocalDrop(rightPane, chosenEditor, leftPane);
    let destinationPane;
    changes.length = 0;

    await provider.perform(
      {
        pane: leftPane,
        index: 0,
        surface: "pane",
        candidateSplit: "down",
        resolvePane: () => (destinationPane = leftPane.splitDown()),
      },
      prepared,
    );

    expect(rightPane.getActiveItem()).toBe(previousEditor);
    expect(leftPane.getActiveItem()).toBe(leftEditor);
    expect(destinationPane.getActiveItem()).toBe(chosenEditor);
    expect(center.getActivePane()).toBe(destinationPane);
    expect(changedItemIds()).toEqual([chosenEditor.id]);
    expect(lumine.views.getView(chosenEditor).contains(document.activeElement)).toBe(true);
  });

  it("publishes the dock destination before the center reports its source fallback", async () => {
    const dock = lumine.workspace.getRightDock();
    const destinationPane = dock.getActivePane();
    const dockEditor = lumine.workspace.buildTextEditor();
    destinationPane.addItem(dockEditor);
    destinationPane.activateItem(dockEditor);
    dock.show();
    rightPane.activateItem(chosenEditor, { activatePane: true });
    const { provider, prepared } = prepareLocalDrop(rightPane, chosenEditor, destinationPane, [
      "center",
      "right",
    ]);
    const observations = [];
    const record = (origin, item) => {
      observations.push({
        origin,
        item: item?.id,
        workspaceItem: lumine.workspace.getActivePaneItem()?.id,
      });
    };
    const workspaceSubscription = lumine.workspace.onDidChangeActivePaneItem((item) =>
      record("workspace", item),
    );
    const centerSubscription = center.onDidChangeActivePaneItem((item) => record("center", item));
    changes.length = 0;

    try {
      await provider.perform(
        {
          pane: destinationPane,
          index: 0,
          surface: "tab-bar",
          resolvePane: () => destinationPane,
        },
        prepared,
      );

      expect(lumine.workspace.getActivePane()).toBe(destinationPane);
      expect(destinationPane.getActiveItem()).toBe(chosenEditor);
      expect(rightPane.getActiveItem()).toBe(previousEditor);
      expect(changedItemIds()).toEqual([previousEditor.id]);
      expect(observations).toEqual([
        { origin: "workspace", item: chosenEditor.id, workspaceItem: chosenEditor.id },
        { origin: "center", item: previousEditor.id, workspaceItem: chosenEditor.id },
      ]);
    } finally {
      workspaceSubscription.dispose();
      centerSubscription.dispose();
    }
  });

  it("keeps the destination dock active when moving an item destroys its source dock pane", async () => {
    const sourceDock = lumine.workspace.getLeftDock();
    const sourcePane = sourceDock.getActivePane();
    const draggedEditor = lumine.workspace.buildTextEditor();
    const siblingEditor = lumine.workspace.buildTextEditor();
    sourcePane.addItem(draggedEditor);
    const siblingPane = sourcePane.splitDown({ items: [siblingEditor] });
    const destinationDock = lumine.workspace.getRightDock();
    const destinationPane = destinationDock.getActivePane();
    const oldDestinationEditor = lumine.workspace.buildTextEditor();
    destinationPane.addItem(oldDestinationEditor);
    destinationPane.activateItem(oldDestinationEditor);
    destinationDock.show();
    sourceDock.show();
    sourcePane.activateItem(draggedEditor, { activatePane: true });
    const { provider, prepared } = prepareLocalDrop(sourcePane, draggedEditor, destinationPane, [
      "left",
      "right",
    ]);
    const workspaceChanges = [];
    const workspaceSubscription = lumine.workspace.onDidChangeActivePaneItem((item) =>
      workspaceChanges.push(item?.id),
    );
    const previousDestroyEmptyPanes = lumine.config.get("core.destroyEmptyPanes");
    lumine.config.set("core.destroyEmptyPanes", true);

    try {
      await provider.perform(
        {
          pane: destinationPane,
          index: 0,
          surface: "tab-bar",
          resolvePane: () => destinationPane,
        },
        prepared,
      );

      expect(sourcePane.isDestroyed()).toBe(true);
      expect(sourceDock.getActivePane()).toBe(siblingPane);
      expect(siblingPane.getActiveItem()).toBe(siblingEditor);
      expect(destinationPane.getActiveItem()).toBe(draggedEditor);
      expect(lumine.workspace.getActivePane()).toBe(destinationPane);
      expect(lumine.workspace.getActivePaneItem()).toBe(draggedEditor);
      expect(workspaceChanges).toEqual([draggedEditor.id]);
    } finally {
      workspaceSubscription.dispose();
      lumine.config.set("core.destroyEmptyPanes", previousDestroyEmptyPanes);
    }
  });

  for (const gesture of ["close", "middle", "context", "ctrl-context"]) {
    it(`keeps the existing selection during a ${gesture} gesture on another tab`, async () => {
      const tab = bar.tabForItem(chosenEditor);
      const target = gesture === "close" ? tab.element.querySelector(".close-icon") : tab.itemTitle;
      const options = {
        button: gesture === "middle" ? 1 : gesture === "context" ? 2 : 0,
        ctrlKey: gesture === "ctrl-context",
      };
      await press(target, options, true);
      expect(rightPane.getActiveItem()).toBe(previousEditor);
      expect(changedItemIds()).toEqual([previousEditor.id]);

      release(target, options);
      if (gesture === "close" || gesture === "middle") {
        await waitForFrames(() => !rightPane.getItems().includes(chosenEditor));
        expect(chosenEditor.isDestroyed()).toBe(true);
      } else {
        expect(bar.rightClickedTab.item).toBe(chosenEditor);
        expect(rightPane.getItems()).toContain(chosenEditor);
      }
      expect(rightPane.getActiveItem()).toBe(previousEditor);
      expect(changedItemIds()).toEqual([previousEditor.id]);
    });
  }
});
