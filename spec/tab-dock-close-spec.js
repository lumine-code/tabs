const path = require("path");
const { buildDragEvent, buildDragEvents } = require("./event-helpers.js");

describe("the compact dock tab close button", () => {
  let main, resources, releaseClose;

  const docks = () => ({
    left: lumine.workspace.getLeftDock(),
    right: lumine.workspace.getRightDock(),
    bottom: lumine.workspace.getBottomDock(),
  });

  const buttonFor = (pane) => pane.getElement().querySelector(":scope > .dock-tab-close");
  const isVisible = (button) => Boolean(button?.getBoundingClientRect().height);

  function addItem(pane, title, { permanent = false } = {}) {
    const item = {
      element: document.createElement("div"),
      canCopy: () => false,
      getAllowedLocations: () => ["center", "left", "right", "bottom"],
      getTitle: () => title,
      getIconName: () => "tools",
      isPermanentDockItem: () => permanent,
    };
    pane.addItem(item, { index: pane.getItems().length });
    return item;
  }

  beforeEach(async () => {
    jasmine.useRealClock();
    resources = [];
    releaseClose = null;
    main = (await lumine.packages.activatePackage(path.join(__dirname, ".."))).mainModule;
    const workspace = lumine.workspace.getElement();
    Object.assign(workspace.style, { width: "900px", height: "500px" });
    workspace.style.setProperty("--ui-tab-height", "32px");
    jasmine.attachToDOM(workspace);
    lumine.workspace.getLeftDock().show();
  });

  afterEach(() => {
    releaseClose?.();
    lumine.workspaceDrops.clearActiveClaim();
    for (const resource of resources.reverse()) resource.dispose();
  });

  it("shows one accessible close button only in compact dock tab bars", () => {
    const centerPane = lumine.workspace.getCenter().getActivePane();
    addItem(centerPane, "Document");
    const dockPanes = Object.values(docks()).map((dock) => {
      const pane = dock.getActivePane();
      addItem(pane, "Dock view");
      dock.show();
      expect(isVisible(buttonFor(pane))).toBeFalse();
      return pane;
    });

    lumine.config.set("tabs.dockTabsMode", "icons");

    for (const pane of dockPanes) {
      const button = buttonFor(pane);
      expect(pane.getElement().querySelectorAll(".dock-tab-close").length).toBe(1);
      expect(button.tagName).toBe("BUTTON");
      expect(button.getAttribute("aria-label")).toBe("Close Active Tab");
      expect(button.title).toBe("Close Active Tab");
      expect(button.hidden).toBeFalse();
      expect(isVisible(button)).toBeTrue();
      expect(button.disabled).toBeFalse();
    }
    expect(isVisible(buttonFor(centerPane))).toBeFalse();

    lumine.config.set("tabs.dockTabsMode", "titles");
    for (const pane of dockPanes) expect(isVisible(buttonFor(pane))).toBeFalse();
  });

  it("reveals the close action for keyboard focus while preserving the hover-only idle state", async () => {
    lumine.config.set("tabs.dockTabsMode", "icons");
    const pane = lumine.workspace.getLeftDock().getActivePane();
    addItem(pane, "Dock view");
    const bar = main.tabBarViews.get(pane);
    const button = buttonFor(pane);
    const closeIcon = button.querySelector(":scope > .close-icon");
    bar.element.style.pointerEvents = "none";
    button.style.pointerEvents = "none";
    expect(button.matches(":hover")).toBeFalse();
    expect(bar.element.matches(":hover")).toBeFalse();
    expect(getComputedStyle(closeIcon).opacity).toBe("0");

    button.focus();
    await waitForFrames(() => getComputedStyle(closeIcon).opacity === "1");

    expect(document.activeElement).toBe(button);
    expect(getComputedStyle(closeIcon).opacity).toBe("1");
  });

  it("closes its own active dock item while another pane has focus", async () => {
    lumine.config.set("tabs.dockTabsMode", "icons");
    const pane = lumine.workspace.getLeftDock().getActivePane();
    const first = addItem(pane, "First view");
    const active = addItem(pane, "Active view");
    pane.activateItem(active);
    const centerPane = lumine.workspace.getCenter().getActivePane();
    const documentItem = addItem(centerPane, "Document");
    centerPane.activate();
    const button = buttonFor(pane);

    button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
    button.click();
    await flushMicrotasks();

    expect(pane.getItems()).toEqual([first]);
    expect(centerPane.getItems()).toEqual([documentItem]);
    expect(main.tabBarViews.get(pane).tabForItem(active)).toBeUndefined();
    expect(button.disabled).toBeFalse();
  });

  it("updates enabled state for permanent, removed and newly active items", () => {
    lumine.config.set("tabs.dockTabsMode", "icons");
    const pane = lumine.workspace.getLeftDock().getActivePane();
    const button = buttonFor(pane);
    expect(button.disabled).toBeTrue();
    const permanent = addItem(pane, "Permanent view", { permanent: true });
    pane.activateItem(permanent);
    expect(button.disabled).toBeTrue();
    const closable = addItem(pane, "Closable view");
    pane.activateItem(closable);
    expect(button.disabled).toBeFalse();

    pane.removeItem(closable);
    expect(button.disabled).toBeTrue();
    pane.removeItem(permanent);
    expect(button.disabled).toBeTrue();
    const replacement = addItem(pane, "Replacement view");
    pane.activateItem(replacement);
    expect(button.disabled).toBeFalse();
  });

  it("keeps the active item and re-enables closing when a close is refused", async () => {
    lumine.config.set("tabs.dockTabsMode", "icons");
    const pane = lumine.workspace.getLeftDock().getActivePane();
    const item = addItem(pane, "Refused close");
    const requested = [];
    resources.push(
      lumine.workspace.onWillDestroyPaneItem(({ item: closing, prevent }) => {
        requested.push(closing);
        if (closing === item) prevent();
      }),
    );
    const button = buttonFor(pane);

    button.click();
    await flushMicrotasks();

    expect(requested).toEqual([item]);
    expect(pane.getItems()).toEqual([item]);
    expect(pane.getActiveItem()).toBe(item);
    expect(button.disabled).toBeFalse();
  });

  it("allows only one close while an asynchronous close decision is pending", async () => {
    lumine.config.set("tabs.dockTabsMode", "icons");
    const pane = lumine.workspace.getLeftDock().getActivePane();
    const first = addItem(pane, "First view");
    const second = addItem(pane, "Second view");
    pane.activateItem(first);
    const pending = new Promise((resolve) => (releaseClose = resolve));
    const requested = [];
    resources.push(
      pane.onWillDestroyItem(({ item }) => {
        requested.push(item);
        if (item === first) return pending;
      }),
    );
    const button = buttonFor(pane);
    button.click();
    await flushMicrotasks();
    expect(button.disabled).toBeTrue();
    pane.activateItem(second);
    button.click();
    button.click();
    expect(requested).toEqual([first]);

    releaseClose();
    await flushMicrotasks();

    expect(pane.getItems()).toEqual([second]);
    expect(requested).toEqual([first]);
    expect(button.disabled).toBeFalse();
  });

  it("ignores middle-clicks and excludes the button from tab dragging and drop targets", async () => {
    lumine.config.set("tabs.dockTabsMode", "icons");
    const pane = lumine.workspace.getLeftDock().getActivePane();
    const first = addItem(pane, "First view");
    const second = addItem(pane, "Second view");
    const bar = main.tabBarViews.get(pane);
    const button = buttonFor(pane);
    expect(button.draggable).toBeFalse();
    expect(button.closest(".tab")).toBeNull();
    const close = spyOn(bar, "closeTab").and.callThrough();
    button.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    await flushMicrotasks();
    expect(close).not.toHaveBeenCalled();
    const [buttonDrag] = buildDragEvents(button, button);
    button.dispatchEvent(buttonDrag);
    expect(lumine.workspaceDrops.inspect(buttonDrag.dataTransfer)).toBeNull();

    const source = bar.tabForItem(first).itemTitle;
    const [dragStart] = buildDragEvents(source, button);
    source.dispatchEvent(dragStart);
    const descriptor = lumine.workspaceDrops.read(dragStart.dataTransfer);
    resources.push({ dispose: () => main.transferScope.release(descriptor.token) });
    const bounds = button.getBoundingClientRect();
    const coordinates = {
      clientX: bounds.left + bounds.width / 2,
      clientY: bounds.top + bounds.height / 2,
    };
    const dragOver = buildDragEvent("dragover", button, dragStart.dataTransfer, coordinates);
    const drop = buildDragEvent("drop", button, dragStart.dataTransfer, coordinates);
    button.dispatchEvent(dragOver);
    button.dispatchEvent(drop);
    await flushMicrotasks();
    source.dispatchEvent(buildDragEvent("dragend", source, dragStart.dataTransfer));

    expect(bar.element.querySelector(".placeholder")).toBeNull();
    expect(pane.getItems()).toEqual([first, second]);
    expect(lumine.workspaceDrops.getSession(descriptor.token)?.item).toBe(first);
    expect(close).not.toHaveBeenCalled();
  });

  it("keeps the close button at the right edge when the icons overflow and scroll", async () => {
    lumine.config.set("tabs.dockTabsMode", "icons");
    const pane = lumine.workspace.getLeftDock().getActivePane();
    for (let index = 0; index < 8; index++) addItem(pane, `View ${index}`);
    const bar = main.tabBarViews.get(pane);
    Object.assign(pane.getElement().style, {
      position: "fixed",
      left: "20px",
      top: "40px",
      width: "160px",
      height: "200px",
      zIndex: "100000",
    });
    await waitForFrames(() => true);
    const button = buttonFor(pane);
    const closeIcon = button.querySelector(":scope > .close-icon");
    button.focus();
    await waitForFrames(() => getComputedStyle(closeIcon).opacity === "1");
    const initial = button.getBoundingClientRect();
    const barBounds = bar.element.getBoundingClientRect();
    const paneBounds = pane.getElement().getBoundingClientRect();
    expect(bar.element.scrollWidth).toBeGreaterThan(bar.element.clientWidth);
    expect(initial.width).toBeGreaterThan(0);
    expect(initial.right).toBeLessThanOrEqual(paneBounds.right);
    expect(paneBounds.right - initial.right).toBeLessThanOrEqual(10);
    expect(initial.left).toBeGreaterThanOrEqual(barBounds.right);

    bar.element.scrollLeft = bar.element.scrollWidth;
    await waitForFrames(() => true);

    const scrolled = button.getBoundingClientRect();
    expect(scrolled.right).toBeCloseTo(initial.right, 0);
    expect(scrolled.left).toBeCloseTo(initial.left, 0);
    const hit = document.elementFromPoint(
      scrolled.left + scrolled.width / 2,
      scrolled.top + scrolled.height / 2,
    );
    expect(button.contains(hit)).toBeTrue();
  });
});
