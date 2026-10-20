const path = require("path");

describe("tab command targets", () => {
  let main, pane, first, active, otherPane, other, coreMenus;

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
    coreMenus = lumine.contextMenu.loadPlatformItems();
  });

  const barFor = (targetPane) => main.tabBarViews.get(targetPane);

  afterEach(async () => {
    coreMenus.dispose();
    await lumine.workspace.discardEditorWindows();
  });

  it("detaches the clicked inactive tab without reopening its document", async () => {
    jasmine.useRealClock();
    first.setText("untitled edits");
    const element = first.getElement();
    const buffer = first.getBuffer();
    lumine.commands.dispatch(barFor(pane).tabForItem(first).itemTitle, "tabs:detach-tab");
    await conditionPromise(
      () => lumine.workspace.paneForItem(first)?.getContainer() !== pane.getContainer(),
    );
    const destination = lumine.workspace.paneForItem(first).getContainer().getWindow();
    expect(destination.isMain()).toBeFalse();
    expect(first.getElement()).toBe(element);
    expect(first.getBuffer()).toBe(buffer);
    expect(first.getText()).toBe("untitled edits");
    expect(first.isDestroyed()).toBeFalse();
    expect(pane.getActiveItem()).toBe(active);
    expect(element.ownerDocument).toBe(destination.getDocument());
    expect(main.tabBarViews.get(lumine.workspace.paneForItem(first))).toBeDefined();
  });

  it("places detach operations on tabs and empty panes, with Detach Pane above Close Pane", () => {
    const commands = (target) =>
      lumine.contextMenu.templateForElement(target).map((item) => item.command);
    const tab = barFor(pane).tabForItem(first).element;
    const tabMenu = commands(tab);
    expect(tabMenu).toContain("tabs:detach-tab");
    expect(tabMenu).toContain("pane:detach");
    expect(tabMenu).toContain("pane:close");
    expect(tabMenu.indexOf("pane:detach")).toBeLessThan(tabMenu.indexOf("pane:close"));
    expect(tabMenu.filter(Boolean).at(-1)).toBe("pane:close");
    const backgroundMenu = commands(barFor(pane).element);
    expect(backgroundMenu).toContain("pane:detach");
    expect(backgroundMenu).toContain("pane:close");
    expect(backgroundMenu.indexOf("pane:detach")).toBeLessThan(
      backgroundMenu.indexOf("pane:close"),
    );
    expect(backgroundMenu.filter(Boolean).at(-1)).toBe("pane:close");
    const editorMenu = commands(first.getElement());
    expect(editorMenu).not.toContain("tabs:detach-tab");
    expect(editorMenu).not.toContain("pane:detach");
    const emptyPane = pane.splitDown({ activate: false });
    const paneMenu = commands(emptyPane.getElement().querySelector(".item-views"));
    expect(paneMenu.indexOf("pane:detach") + 1).toBe(paneMenu.indexOf("pane:close"));
  });

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

  describe("tab reordering", () => {
    const expectOrder = (targetPane, items) => {
      const bar = barFor(targetPane);
      expect(targetPane.getItems()).toEqual(items);
      expect(Array.from(bar.element.children)).toEqual(
        items.map((item) => bar.tabForItem(item).element),
      );
    };

    it("moves the active editor one place and keeps its tab selected", () => {
      const last = lumine.workspace.buildTextEditor();
      pane.addItem(last);
      const invalidate = spyOn(lumine.commands, "invalidateAvailability").and.callThrough();
      lumine.commands.dispatch(active.getElement(), "tabs:move-tab-left");
      expectOrder(pane, [active, first, last]);
      expect(invalidate).toHaveBeenCalled();
      invalidate.calls.reset();
      lumine.commands.dispatch(active.getElement(), "tabs:move-tab-right");
      expectOrder(pane, [first, active, last]);
      expect(invalidate).toHaveBeenCalled();
      expect(pane.getActiveItem()).toBe(active);
      expect(barFor(pane).getActiveTab().element.classList.contains("active")).toBeTrue();
      expect(otherPane.getItems()).toEqual([other]);
    });

    it("reorders a clicked inactive tab without selecting it", () => {
      const target = barFor(pane).tabForItem(first).itemTitle;
      lumine.commands.dispatch(target, "tabs:move-tab-right");
      expectOrder(pane, [active, first]);
      expect(pane.getActiveItem()).toBe(active);
      lumine.commands.dispatch(target, "tabs:move-tab-left");
      expectOrder(pane, [first, active]);
      expect(pane.getActiveItem()).toBe(active);
      expect(lumine.workspace.getActivePane()).toBe(pane);
    });

    it("uses the target pane even when a different pane is active", () => {
      const neighbor = lumine.workspace.buildTextEditor();
      otherPane.addItem(neighbor);
      otherPane.activateItem(other);
      pane.activate();
      lumine.commands.dispatch(other.getElement(), "tabs:move-tab-right");
      expectOrder(otherPane, [neighbor, other]);
      lumine.commands.dispatch(otherPane.getElement(), "tabs:move-tab-left");
      expectOrder(otherPane, [other, neighbor]);
      expect(otherPane.getActiveItem()).toBe(other);
      expectOrder(pane, [first, active]);
      expect(lumine.workspace.getActivePane()).toBe(pane);
    });

    it("disables moves at either edge without wrapping or changing empty panes", () => {
      const left = barFor(pane).tabForItem(first).itemTitle;
      const right = barFor(pane).tabForItem(active).itemTitle;
      expect(lumine.commands.canDispatch(left, "tabs:move-tab-left")).toBeFalse();
      expect(lumine.commands.canDispatch(left, "tabs:move-tab-right")).toBeTrue();
      expect(lumine.commands.canDispatch(right, "tabs:move-tab-left")).toBeTrue();
      expect(lumine.commands.canDispatch(right, "tabs:move-tab-right")).toBeFalse();
      lumine.commands.dispatch(left, "tabs:move-tab-left");
      lumine.commands.dispatch(right, "tabs:move-tab-right");
      expectOrder(pane, [first, active]);

      const empty = pane.splitDown({ activate: false });
      for (const targetPane of [empty, otherPane]) {
        const items = targetPane.getItems().slice();
        for (const direction of ["left", "right"]) {
          const command = `tabs:move-tab-${direction}`;
          expect(lumine.commands.canDispatch(targetPane.getElement(), command)).toBeFalse();
          lumine.commands.dispatch(targetPane.getElement(), command);
        }
        expectOrder(targetPane, items);
      }
    });

    it("handles Ctrl+Alt+PageUp and PageDown from editor and tab targets", () => {
      active.getElement().focus();
      const press = (key, target) =>
        lumine.keymaps.handleKeyboardEvent(
          lumine.keymaps.constructor.buildKeydownEvent(key, {
            ctrl: true,
            alt: true,
            target,
          }),
        );
      press("pageup", document.activeElement);
      expectOrder(pane, [active, first]);
      press("pagedown", document.activeElement);
      expectOrder(pane, [first, active]);
      press("pagedown", barFor(pane).tabForItem(first).itemTitle);
      expectOrder(pane, [active, first]);
      expect(pane.getActiveItem()).toBe(active);
      expect(document.activeElement.closest("lumine-text-editor")).toBe(active.getElement());
    });
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

  it("offers split commands from an editor as well as a tab", async () => {
    await lumine.commands.dispatch(pane.getElement(), "tabs:split-down");
    const copy = lumine.workspace
      .getCenter()
      .getPanes()
      .find((candidate) =>
        candidate.getItems().some((item) => item !== first && item !== active && item !== other),
      );
    expect(copy).toBeDefined();
  });

  it("copies the exact inactive tab while preserving the source pane's selected item", async () => {
    const result = await barFor(pane).splitTab("splitLeft", barFor(pane).tabForItem(first));
    expect(result.item).not.toBe(first);
    expect(result.item.getBuffer()).toBe(first.getBuffer());
    expect(result.pane.getActiveItem()).toBe(result.item);
    expect(pane.getActiveItem()).toBe(active);
    expect(first.isDestroyed()).toBe(false);
  });

  it("declines a singleton copy without creating an empty split", async () => {
    const item = {
      element: document.createElement("div"),
      getTitle: () => "Singleton fixture",
      canCopy: () => false,
    };
    pane.addItem(item);
    const before = lumine.workspace.getCenter().getPanes().slice();
    const warning = spyOn(lumine.notifications, "addWarning");
    await lumine.commands.dispatch(barFor(pane).tabForItem(item).itemTitle, "tabs:split-right");
    expect(lumine.workspace.getCenter().getPanes()).toEqual(before);
    expect(warning).not.toHaveBeenCalled();
    expect(pane.getItems()).toContain(item);
  });

  it("checks the clicked tab's capabilities without copying or serializing it", () => {
    const target = barFor(pane).tabForItem(first).itemTitle;
    const copy = spyOn(first, "copy").and.callThrough();
    const text = spyOn(first, "getText").and.callThrough();
    first.canCopy = () => false;
    expect(lumine.commands.canDispatch(target, "tabs:split-right")).toBeFalse();
    expect(lumine.commands.canDispatch(active.element, "tabs:split-right")).toBeTrue();
    expect(lumine.commands.canDispatch(target, "tabs:open-in-new-window")).toBeTrue();
    expect(lumine.commands.canDispatch(target, "tabs:detach-tab")).toBeTrue();
    expect(copy).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
  });

  it("disables tab actions in an empty pane", () => {
    const empty = pane.splitDown({ activate: false });
    for (const name of [
      "close-tab",
      "close-all-tabs",
      "split-right",
      "detach-tab",
      "open-in-new-window",
    ])
      expect(lumine.commands.canDispatch(empty.element, `tabs:${name}`)).toBeFalse();
  });

  it("cancels a delayed copy when the clicked source closes and destroys the late result", async () => {
    let finish;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    spyOn(first, "copy").and.returnValue(pending);
    const before = lumine.workspace.getCenter().getPanes().slice();
    const command = lumine.commands.dispatch(
      barFor(pane).tabForItem(first).itemTitle,
      "tabs:split-right",
    );
    await pane.destroyItem(first, true);
    await command;
    const late = lumine.workspace.buildTextEditor();
    finish(late);
    await flushMicrotasks();
    expect(late.isDestroyed()).toBe(true);
    expect(lumine.workspace.getCenter().getPanes()).toEqual(before);
  });
});
