const fs = require("fs");
const path = require("path");
const { Emitter, Icon } = require("lumine");
const { buildDragEvent, buildDragEvents } = require("./event-helpers.js");

describe("dock tab icon presentation", () => {
  let main, resources;

  const paneFor = (location) =>
    ({
      center: lumine.workspace.getCenter(),
      left: lumine.workspace.getLeftDock(),
      right: lumine.workspace.getRightDock(),
      bottom: lumine.workspace.getBottomDock(),
    })[location].getActivePane();

  function createItem(title, options = {}) {
    const emitter = new Emitter();
    resources.push(emitter);
    return {
      element: document.createElement("div"),
      title,
      iconName: options.iconName,
      filePath: options.filePath,
      fileState: "unmodified",
      canCopy: () => false,
      getAllowedLocations: () => ["center", "left", "right", "bottom"],
      getTitle() {
        return this.title;
      },
      getLongTitle() {
        return options.parent ? `${options.parent}/${this.title}` : this.title;
      },
      getIconName() {
        return this.iconName;
      },
      getPath() {
        return this.filePath;
      },
      getFileState() {
        return this.fileState;
      },
      isPermanentDockItem: () => Boolean(options.permanent),
      onDidChangeTitle: (callback) => emitter.on("title", callback),
      onDidChangeIcon: (callback) => emitter.on("icon", callback),
      onDidChangeFileState: (callback) => emitter.on("file-state", callback),
      rename(value) {
        this.title = value;
        emitter.emit("title", value);
      },
      setIconName(value) {
        this.iconName = value;
        emitter.emit("icon", value);
      },
      setFileState(value) {
        this.fileState = value;
        emitter.emit("file-state", value);
      },
    };
  }

  function addItem(location, title, options) {
    const pane = paneFor(location);
    const item = createItem(title, options);
    pane.addItem(item);
    const bar = main.tabBarViews.get(pane);
    return { pane, item, bar, tab: bar.tabForItem(item) };
  }

  function mouse(target, type, button = 0) {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button }));
  }

  beforeEach(async () => {
    jasmine.useRealClock();
    resources = [];
    main = (await lumine.packages.activatePackage(path.join(__dirname, ".."))).mainModule;
    const workspace = lumine.workspace.getElement();
    Object.assign(workspace.style, { width: "900px", height: "500px" });
    workspace.style.setProperty("--ui-tab-height", "32px");
    workspace.style.setProperty("--ui-icon-size", "16px");
    workspace.style.setProperty("--ui-icon-spacing", "6px");
    jasmine.attachToDOM(workspace);
  });

  afterEach(() => {
    lumine.workspaceDrops.clearActiveClaim();
    for (const resource of resources.reverse()) resource.dispose();
  });

  it("keeps titles by default and changes every dock live without changing center tabs", () => {
    expect(lumine.config.get("tabs.dockTabsMode")).toBe("titles");
    const filePath = path.join(__dirname, "fixtures", "sample.js");
    const center = addItem("center", "sample.js", { filePath });
    const dockTabs = ["left", "right", "bottom"].map((location) =>
      addItem(location, `${location} view`, { iconName: "tools" }),
    );
    for (const { bar, tab, item } of [center, ...dockTabs]) {
      expect(bar.element.classList.contains("icons-only")).toBeFalse();
      expect(tab.itemTitle.querySelector(".tab-label").textContent).toBe(item.getTitle());
      expect(tab.element.getAttribute("aria-label")).toBe(item.getTitle());
    }
    expect(center.tab.element.title).toBe(filePath);

    lumine.config.set("tabs.dockTabsMode", "icons");

    for (const { bar, tab, item } of dockTabs) {
      expect(bar.element.classList.contains("icons-only")).toBeTrue();
      expect(tab.element.title).toBe(item.getTitle());
    }
    expect(center.bar.element.classList.contains("icons-only")).toBeFalse();
    expect(center.tab.element.title).toBe(filePath);

    lumine.config.set("tabs.dockTabsMode", "titles");
    for (const { bar, tab } of dockTabs) {
      expect(bar.element.classList.contains("icons-only")).toBeFalse();
      expect(tab.element.hasAttribute("title")).toBeFalse();
    }
  });

  it("applies the selected presentation to new panes and items moved across locations", () => {
    lumine.config.set("tabs.dockTabsMode", "icons");
    const source = addItem("left", "Left view", { iconName: "tools" });
    const splitItem = createItem("Split view", { iconName: "tools" });
    const splitPane = source.pane.splitDown({ items: [splitItem] });
    const splitBar = main.tabBarViews.get(splitPane);
    expect(splitBar.element.classList.contains("icons-only")).toBeTrue();
    expect(splitBar.tabForItem(splitItem).element.title).toBe("Split view");

    const moved = addItem("center", "Movable view", { iconName: "tools" });
    const rightPane = paneFor("right");
    moved.pane.moveItemToPane(moved.item, rightPane);
    const dockTab = main.tabBarViews.get(rightPane).tabForItem(moved.item);
    expect(main.tabBarViews.get(rightPane).element.classList.contains("icons-only")).toBeTrue();
    expect(dockTab.element.title).toBe("Movable view");
    expect(moved.bar.tabForItem(moved.item)).toBeUndefined();

    rightPane.moveItemToPane(moved.item, moved.pane);
    const centerTab = main.tabBarViews.get(moved.pane).tabForItem(moved.item);
    expect(main.tabBarViews.get(moved.pane).element.classList.contains("icons-only")).toBeFalse();
    expect(centerTab.element.hasAttribute("title")).toBeFalse();
    expect(centerTab.element.getAttribute("aria-label")).toBe("Movable view");
  });

  for (const [location, kind, descriptor, glyphSelector] of [
    ["left", "font icon host", null, null],
    [
      "right",
      "nested SVG path",
      () => Icon.svg('<path d="M0 0h16v16H0z"/>', { viewBox: "0 0 16 16" }),
      ".icon-glyph path",
    ],
    ["bottom", "letter glyph", () => Icon.letter("R"), ".icon-letter-glyph"],
  ]) {
    it(`reorders ${location} dock tabs by dragging their ${kind} through the registered drop target`, async () => {
      lumine.config.set("tabs.dockTabsMode", "icons");
      if (descriptor) {
        resources.push(
          lumine.packages.serviceHub.provide("icons.provider", "1.0.0", {
            iconFor: descriptor,
          }),
        );
      }
      const first = addItem(location, "First view", { iconName: "tools" });
      const second = addItem(location, "Second view", { iconName: "tools" });
      second.pane.activateItem(second.item);
      const third = addItem(location, "Third view", { iconName: "tools" });
      const { pane, bar } = first;
      expect(pane.getItems()).toEqual([first.item, second.item, third.item]);
      lumine.workspace[`get${location[0].toUpperCase()}${location.slice(1)}Dock`]().show();
      Object.assign(bar.element.style, {
        position: "fixed",
        left: "20px",
        top: "40px",
        width: "320px",
        display: "flex",
      });
      await waitForFrames(() => third.tab.element.getBoundingClientRect().width >= 32);
      for (const { tab } of [first, second, third]) {
        expect(getComputedStyle(tab.itemTitle.querySelector(".tab-label")).display).toBe("none");
      }
      const performDrop = spyOn(main.transferScope, "performDrop").and.callThrough();

      async function drag(source, target, after, expectedItems) {
        const sourceTarget = glyphSelector
          ? source.tab.itemTitle.querySelector(glyphSelector)
          : source.tab.itemTitle;
        const dropTarget = glyphSelector
          ? target.tab.itemTitle.querySelector(glyphSelector)
          : target.tab.itemTitle;
        expect(sourceTarget).not.toBeNull();
        expect(dropTarget).not.toBeNull();
        const [dragStart] = buildDragEvents(sourceTarget, dropTarget);
        sourceTarget.dispatchEvent(dragStart);
        const offer = lumine.workspaceDrops.inspect(dragStart.dataTransfer);
        const serialized = JSON.parse(dragStart.dataTransfer.getData(offer.type));
        const payload = lumine.workspaceDrops.read(dragStart.dataTransfer);
        expect(serialized).toEqual(payload);
        expect(payload.kind).toBe("pane-item");
        expect(payload.effect).toBe("move");
        expect(payload.source).toEqual({
          windowId: lumine.window.getId(),
          paneId: pane.id,
          onlyItem: false,
        });
        expect(payload.allowedLocations).toContain(location);
        const session = lumine.workspaceDrops.getSession(payload.token);
        expect(session.item).toBe(source.item);
        expect(session.pane).toBe(pane);
        expect(session.scope).toBe(main.transferScope);
        resources.push({ dispose: () => main.transferScope.release(payload.token) });

        const bounds = target.tab.element.getBoundingClientRect();
        const coordinates = {
          clientX: bounds.left + bounds.width * (after ? 0.65 : 0.35),
          clientY: bounds.top + bounds.height / 2,
        };
        const iconBounds = dropTarget.getBoundingClientRect();
        expect(coordinates.clientX).toBeGreaterThanOrEqual(iconBounds.left);
        expect(coordinates.clientX).toBeLessThanOrEqual(iconBounds.right);
        expect(coordinates.clientY).toBeGreaterThanOrEqual(iconBounds.top);
        expect(coordinates.clientY).toBeLessThanOrEqual(iconBounds.bottom);
        const dragOver = buildDragEvent(
          "dragover",
          dropTarget,
          dragStart.dataTransfer,
          coordinates,
        );
        dropTarget.dispatchEvent(dragOver);
        expect(dragOver.defaultPrevented).toBeTrue();
        expect(dragOver.dataTransfer.dropEffect).toBe("move");
        expect(bar.element.querySelector(".placeholder")).not.toBeNull();
        const drop = buildDragEvent("drop", dropTarget, dragStart.dataTransfer, coordinates);
        dropTarget.dispatchEvent(drop);
        await flushMicrotasks();
        sourceTarget.dispatchEvent(buildDragEvent("dragend", sourceTarget, dragStart.dataTransfer));
        expect(drop.defaultPrevented).toBeTrue();
        expect(lumine.workspaceDrops.getSession(payload.token)).toBeUndefined();
        expect(bar.element.querySelector(".placeholder")).toBeNull();
        expect(pane.getItems()).toEqual(expectedItems);
        expect(bar.tabs.map((tab) => tab.item)).toEqual(expectedItems);
        expect(
          Array.from(bar.element.querySelectorAll(":scope > .tab"), (tab) => tab.item),
        ).toEqual(expectedItems);
        expect(pane.getActiveItem()).toBe(source.item);
        expect(bar.tabForItem(source.item)).toBe(source.tab);
        expect(source.tab.element.classList.contains("is-dragging")).toBeFalse();
      }

      await drag(first, third, true, [second.item, third.item, first.item]);
      await drag(first, second, false, [first.item, second.item, third.item]);
      expect(performDrop).toHaveBeenCalledTimes(2);
    });
  }

  it("keeps dock icons visible when icons are disabled and follows live icon changes", () => {
    lumine.config.set("tabs.showIcons", false);
    lumine.config.set("tabs.dockTabsMode", "icons");
    const dock = addItem("bottom", "Output", { iconName: "tools" });
    const center = addItem("center", "Document", { iconName: "tools" });
    expect(dock.tab.itemTitle.classList.contains("hide-icon")).toBeFalse();
    expect(center.tab.itemTitle.classList.contains("hide-icon")).toBeTrue();

    dock.item.setIconName("flame");
    expect(dock.tab.itemTitle.classList.contains("icon-flame")).toBeTrue();
    expect(dock.tab.itemTitle.classList.contains("icon-tools")).toBeFalse();
    expect(dock.tab.itemTitle.classList.contains("hide-icon")).toBeFalse();

    lumine.config.set("tabs.dockTabsMode", "titles");
    expect(dock.tab.itemTitle.classList.contains("hide-icon")).toBeTrue();
    lumine.config.set("tabs.showIcons", true);
    expect(dock.tab.itemTitle.classList.contains("hide-icon")).toBeFalse();
  });

  for (const [kind, descriptor, glyphSelector] of [
    ["SVG", () => Icon.svg('<path d="M0 0h16v16H0z"/>', { viewBox: "0 0 16 16" }), ".icon-glyph"],
    ["letter", () => Icon.letter("R"), ".icon-letter-glyph"],
  ]) {
    it(`keeps duplicate and renamed titles identifiable without discarding a ${kind} icon`, () => {
      lumine.config.set("tabs.dockTabsMode", "icons");
      resources.push(
        lumine.packages.serviceHub.provide("icons.provider", "1.0.0", {
          iconFor: descriptor,
        }),
      );
      const filePath = path.join(__dirname, "fixtures", "sample.js");
      const first = addItem("right", "Results", { parent: "first", filePath });
      const second = addItem("right", "Results", { parent: "second" });
      const glyph = first.tab.itemTitle.querySelector(glyphSelector);
      expect(glyph).not.toBeNull();
      expect(first.tab.element.title).toBe(`first/Results\n${filePath}`);
      expect(second.tab.element.title).toBe("second/Results");
      expect(first.tab.element.getAttribute("aria-label")).toBe("first/Results");

      second.item.rename("Diagnostics");

      expect(first.tab.element.title).toBe(`Results\n${filePath}`);
      expect(first.tab.element.getAttribute("aria-label")).toBe("Results");
      expect(first.tab.itemTitle.querySelector(".tab-label").textContent).toBe("Results");
      expect(first.tab.itemTitle.querySelector(glyphSelector)).toBe(glyph);
      expect(second.tab.element.title).toBe("Diagnostics");
      expect(second.tab.element.getAttribute("aria-label")).toBe("Diagnostics");
    });
  }

  it("renders a fallback for unnamed icons and retains file-state markers on hover", () => {
    lumine.config.set("tabs.dockTabsMode", "icons");
    lumine.config.set("tabs.showIcons", false);
    const { item, tab } = addItem("bottom", "Unnamed view");
    expect(tab.itemTitle.classList.contains("icon")).toBeFalse();
    const fallback = getComputedStyle(tab.itemTitle, "::before");
    expect(["none", "normal", '""']).not.toContain(fallback.content);
    expect(fallback.display).not.toBe("none");
    expect(getComputedStyle(tab.itemTitle.querySelector(".tab-label")).display).toBe("none");
    expect(getComputedStyle(tab.element.querySelector(".close-icon")).display).toBe("none");

    for (const state of ["modified", "conflicted", "removed"]) {
      item.setFileState(state);
      tab.element.classList.add("is-hovered");
      expect(getComputedStyle(tab.statusIcon).display).not.toBe("none");
      expect(getComputedStyle(tab.statusIcon).visibility).toBe("visible");
      tab.element.classList.remove("is-hovered");
    }
  });

  it("keeps compact widths under each One theme sizing policy and restores title widths", async () => {
    const themePath = lumine.packages.resolvePackagePath("one-theme");
    for (const file of ["styles/ui/main.css", "styles/one-ui/config.css"]) {
      resources.push(
        lumine.styles.addStyleSheet(fs.readFileSync(path.join(themePath, file), "utf8"), {
          priority: 1000,
        }),
      );
    }
    const first = addItem("left", "First long tool title", { iconName: "tools" });
    const second = addItem("left", "Second long tool title", { iconName: "tools" });
    lumine.workspace.getLeftDock().show();
    Object.assign(first.bar.element.style, {
      position: "fixed",
      left: "20px",
      top: "40px",
      width: "400px",
      display: "flex",
    });
    await waitForFrames(() => first.tab.element.getBoundingClientRect().width > 60);
    first.bar.layout.lockWidths();
    lumine.config.set("tabs.dockTabsMode", "icons");
    const workspace = lumine.workspace.getElement();
    for (const sizing of ["even", "maximum", "minimum"]) {
      workspace.setAttribute("ui-tabsizing", sizing);
      first.pane.activateItem(first.item);
      await waitForFrames(() => true);
      const width = first.tab.element.getBoundingClientRect().width;
      expect(width).toBeGreaterThanOrEqual(32);
      expect(width).toBeLessThan(60);
      expect(second.tab.element.getBoundingClientRect().width).toBeCloseTo(width, 0);
      expect(getComputedStyle(first.tab.element, "::before").display).toBe("none");
      expect(getComputedStyle(first.tab.itemTitle).marginTop).toBe("0px");
      expect(getComputedStyle(first.tab.itemTitle).marginBottom).toBe("0px");
      expect(getComputedStyle(first.tab.itemTitle).borderRadius).toBe("0px");
      expect(first.tab.itemTitle.getBoundingClientRect().height).toBeCloseTo(
        first.tab.element.getBoundingClientRect().height,
        0,
      );
      first.pane.activateItem(second.item);
      expect(second.tab.element.getBoundingClientRect().width).toBeCloseTo(width, 0);
    }
    lumine.config.set("tabs.dockTabsMode", "titles");
    await waitForFrames(() => first.tab.element.getBoundingClientRect().width > 60);
    expect(first.tab.element.getBoundingClientRect().width).toBeGreaterThan(60);
    expect(getComputedStyle(first.tab.itemTitle.querySelector(".tab-label")).display).not.toBe(
      "none",
    );
  });

  it("activates icon tabs and closes them through middle-click or their context command", async () => {
    lumine.config.set("tabs.dockTabsMode", "icons");
    const permanent = addItem("bottom", "Permanent view", { iconName: "tools", permanent: true });
    const middle = addItem("bottom", "Closable view", { iconName: "tools" });
    const context = addItem("bottom", "Another view", { iconName: "tools" });
    lumine.workspace.getBottomDock().show();
    permanent.pane.activateItem(permanent.item);

    mouse(middle.tab.itemTitle, "mousedown");
    mouse(middle.tab.itemTitle, "mouseup");
    mouse(middle.tab.itemTitle, "click");
    expect(middle.pane.getActiveItem()).toBe(middle.item);

    mouse(middle.tab.itemTitle, "auxclick", 1);
    await flushMicrotasks();
    expect(middle.pane.getItems()).not.toContain(middle.item);
    expect(permanent.pane.getItems()).toContain(permanent.item);
    expect(lumine.commands.canDispatch(permanent.tab.itemTitle, "tabs:close-tab")).toBeFalse();

    const rows = lumine.contextMenu.templateForElement(context.tab.itemTitle);
    expect(rows.find((row) => row.label === "Close Tab")?.command).toBe("tabs:close-tab");
    await lumine.commands.dispatch(context.tab.itemTitle, "tabs:close-tab");
    await flushMicrotasks();
    expect(context.pane.getItems()).toEqual([permanent.item]);
  });
});
