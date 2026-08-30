const _ = require("@lumine-code/underscore-plus");
const path = require("path");
const temp = require("@lumine-code/temp");
const TabBarView = require("../lib/tab-bar-view");
const TabTransferService = require("../lib/tab-transfer-service");
const main = require("../lib/main");
let {
  triggerMouseEvent,
  triggerClickEvent,
  buildWheelEvent,
  buildWheelPlusShiftEvent,
} = require("./event-helpers.js");

describe("Tabs package main", () => {
  let centerElement = null;

  beforeEach(async () => {
    centerElement = lumine.workspace.getCenter().paneContainer.getElement();

    await lumine.workspace.open("sample.js");

    await lumine.packages.activatePackage("tabs");
  });

  describe(".activate()", () =>
    it("appends a tab bar all existing and new panes", () => {
      jasmine.attachToDOM(centerElement);
      expect(centerElement.querySelectorAll(".pane").length).toBe(1);
      expect(centerElement.querySelectorAll(".pane > .tab-bar").length).toBe(1);

      const pane = lumine.workspace.getActivePane();
      pane.splitRight();

      expect(centerElement.querySelectorAll(".pane").length).toBe(2);
      const tabBars = centerElement.querySelectorAll(".pane > .tab-bar");
      expect(tabBars.length).toBe(2);
      expect(tabBars[1].getAttribute("location")).toBe("center");
    }));

  it("does not add a tab bar to a detached pane", async () => {
    await Promise.resolve(lumine.packages.deactivatePackage("tabs"));
    const detachedPane = lumine.workspace.getActivePane().splitRight();
    spyOn(detachedPane, "isDetached").and.returnValue(true);

    await lumine.packages.activatePackage("tabs");

    expect(detachedPane.getElement().querySelector(".tab-bar")).toBeNull();
  });

  describe(".deactivate()", () =>
    it("removes all tab bar views and stops adding them to new panes", async () => {
      const pane = lumine.workspace.getActivePane();
      pane.splitRight();
      jasmine.attachToDOM(centerElement);
      expect(centerElement.querySelectorAll(".pane").length).toBe(2);
      expect(centerElement.querySelectorAll(".pane > .tab-bar").length).toBe(2);

      await Promise.resolve(lumine.packages.deactivatePackage("tabs")); // Wrapped so works with Promise & non-Promise deactivate

      expect(centerElement.querySelectorAll(".pane").length).toBe(2);
      expect(centerElement.querySelectorAll(".pane > .tab-bar").length).toBe(0);

      pane.splitRight();
      expect(centerElement.querySelectorAll(".pane").length).toBe(3);
      expect(centerElement.querySelectorAll(".pane > .tab-bar").length).toBe(0);
    }));

  describe("the tab bar's context menu", () => {
    let tabBarElement = null;

    const labelsFor = (target) =>
      lumine.contextMenu.templateForElement(target).map((item) => item.label);

    beforeEach(() => {
      jasmine.attachToDOM(centerElement);
      tabBarElement = centerElement.querySelector(".pane > .tab-bar");
    });

    it("offers the pane-wide items on the bar's empty space", () => {
      const labels = labelsFor(tabBarElement);
      expect(labels).toContain("Reopen Closed Tab");
      expect(labels).toContain("Close Saved Tabs");
      expect(labels).toContain("Close All Tabs");
      expect(labels).toContain("Close Pane");
      // Nothing out there names a tab, so the tab's own items stay out.
      expect(labels).not.toContain("Close Tab");
      expect(labels).not.toContain("Split Up");
    });

    it("offers the tab's own items on a tab, with one Close Pane between them", () => {
      const labels = labelsFor(tabBarElement.querySelector(".tab"));
      expect(labels).toContain("Close Tab");
      expect(labels).toContain("Close All Tabs");
      // The four splits are core's own rows, written flat rather than nested.
      expect(labels.slice(labels.indexOf("Split Up"), labels.indexOf("Split Up") + 5)).toEqual([
        "Split Up",
        "Split Down",
        "Split Left",
        "Split Right",
        "Close Pane",
      ]);
      // The tab declares Close Pane and the bar's copy is gated out, so the
      // single row is not the label collision `merge` would have hidden.
      expect(labels.filter((label) => label === "Close Pane").length).toBe(1);
    });

    it("offers Hide Dock only on tabs inside a dock and hides that dock", async () => {
      const centerTab = tabBarElement.querySelector(".tab");
      const dock = lumine.workspace.getLeftDock();
      const dockItem = {
        element: document.createElement("div"),
        getTitle() {
          return "Dock Item";
        },
      };
      dock.getActivePane().addItem(dockItem);
      const dockTab = dock.getElement().querySelector(".tab");

      expect(labelsFor(centerTab)).not.toContain("Hide Dock");
      expect(labelsFor(centerTab)).toContain("Detach Tab");
      expect(labelsFor(dockTab)).toContain("Hide Dock");
      expect(labelsFor(dockTab)).not.toContain("Detach Tab");

      jasmine.attachToDOM(lumine.workspace.getElement());
      dock.show();
      await lumine.commands.dispatch(dockTab, "dock:hide");
      expect(dock.isVisible()).toBe(false);
    });
  });
});

describe("TabBarView", () => {
  let editor2;
  let [deserializerDisposable, item1, item2, editor1, pane, tabBar, tabTransferService] =
    Array.from([]);

  class TestView {
    static deserialize({ title, longTitle, iconName }) {
      return new TestView(title, longTitle, iconName);
    }
    constructor(title, longTitle, iconName, pathURI, isPermanentDockItem) {
      this.title = title;
      this.longTitle = longTitle;
      this.iconName = iconName;
      this.pathURI = pathURI;
      this._isPermanentDockItem = isPermanentDockItem;
      this.element = document.createElement("div");
      this.element.textContent = this.title;
      if (isPermanentDockItem != null) {
        this.isPermanentDockItem = () => isPermanentDockItem;
      }
    }
    getTitle() {
      return this.title;
    }
    getLongTitle() {
      return this.longTitle;
    }
    getURI() {
      return this.pathURI;
    }
    getIconName() {
      return this.iconName;
    }
    serialize() {
      return {
        deserializer: "TestView",
        title: this.title,
        longTitle: this.longTitle,
        iconName: this.iconName,
      };
    }
    copy() {
      return new TestView(this.title, this.longTitle, this.iconName);
    }
    onDidChangeTitle(callback) {
      if (this.titleCallbacks == null) {
        this.titleCallbacks = [];
      }
      this.titleCallbacks.push(callback);
      return { dispose: () => _.remove(this.titleCallbacks, callback) };
    }
    emitTitleChanged() {
      return Array.from(this.titleCallbacks != null ? this.titleCallbacks : []).map((callback) =>
        callback(),
      );
    }
    onDidChangeIcon(callback) {
      if (this.iconCallbacks == null) {
        this.iconCallbacks = [];
      }
      this.iconCallbacks.push(callback);
      return { dispose: () => _.remove(this.iconCallbacks, callback) };
    }
    emitIconChanged() {
      return Array.from(this.iconCallbacks != null ? this.iconCallbacks : []).map((callback) =>
        callback(),
      );
    }
    getFileState() {
      return this.fileState ?? lumine.FileState.UNMODIFIED;
    }
    onDidChangeFileState(callback) {
      if (this.fileStateCallbacks == null) {
        this.fileStateCallbacks = [];
      }
      this.fileStateCallbacks.push(callback);
      return { dispose: () => _.remove(this.fileStateCallbacks, callback) };
    }
    emitFileStateChanged(fileState) {
      this.fileState = fileState;
      return Array.from(this.fileStateCallbacks ?? []).map((callback) => callback(fileState));
    }
  }

  beforeEach(async () => {
    deserializerDisposable = lumine.deserializers.add(TestView);
    item1 = new TestView("Item 1", undefined, "squirrel", "sample.js");
    item2 = new TestView("Item 2");

    await lumine.workspace.open("sample.js");

    editor1 = lumine.workspace.getActiveTextEditor();
    pane = lumine.workspace.getActivePane();
    pane.addItem(item1, { index: 0 });
    pane.addItem(item2, { index: 2 });
    pane.activateItem(item2);
    tabTransferService = new TabTransferService();
    tabBar = new TabBarView(pane, "center", tabTransferService);
  });

  afterEach(() => {
    tabTransferService.dispose();
    deserializerDisposable.dispose();
  });

  describe("when tabs reach the end of the bar", () => {
    it("exposes whether the full bar is occupied", () => {
      const lastTab = tabBar.getTabs()[tabBar.getTabs().length - 1].element;
      spyOn(tabBar.element, "getBoundingClientRect").and.returnValue({
        width: 300,
        right: 300,
      });
      const lastTabRect = spyOn(lastTab, "getBoundingClientRect").and.returnValue({
        right: 240,
      });

      expect(tabBar.updateBarOccupancy()).toBe(false);
      expect(tabBar.element.classList.contains("is-fully-occupied")).toBe(false);

      lastTabRect.and.returnValue({ right: 300 });
      expect(tabBar.updateBarOccupancy()).toBe(true);
      expect(tabBar.element.classList.contains("is-fully-occupied")).toBe(true);
    });
  });

  describe("when an item's file state changes", () => {
    it("exposes exactly one mutually exclusive state on the item's tab", () => {
      const tab = tabBar.tabAtIndex(0);
      expect(tab.item).toBe(item1);
      expect(tab.element.dataset.fileState).toBe(lumine.FileState.UNMODIFIED);

      for (const fileState of [
        lumine.FileState.MODIFIED,
        lumine.FileState.CONFLICTED,
        lumine.FileState.REMOVED,
        lumine.FileState.UNMODIFIED,
      ]) {
        item1.emitFileStateChanged(fileState);
        expect(tab.element.dataset.fileState).toBe(fileState);
      }
    });
  });

  describe("when the mouse is moved over the tab bar", () =>
    it("fixes the width on every tab", () => {
      jasmine.attachToDOM(tabBar.element);

      triggerMouseEvent("mouseenter", tabBar.element);

      const initialWidth1 = tabBar.tabAtIndex(0).element.getBoundingClientRect().width.toFixed(0);
      const initialWidth2 = tabBar.tabAtIndex(2).element.getBoundingClientRect().width.toFixed(0);

      // Minor OS differences cause fractional-pixel differences so ignore fractional part
      expect(
        parseFloat(tabBar.tabAtIndex(0).element.style.maxWidth.replace("px", "")).toFixed(0),
      ).toBe(initialWidth1);
      expect(
        parseFloat(tabBar.tabAtIndex(2).element.style.maxWidth.replace("px", "")).toFixed(0),
      ).toBe(initialWidth2);
    }));

  describe("when the mouse is moved away from the tab bar", () =>
    it("resets the width on every tab", () => {
      jasmine.attachToDOM(tabBar.element);

      triggerMouseEvent("mouseenter", tabBar.element);
      triggerMouseEvent("mouseleave", tabBar.element);

      expect(tabBar.tabAtIndex(0).element.style.maxWidth).toBe("");
      expect(tabBar.tabAtIndex(1).element.style.maxWidth).toBe("");
    }));

  describe("when a drag leave event moves the mouse from the tab bar", () =>
    it("resets the width on every tab", () => {
      jasmine.attachToDOM(tabBar.element);

      triggerMouseEvent("mouseenter", tabBar.element);
      triggerMouseEvent("dragleave", tabBar.element);

      expect(tabBar.tabAtIndex(0).element.style.maxWidth).toBe("");
      expect(tabBar.tabAtIndex(1).element.style.maxWidth).toBe("");
    }));

  describe("when a tab drag ends", () => {
    beforeEach(() => {
      tabBar.draggedTab = tabBar.tabForItem(item1);
      tabBar.dragToken = "drag-token";
      spyOn(tabTransferService, "release");
      spyOn(tabTransferService, "finishSession");
      spyOn(lumine.workspace, "detachPaneItem").and.resolveTo();
    });

    it("cancels an unaccepted drag without detaching the item", () => {
      tabBar.onDragEnd({ dataTransfer: { dropEffect: "none" } });

      expect(lumine.workspace.detachPaneItem).not.toHaveBeenCalled();
      expect(tabTransferService.release).toHaveBeenCalledOnceWith(
        "drag-token",
        "tab drag cancelled",
      );
      expect(tabTransferService.finishSession).not.toHaveBeenCalled();
      expect(pane.getItems()).toContain(item1);
    });

    it("leaves an accepted drop session available for its target to commit", () => {
      tabBar.onDragEnd({ dataTransfer: { dropEffect: "move" } });

      expect(lumine.workspace.detachPaneItem).not.toHaveBeenCalled();
      expect(tabTransferService.release).not.toHaveBeenCalled();
      expect(tabTransferService.finishSession).toHaveBeenCalledOnceWith("drag-token");
    });
  });

  describe(".initialize(pane)", () => {
    it("creates a tab for each item on the tab bar's parent pane", () => {
      expect(pane.getItems().length).toBe(3);
      expect(tabBar.element.querySelectorAll(".tab").length).toBe(3);

      expect(tabBar.element.querySelectorAll(".tab")[0].querySelector(".title").textContent).toBe(
        item1.getTitle(),
      );
      expect(
        tabBar.element.querySelectorAll(".tab")[0].querySelector(".title").dataset.name,
      ).toBeUndefined();
      expect(
        tabBar.element.querySelectorAll(".tab")[0].querySelector(".title").dataset.path,
      ).toBeUndefined();
      expect(tabBar.element.querySelectorAll(".tab")[0].dataset.type).toBe("TestView");

      expect(tabBar.element.querySelectorAll(".tab")[1].querySelector(".title").textContent).toBe(
        editor1.getTitle(),
      );
      expect(tabBar.element.querySelectorAll(".tab")[1].querySelector(".title").dataset.name).toBe(
        path.basename(editor1.getPath()),
      );
      expect(tabBar.element.querySelectorAll(".tab")[1].querySelector(".title").dataset.path).toBe(
        editor1.getPath(),
      );
      expect(tabBar.element.querySelectorAll(".tab")[1].dataset.type).toBe("TextEditor");

      expect(tabBar.element.querySelectorAll(".tab")[2].querySelector(".title").textContent).toBe(
        item2.getTitle(),
      );
      expect(
        tabBar.element.querySelectorAll(".tab")[2].querySelector(".title").dataset.name,
      ).toBeUndefined();
      expect(
        tabBar.element.querySelectorAll(".tab")[2].querySelector(".title").dataset.path,
      ).toBeUndefined();
      expect(tabBar.element.querySelectorAll(".tab")[0].dataset.type).toBe("TestView");
    });

    it("highlights the tab for the active pane item", () =>
      expect(tabBar.element.querySelectorAll(".tab")[2]).toHaveClass("active"));

    it("emits a warning when ::onDid... functions are not valid Disposables", () => {
      class BadView {
        constructor() {
          this.element = document.createElement("div");
        }
        getTitle() {
          return "Anything";
        }
        onDidChangeTitle() {}
        onDidChangeIcon() {}
        onDidChangeFileState() {}
        onDidSave() {}
        onDidChangePath() {}
      }

      const warnings = [];
      spyOn(console, "warn").and.callFake((message, object) => warnings.push({ message, object }));

      const badItem = new BadView("Item 3");
      pane.addItem(badItem);

      expect(warnings[0].message).toContain("onDidChangeTitle");
      expect(warnings[0].object).toBe(badItem);

      expect(warnings[1].message).toContain("onDidChangePath");
      expect(warnings[1].object).toBe(badItem);

      expect(warnings[2].message).toContain("onDidChangeIcon");
      expect(warnings[2].object).toBe(badItem);

      expect(warnings[3].message).toContain("onDidChangeFileState");
      expect(warnings[3].object).toBe(badItem);

      expect(warnings[4].message).toContain("onDidSave");
      expect(warnings[4].object).toBe(badItem);
    });
  });

  describe("when the active pane item changes", () =>
    it("highlights the tab for the new active pane item", () => {
      pane.activateItem(item1);
      expect(tabBar.element.querySelectorAll(".active").length).toBe(1);
      expect(tabBar.element.querySelectorAll(".tab")[0]).toHaveClass("active");

      pane.activateItem(item2);
      expect(tabBar.element.querySelectorAll(".active").length).toBe(1);
      expect(tabBar.element.querySelectorAll(".tab")[2]).toHaveClass("active");
    }));

  describe("when a new item is added to the pane", () => {
    it("sets modified on a new tab whose item is initially modified", async () => {
      const editor2 = await lumine.workspace.createItemForURI("sample.txt");

      editor2.insertText("x");
      pane.activateItem(editor2);
      expect(tabBar.tabForItem(editor2).element.dataset.fileState).toBe(lumine.FileState.MODIFIED);
    });

    describe("when addNewTabsAtEnd is set to true in package settings", () => {
      it("adds a tab for the new item at the end of the tab bar", () => {
        lumine.config.set("tabs.addNewTabsAtEnd", true);
        const item3 = new TestView("Item 3");
        pane.activateItem(item3);
        expect(tabBar.element.querySelectorAll(".tab").length).toBe(4);
        expect(tabBar.tabAtIndex(3).element.querySelector(".title").textContent).toMatch("Item 3");
      });

      it("puts the new tab at the last index of the pane's items", () => {
        lumine.config.set("tabs.addNewTabsAtEnd", true);
        const item3 = new TestView("Item 3");
        // activate item1 so default is to add immediately after
        pane.activateItem(item1);
        pane.activateItem(item3);
        expect(pane.getItems()[pane.getItems().length - 1]).toEqual(item3);
      });
    });

    describe("when addNewTabsAtEnd is set to false in package settings", () =>
      it("adds a tab for the new item at the same index as the item in the pane", () => {
        lumine.config.set("tabs.addNewTabsAtEnd", false);
        pane.activateItem(item1);
        const item3 = new TestView("Item 3");
        pane.activateItem(item3);
        expect(tabBar.element.querySelectorAll(".tab").length).toBe(4);
        expect(tabBar.tabAtIndex(1).element.querySelector(".title").textContent).toMatch("Item 3");
      }));
  });

  describe("when an item is removed from the pane", () => {
    it("removes the item's tab from the tab bar", () => {
      pane.destroyItem(item2);
      expect(tabBar.getTabs().length).toBe(2);
      expect(tabBar.element.textContent).not.toMatch("Item 2");
    });

    it("updates the titles of the remaining tabs", () => {
      expect(tabBar.tabForItem(item2).element.textContent).toMatch("Item 2");
      item2.longTitle = "2";
      const item2a = new TestView("Item 2");
      item2a.longTitle = "2a";
      pane.activateItem(item2a);
      expect(tabBar.tabForItem(item2).element.textContent).toMatch("2");
      expect(tabBar.tabForItem(item2a).element.textContent).toMatch("2a");
      pane.destroyItem(item2a);
      expect(tabBar.tabForItem(item2).element.textContent).toMatch("Item 2");
    });
  });

  describe("when a tab is clicked", () => {
    it("shows the associated item on the pane and focuses the pane", () => {
      spyOn(pane, "activate");

      let { mousedown, click } = triggerClickEvent(tabBar.tabAtIndex(0).element, { button: 0 });
      expect(pane.getActiveItem()).toBe(pane.getItems()[0]);
      // allows dragging
      expect(mousedown.preventDefault).not.toHaveBeenCalled();
      expect(click.preventDefault).toHaveBeenCalled();

      ({ mousedown, click } = triggerClickEvent(tabBar.tabAtIndex(2).element, { button: 0 }));
      expect(pane.getActiveItem()).toBe(pane.getItems()[2]);
      // allows dragging
      expect(mousedown.preventDefault).not.toHaveBeenCalled();
      expect(click.preventDefault).toHaveBeenCalled();
      expect(pane.activate.calls.count()).toBe(2);
    });

    it("focuses the pane item when the active tab is clicked", () => {
      const paneElement = pane.getElement();
      paneElement.insertBefore(tabBar.element, paneElement.firstChild);
      jasmine.attachToDOM(paneElement);
      pane.activateItem(editor1);

      tabBar.element.focus();
      expect(document.activeElement).toBe(tabBar.element);

      triggerClickEvent(tabBar.tabForItem(editor1).element, { button: 0 });

      expect(lumine.views.getView(editor1).contains(document.activeElement)).toBe(true);
    });

    it("can reorder tabs while the pane item has focus", () => {
      const paneElement = pane.getElement();
      paneElement.insertBefore(tabBar.element, paneElement.firstChild);
      jasmine.attachToDOM(lumine.workspace.getElement());
      pane.activateItem(editor1);
      pane.activate();

      const editorElement = lumine.views.getView(editor1);
      editorElement.focus();
      const press = (key) =>
        lumine.keymaps.handleKeyboardEvent(
          lumine.keymaps.constructor.buildKeydownEvent(key, {
            ctrl: true,
            shift: true,
            target: document.activeElement,
          }),
        );

      press("pageup");
      expect(pane.getItems()).toEqual([editor1, item1, item2]);

      press("pagedown");
      expect(pane.getItems()).toEqual([item1, editor1, item2]);
    });

    it("closes the tab when middle clicked", () => {
      const { click } = triggerClickEvent(tabBar.tabForItem(editor1).element, { button: 1 });

      expect(pane.getItems().length).toBe(2);
      expect(pane.getItems().indexOf(editor1)).toBe(-1);
      expect(editor1.isDestroyed()).toBeTruthy();
      expect(tabBar.getTabs().length).toBe(2);
      expect(tabBar.element.textContent).not.toMatch("sample.js");

      expect(click.preventDefault).toHaveBeenCalled();
    });

    it("doesn't switch tab when right (or ctrl-left) clicked", () => {
      spyOn(pane, "activate");

      let { mousedown } = triggerClickEvent(tabBar.tabAtIndex(0).element, { button: 2 });
      expect(pane.getActiveItem()).not.toBe(pane.getItems()[0]);
      expect(mousedown.preventDefault).toHaveBeenCalled();

      ({ mousedown } = triggerClickEvent(tabBar.tabAtIndex(0).element, {
        button: 0,
        ctrlKey: true,
      }));
      expect(pane.getActiveItem()).not.toBe(pane.getItems()[0]);
      expect(mousedown.preventDefault).toHaveBeenCalled();

      // We don't switch tabs, but the pane should still be activated
      // because of the mouse click
      expect(pane.activate).toHaveBeenCalled();
    });
  });

  describe("when a tab's close icon is clicked", () =>
    it("destroys the tab's item on the pane", () => {
      tabBar.tabForItem(editor1).element.querySelector(".close-icon").click();
      expect(pane.getItems().length).toBe(2);
      expect(pane.getItems().indexOf(editor1)).toBe(-1);
      expect(editor1.isDestroyed()).toBeTruthy();
      expect(tabBar.getTabs().length).toBe(2);
      expect(tabBar.element.textContent).not.toMatch("sample.js");
    }));

  describe("when an item is activated", () => {
    let [item3] = Array.from([]);
    beforeEach(() => {
      item3 = new TestView("Item 3");
      pane.activateItem(item3);

      // Set up styles so the tab bar has a scrollbar
      tabBar.element.style.display = "flex";
      tabBar.element.style.overflowX = "scroll";
      tabBar.element.style.margin = "0";

      const container = document.createElement("div");
      container.style.width = "150px";
      container.appendChild(tabBar.element);
      jasmine.attachToDOM(container);

      // Pin the tab widths so that which tabs are visible does not depend on
      // the platform's font metrics: three 45px tabs fit the 150px container,
      // the fourth overflows.
      const style = document.createElement("style");
      style.textContent = ".tab-bar .tab { width: 45px; flex: none; }";
      jasmine.attachToDOM(style);

      // Expect there to be content to scroll
      expect(tabBar.element.scrollWidth).toBeGreaterThan(tabBar.element.clientWidth);
    });

    it("does not scroll to the item when it is visible", () => {
      pane.activateItem(item1);
      expect(tabBar.element.scrollLeft).toBe(0);

      pane.activateItem(editor1);
      expect(tabBar.element.scrollLeft).toBe(0);

      pane.activateItem(item2);
      expect(tabBar.element.scrollLeft).toBe(0);

      pane.activateItem(item3);
      expect(tabBar.element.scrollLeft).not.toBe(0);
    });

    it("scrolls to the item when it isn't completely visible", () => {
      tabBar.element.scrollLeft = 5;
      expect(tabBar.element.scrollLeft).toBe(5); // This can be 0 if there is no horizontal scrollbar

      pane.activateItem(item1);
      expect(tabBar.element.scrollLeft).toBe(0);

      pane.activateItem(item3);
      expect(tabBar.element.scrollLeft).toBe(
        tabBar.element.scrollWidth - tabBar.element.clientWidth,
      );
    });
  });

  describe("when a tab item's title changes", () =>
    it("updates the title of the item's tab", () => {
      editor1.buffer.setPath("/this/is-a/test.txt");
      expect(tabBar.tabForItem(editor1).element.textContent).toMatch("test.txt");
    }));

  describe("when two tabs have the same title", () =>
    it("displays the long title on the tab if it's available from the item", () => {
      item1.title = "Old Man";
      item1.longTitle = "Grumpy Old Man";
      item1.emitTitleChanged();
      item2.title = "Old Man";
      item2.longTitle = "Jolly Old Man";
      item2.emitTitleChanged();

      expect(tabBar.tabForItem(item1).element.textContent).toMatch("Grumpy Old Man");
      expect(tabBar.tabForItem(item2).element.textContent).toMatch("Jolly Old Man");

      item2.longTitle = undefined;
      item2.emitTitleChanged();

      expect(tabBar.tabForItem(item1).element.textContent).toMatch("Grumpy Old Man");
      expect(tabBar.tabForItem(item2).element.textContent).toMatch("Old Man");
    }));

  describe("the close button", () => {
    it("is present in the center, regardless of the value returned by isPermanentDockItem()", () => {
      const item3 = new TestView("Item 3", undefined, "squirrel", "sample.js");
      expect(item3.isPermanentDockItem).toBeUndefined();
      const item4 = new TestView("Item 4", undefined, "squirrel", "sample.js", true);
      expect(typeof item4.isPermanentDockItem).toBe("function");
      const item5 = new TestView("Item 5", undefined, "squirrel", "sample.js", false);
      expect(typeof item5.isPermanentDockItem).toBe("function");
      pane.activateItem(item3);
      pane.activateItem(item4);
      pane.activateItem(item5);
      const tabs = tabBar.element.querySelectorAll(".tab");
      expect(tabs[2].querySelector(".close-icon")).not.toEqual(null);
      expect(tabs[3].querySelector(".close-icon")).not.toEqual(null);
      expect(tabs[4].querySelector(".close-icon")).not.toEqual(null);
    });

    if (lumine.workspace.getRightDock == null) {
      return;
    }
    describe("in docks", () => {
      beforeEach(() => {
        pane = lumine.workspace.getRightDock().getActivePane();
        tabBar = new TabBarView(pane, "right", tabTransferService);
      });

      it("isn't shown if the method returns true", () => {
        item1 = new TestView("Item 1", undefined, "squirrel", "sample.js", true);
        expect(typeof item1.isPermanentDockItem).toBe("function");
        pane.activateItem(item1);
        const tab = tabBar.element.querySelector(".tab");
        expect(tab.querySelector(".close-icon")).toEqual(null);
      });

      it("is shown if the method returns false", () => {
        item1 = new TestView("Item 1", undefined, "squirrel", "sample.js", false);
        expect(typeof item1.isPermanentDockItem).toBe("function");
        pane.activateItem(item1);
        const tab = tabBar.element.querySelector(".tab");
        expect(tab.querySelector(".close-icon")).not.toBeUndefined();
      });

      it("is shown if the method doesn't exist", () => {
        item1 = new TestView("Item 1", undefined, "squirrel", "sample.js");
        expect(item1.isPermanentDockItem).toBeUndefined();
        pane.activateItem(item1);
        const tab = tabBar.element.querySelector(".tab");
        expect(tab.querySelector(".close-icon")).not.toEqual(null);
      });
    });
  });

  describe("when an item has an icon defined", () => {
    it("displays the icon on the tab", () => {
      expect(tabBar.element.querySelectorAll(".tab")[0].querySelector(".title")).toHaveClass(
        "icon",
      );
      expect(tabBar.element.querySelectorAll(".tab")[0].querySelector(".title")).toHaveClass(
        "icon-squirrel",
      );
    });

    it("hides the icon from the tab if the icon is removed", () => {
      item1.getIconName = null;
      item1.emitIconChanged();
      expect(tabBar.element.querySelectorAll(".tab")[0].querySelector(".title")).not.toHaveClass(
        "icon",
      );
      expect(tabBar.element.querySelectorAll(".tab")[0].querySelector(".title")).not.toHaveClass(
        "icon-squirrel",
      );
    });

    it("updates the icon on the tab if the icon is changed", () => {
      item1.getIconName = () => "zap";
      item1.emitIconChanged();
      expect(tabBar.element.querySelectorAll(".tab")[0].querySelector(".title")).toHaveClass(
        "icon",
      );
      expect(tabBar.element.querySelectorAll(".tab")[0].querySelector(".title")).toHaveClass(
        "icon-zap",
      );
    });

    describe("when showIcon is set to true in package settings", () => {
      beforeEach(async () => {
        spyOn(tabBar.tabForItem(item1), "updateIconVisibility").and.callThrough();

        lumine.config.set("tabs.showIcons", true);

        await conditionPromise(
          () => tabBar.tabForItem(item1).updateIconVisibility.calls.count() > 0,
        );

        tabBar.tabForItem(item1).updateIconVisibility.calls.reset();
      });

      it("doesn't hide the icon", () =>
        expect(tabBar.element.querySelectorAll(".tab")[0].querySelector(".title")).not.toHaveClass(
          "hide-icon",
        ));

      it("hides the icon from the tab when showIcon is changed to false", async () => {
        lumine.config.set("tabs.showIcons", false);

        await conditionPromise(
          () => tabBar.tabForItem(item1).updateIconVisibility.calls.count() > 0,
        );

        expect(tabBar.element.querySelectorAll(".tab")[0].querySelector(".title")).toHaveClass(
          "hide-icon",
        );
      });
    });

    describe("when showIcon is set to false in package settings", () => {
      beforeEach(async () => {
        spyOn(tabBar.tabForItem(item1), "updateIconVisibility").and.callThrough();

        lumine.config.set("tabs.showIcons", false);

        await conditionPromise(
          () => tabBar.tabForItem(item1).updateIconVisibility.calls.count() > 0,
        );

        tabBar.tabForItem(item1).updateIconVisibility.calls.reset();
      });

      it("hides the icon", () =>
        expect(tabBar.element.querySelectorAll(".tab")[0].querySelector(".title")).toHaveClass(
          "hide-icon",
        ));

      it("shows the icon on the tab when showIcon is changed to true", async () => {
        lumine.config.set("tabs.showIcons", true);

        await conditionPromise(
          () => tabBar.tabForItem(item1).updateIconVisibility.calls.count() > 0,
        );

        expect(tabBar.element.querySelectorAll(".tab")[0].querySelector(".title")).not.toHaveClass(
          "hide-icon",
        );
      });
    });
  });

  describe("when the item doesn't have an icon defined", () => {
    it("doesn't display an icon on the tab", () => {
      expect(tabBar.element.querySelectorAll(".tab")[2].querySelector(".title")).not.toHaveClass(
        "icon",
      );
      expect(tabBar.element.querySelectorAll(".tab")[2].querySelector(".title")).not.toHaveClass(
        "icon-squirrel",
      );
    });

    it("shows the icon on the tab if an icon is defined", () => {
      item2.getIconName = () => "squirrel";
      item2.emitIconChanged();
      expect(tabBar.element.querySelectorAll(".tab")[2].querySelector(".title")).toHaveClass(
        "icon",
      );
      expect(tabBar.element.querySelectorAll(".tab")[2].querySelector(".title")).toHaveClass(
        "icon-squirrel",
      );
    });
  });

  describe("when a tab item's file state changes", () =>
    it("updates the tab's data-file-state attribute", () => {
      const tab = tabBar.tabForItem(editor1);
      expect(editor1.getFileState()).toBe(lumine.FileState.UNMODIFIED);
      expect(tab.element.dataset.fileState).toBe(lumine.FileState.UNMODIFIED);

      editor1.insertText("x");
      advanceClock(editor1.buffer.stoppedChangingDelay);
      expect(editor1.getFileState()).toBe(lumine.FileState.MODIFIED);
      expect(tab.element.dataset.fileState).toBe(lumine.FileState.MODIFIED);

      editor1.undo();
      advanceClock(editor1.buffer.stoppedChangingDelay);
      expect(editor1.getFileState()).toBe(lumine.FileState.UNMODIFIED);
      expect(tab.element.dataset.fileState).toBe(lumine.FileState.UNMODIFIED);
    }));

  describe("when a pane item moves to a new index", () => {
    // behavior is independent of addNewTabs config
    describe("when addNewTabsAtEnd is set to true in package settings", () =>
      it("updates the order of the tabs to match the new item order", () => {
        lumine.config.set("tabs.addNewTabsAtEnd", true);
        expect(tabBar.getTabs().map((tab) => tab.element.textContent)).toEqual([
          "Item 1",
          "sample.js",
          "Item 2",
        ]);
        pane.moveItem(item2, 1);
        expect(tabBar.getTabs().map((tab) => tab.element.textContent)).toEqual([
          "Item 1",
          "Item 2",
          "sample.js",
        ]);
        pane.moveItem(editor1, 0);
        expect(tabBar.getTabs().map((tab) => tab.element.textContent)).toEqual([
          "sample.js",
          "Item 1",
          "Item 2",
        ]);
        pane.moveItem(item1, 2);
        expect(tabBar.getTabs().map((tab) => tab.element.textContent)).toEqual([
          "sample.js",
          "Item 2",
          "Item 1",
        ]);
      }));

    describe("when addNewTabsAtEnd is set to false in package settings", () =>
      it("updates the order of the tabs to match the new item order", () => {
        lumine.config.set("tabs.addNewTabsAtEnd", false);
        expect(tabBar.getTabs().map((tab) => tab.element.textContent)).toEqual([
          "Item 1",
          "sample.js",
          "Item 2",
        ]);
        pane.moveItem(item2, 1);
        expect(tabBar.getTabs().map((tab) => tab.element.textContent)).toEqual([
          "Item 1",
          "Item 2",
          "sample.js",
        ]);
        pane.moveItem(editor1, 0);
        expect(tabBar.getTabs().map((tab) => tab.element.textContent)).toEqual([
          "sample.js",
          "Item 1",
          "Item 2",
        ]);
        pane.moveItem(item1, 2);
        expect(tabBar.getTabs().map((tab) => tab.element.textContent)).toEqual([
          "sample.js",
          "Item 2",
          "Item 1",
        ]);
      }));
  });

  describe("context menu commands", () => {
    beforeEach(() => {
      const paneElement = pane.getElement();
      return paneElement.insertBefore(tabBar.element, paneElement.firstChild);
    });

    describe("when tabs:close-tab is fired", () =>
      it("closes the active tab", () => {
        triggerClickEvent(tabBar.tabForItem(item2).element, { button: 2 });
        lumine.commands.dispatch(tabBar.element, "tabs:close-tab");
        expect(pane.getItems().length).toBe(2);
        expect(pane.getItems().indexOf(item2)).toBe(-1);
        expect(tabBar.getTabs().length).toBe(2);
        expect(tabBar.element.textContent).not.toMatch("Item 2");
      }));

    describe("when the bar's empty space was right-clicked last", () =>
      it("leaves the tabs alone, having no target tab to act on", () => {
        triggerClickEvent(tabBar.tabForItem(item2).element, { button: 2 });
        triggerClickEvent(tabBar.element, { button: 2 });

        lumine.commands.dispatch(tabBar.element, "tabs:close-tab");
        expect(pane.getItems().length).toBe(3);
      }));

    describe("when tabs:close-other-tabs is fired", () =>
      it("closes all other tabs except the active tab", () => {
        triggerClickEvent(tabBar.tabForItem(item2).element, { button: 2 });
        lumine.commands.dispatch(tabBar.element, "tabs:close-other-tabs");
        expect(pane.getItems().length).toBe(1);
        expect(tabBar.getTabs().length).toBe(1);
        expect(tabBar.element.textContent).not.toMatch("sample.js");
        expect(tabBar.element.textContent).toMatch("Item 2");
      }));

    describe("when tabs:close-tabs-to-right is fired", () =>
      it("closes only the tabs to the right of the active tab", () => {
        pane.activateItem(editor1);
        triggerClickEvent(tabBar.tabForItem(editor1).element, { button: 2 });
        lumine.commands.dispatch(tabBar.element, "tabs:close-tabs-to-right");
        expect(pane.getItems().length).toBe(2);
        expect(tabBar.getTabs().length).toBe(2);
        expect(tabBar.element.textContent).not.toMatch("Item 2");
        expect(tabBar.element.textContent).toMatch("Item 1");
      }));

    describe("when tabs:close-tabs-to-left is fired", () =>
      it("closes only the tabs to the left of the active tab", () => {
        pane.activateItem(editor1);
        triggerClickEvent(tabBar.tabForItem(editor1).element, { button: 2 });
        lumine.commands.dispatch(tabBar.element, "tabs:close-tabs-to-left");
        expect(pane.getItems().length).toBe(2);
        expect(tabBar.getTabs().length).toBe(2);
        expect(tabBar.element.textContent).toMatch("Item 2");
        expect(tabBar.element.textContent).not.toMatch("Item 1");
      }));

    describe("when tabs:close-all-tabs is fired", () =>
      it("closes all the tabs", () => {
        expect(pane.getItems().length).toBeGreaterThan(0);
        lumine.commands.dispatch(tabBar.element, "tabs:close-all-tabs");
        expect(pane.getItems().length).toBe(0);
      }));

    describe("when tabs:close-saved-tabs is fired", () =>
      it("closes all the saved tabs", () => {
        item1.fileState = lumine.FileState.CONFLICTED;
        lumine.commands.dispatch(tabBar.element, "tabs:close-saved-tabs");
        expect(pane.getItems().length).toBe(1);
        expect(pane.getItems()[0]).toBe(item1);
      }));

    describe("when tabs:split-up is fired", () =>
      it("splits the selected tab up", () => {
        triggerClickEvent(tabBar.tabForItem(item2).element, { button: 2 });
        expect(lumine.workspace.getCenter().getTiledPanes().length).toBe(1);

        lumine.commands.dispatch(tabBar.element, "tabs:split-up");
        expect(lumine.workspace.getCenter().getTiledPanes().length).toBe(2);
        expect(lumine.workspace.getCenter().getTiledPanes()[1]).toBe(pane);
        expect(lumine.workspace.getCenter().getTiledPanes()[0].getItems()[0].getTitle()).toBe(
          item2.getTitle(),
        );
      }));

    describe("when tabs:split-down is fired", () =>
      it("splits the selected tab down", () => {
        triggerClickEvent(tabBar.tabForItem(item2).element, { button: 2 });
        expect(lumine.workspace.getCenter().getTiledPanes().length).toBe(1);

        lumine.commands.dispatch(tabBar.element, "tabs:split-down");
        expect(lumine.workspace.getCenter().getTiledPanes().length).toBe(2);
        expect(lumine.workspace.getCenter().getTiledPanes()[0]).toBe(pane);
        expect(lumine.workspace.getCenter().getTiledPanes()[1].getItems()[0].getTitle()).toBe(
          item2.getTitle(),
        );
      }));

    describe("when tabs:split-left is fired", () =>
      it("splits the selected tab to the left", () => {
        triggerClickEvent(tabBar.tabForItem(item2).element, { button: 2 });
        expect(lumine.workspace.getCenter().getTiledPanes().length).toBe(1);

        lumine.commands.dispatch(tabBar.element, "tabs:split-left");
        expect(lumine.workspace.getCenter().getTiledPanes().length).toBe(2);
        expect(lumine.workspace.getCenter().getTiledPanes()[1]).toBe(pane);
        expect(lumine.workspace.getCenter().getTiledPanes()[0].getItems()[0].getTitle()).toBe(
          item2.getTitle(),
        );
      }));

    describe("when tabs:split-right is fired", () =>
      it("splits the selected tab to the right", () => {
        triggerClickEvent(tabBar.tabForItem(item2).element, { button: 2 });
        expect(lumine.workspace.getCenter().getTiledPanes().length).toBe(1);

        lumine.commands.dispatch(tabBar.element, "tabs:split-right");
        expect(lumine.workspace.getCenter().getTiledPanes().length).toBe(2);
        expect(lumine.workspace.getCenter().getTiledPanes()[0]).toBe(pane);
        expect(lumine.workspace.getCenter().getTiledPanes()[1].getItems()[0].getTitle()).toBe(
          item2.getTitle(),
        );
      }));

    describe("when tabs:detach-tab is fired", () => {
      describe("by right-clicking on a tab", () => {
        beforeEach(() => {
          triggerClickEvent(tabBar.tabForItem(item1).element, { button: 2 });
          expect(lumine.workspace.getCenter().getTiledPanes().length).toBe(1);
          spyOn(lumine.workspace, "detachPaneItem").and.resolveTo();
        });

        it("hands the exact item to the workspace without closing or recreating it", async () => {
          await lumine.commands.dispatch(tabBar.element, "tabs:detach-tab");

          expect(lumine.workspace.detachPaneItem).toHaveBeenCalledOnceWith(item1);
          expect(pane.getItems()).toContain(item1);
          expect(tabBar.tabForItem(item1)).not.toBeNull();
        });
      });

      it("detaches the active item from the pane command", async () => {
        spyOn(lumine.workspace, "detachPaneItem").and.resolveTo();

        await lumine.commands.dispatch(pane.getElement(), "tabs:detach-tab");

        expect(lumine.workspace.detachPaneItem).toHaveBeenCalledOnceWith(pane.getActiveItem());
      });
    });
  });

  describe("command palette commands", () => {
    let paneElement = null;

    beforeEach(() => (paneElement = pane.getElement()));

    describe("when tabs:close-tab is fired", () => {
      it("closes the active tab", () => {
        lumine.commands.dispatch(paneElement, "tabs:close-tab");
        expect(pane.getItems().length).toBe(2);
        expect(pane.getItems().indexOf(item2)).toBe(-1);
        expect(tabBar.getTabs().length).toBe(2);
        expect(tabBar.element.textContent).not.toMatch("Item 2");
      });

      it("does nothing if no tabs are open", () => {
        lumine.commands.dispatch(paneElement, "tabs:close-tab");
        lumine.commands.dispatch(paneElement, "tabs:close-tab");
        lumine.commands.dispatch(paneElement, "tabs:close-tab");
        expect(pane.getItems().length).toBe(0);
        expect(tabBar.getTabs().length).toBe(0);
      });
    });

    describe("when tabs:close-other-tabs is fired", () =>
      it("closes all other tabs except the active tab", () => {
        lumine.commands.dispatch(paneElement, "tabs:close-other-tabs");
        expect(pane.getItems().length).toBe(1);
        expect(tabBar.getTabs().length).toBe(1);
        expect(tabBar.element.textContent).not.toMatch("sample.js");
        expect(tabBar.element.textContent).toMatch("Item 2");
      }));

    describe("when tabs:close-tabs-to-right is fired", () =>
      it("closes only the tabs to the right of the active tab", () => {
        pane.activateItem(editor1);
        lumine.commands.dispatch(paneElement, "tabs:close-tabs-to-right");
        expect(pane.getItems().length).toBe(2);
        expect(tabBar.getTabs().length).toBe(2);
        expect(tabBar.element.textContent).not.toMatch("Item 2");
        expect(tabBar.element.textContent).toMatch("Item 1");
      }));

    describe("when tabs:close-all-tabs is fired", () =>
      it("closes all the tabs", () => {
        expect(pane.getItems().length).toBeGreaterThan(0);
        lumine.commands.dispatch(paneElement, "tabs:close-all-tabs");
        expect(pane.getItems().length).toBe(0);
      }));

    describe("when tabs:close-saved-tabs is fired", () =>
      it("closes all the saved tabs", () => {
        item1.fileState = lumine.FileState.REMOVED;
        lumine.commands.dispatch(paneElement, "tabs:close-saved-tabs");
        expect(pane.getItems().length).toBe(1);
        expect(pane.getItems()[0]).toBe(item1);
      }));

    describe("when pane:close is fired", () =>
      it("destroys all the tabs within the pane", async () => {
        const pane2 = pane.splitDown({ copyActiveItem: true });
        const tabBar2 = new TabBarView(pane2, "center", tabTransferService);
        const tab2 = tabBar2.tabAtIndex(0);
        spyOn(tab2, "destroy");

        await Promise.resolve(pane2.close());
        expect(tab2.destroy).toHaveBeenCalled();
      }));
  });

  describe("when the tab bar is double clicked", () =>
    it("opens a new empty editor", () => {
      const newFileHandler = jasmine.createSpy("newFileHandler");
      lumine.commands.add(tabBar.element, "application:new-file", newFileHandler);

      triggerMouseEvent("dblclick", tabBar.getTabs()[0].element);
      expect(newFileHandler.calls.count()).toBe(0);

      triggerMouseEvent("dblclick", tabBar.element);
      expect(newFileHandler.calls.count()).toBe(1);
    }));

  describe("when the tab bar is right-clicked", () => {
    it("adds the right-clicked class when right-clicked", () => {
      triggerClickEvent(tabBar.tabAtIndex(0).element, { button: 2 });
      expect(tabBar.tabAtIndex(0).element.classList.contains("right-clicked")).toBe(true);
      triggerClickEvent(tabBar.tabAtIndex(2).element, { button: 2 });
      expect(tabBar.tabAtIndex(2).element.classList.contains("right-clicked")).toBe(true);
      expect(tabBar.tabAtIndex(0).element.classList.contains("right-clicked")).toBe(false);
    });

    it("forgets the right-clicked tab when the bar's empty space is right-clicked", () => {
      triggerClickEvent(tabBar.tabAtIndex(0).element, { button: 2 });
      expect(tabBar.rightClickedTab).toBe(tabBar.tabAtIndex(0));

      triggerClickEvent(tabBar.element, { button: 2 });
      expect(tabBar.rightClickedTab).toBeUndefined();
      expect(tabBar.tabAtIndex(0).element.classList.contains("right-clicked")).toBe(false);
    });
  });

  describe("when the mouse wheel is used on the tab bar", () => {
    describe("when tabScrolling is true in package settings", () => {
      beforeEach(() => {
        lumine.config.set("tabs.tabScrolling", true);
        return lumine.config.set("tabs.tabScrollingThreshold", 120);
      });

      describe("when the mouse wheel scrolls up", () => {
        it("changes the active tab to the previous tab", () => {
          expect(pane.getActiveItem()).toBe(item2);
          tabBar.element.dispatchEvent(buildWheelEvent(120));
          expect(pane.getActiveItem()).toBe(editor1);
        });

        it("changes the active tab to the previous tab only after the wheelDelta crosses the threshold", () => {
          expect(pane.getActiveItem()).toBe(item2);
          tabBar.element.dispatchEvent(buildWheelEvent(50));
          expect(pane.getActiveItem()).toBe(item2);
          tabBar.element.dispatchEvent(buildWheelEvent(50));
          expect(pane.getActiveItem()).toBe(item2);
          tabBar.element.dispatchEvent(buildWheelEvent(50));
          expect(pane.getActiveItem()).toBe(editor1);
        });
      });

      describe("when the mouse wheel scrolls down", () =>
        it("changes the active tab to the previous tab", () => {
          expect(pane.getActiveItem()).toBe(item2);
          tabBar.element.dispatchEvent(buildWheelEvent(-120));
          expect(pane.getActiveItem()).toBe(item1);
        }));

      describe("when the mouse wheel scrolls up and shift key is pressed", () =>
        it("does not change the active tab", () => {
          expect(pane.getActiveItem()).toBe(item2);
          tabBar.element.dispatchEvent(buildWheelPlusShiftEvent(120));
          expect(pane.getActiveItem()).toBe(item2);
        }));

      describe("when the mouse wheel scrolls down and shift key is pressed", () =>
        it("does not change the active tab", () => {
          expect(pane.getActiveItem()).toBe(item2);
          tabBar.element.dispatchEvent(buildWheelPlusShiftEvent(-120));
          expect(pane.getActiveItem()).toBe(item2);
        }));

      describe("when the tabScrolling is changed to false", () =>
        it("does not change the active tab when scrolling", () => {
          lumine.config.set("tabs.tabScrolling", false);

          expect(pane.getActiveItem()).toBe(item2);
          tabBar.element.dispatchEvent(buildWheelEvent(120));
          expect(pane.getActiveItem()).toBe(item2);
        }));
    });

    describe("when tabScrolling is false in package settings", () => {
      beforeEach(() => lumine.config.set("tabs.tabScrolling", false));

      describe("when the mouse wheel scrolls up one unit", () =>
        it("does not change the active tab", () => {
          expect(pane.getActiveItem()).toBe(item2);
          tabBar.element.dispatchEvent(buildWheelEvent(120));
          expect(pane.getActiveItem()).toBe(item2);
        }));

      describe("when the mouse wheel scrolls down one unit", () =>
        it("does not change the active tab", () => {
          expect(pane.getActiveItem()).toBe(item2);
          tabBar.element.dispatchEvent(buildWheelEvent(-120));
          expect(pane.getActiveItem()).toBe(item2);
        }));
    });
  });

  describe("when alwaysShowTabBar is true in package settings", () => {
    beforeEach(() => lumine.config.set("tabs.alwaysShowTabBar", true));

    describe("when more than one tab is open", () =>
      it("shows the tab bar", () => {
        expect(pane.getItems().length).toBe(3);
        expect(tabBar.element).not.toHaveClass("hidden");
      }));

    describe("when only one tab is open", () =>
      it("shows the tab bar", async () => {
        expect(pane.getItems().length).toBe(3);

        await pane.destroyItem(item1);

        await pane.destroyItem(item2);

        expect(pane.getItems().length).toBe(1);
        expect(tabBar.element).not.toHaveClass("hidden");
      }));
  });

  describe("when alwaysShowTabBar is false in package settings", () => {
    beforeEach(() => lumine.config.set("tabs.alwaysShowTabBar", false));

    describe("when more than one tab is open", () =>
      it("shows the tab bar", () => {
        expect(pane.getItems().length).toBe(3);
        expect(tabBar.element).not.toHaveClass("hidden");
      }));

    describe("when only one tab is open", () =>
      it("hides the tab bar", async () => {
        expect(pane.getItems().length).toBe(3);

        await pane.destroyItem(item1);

        await pane.destroyItem(item2);

        expect(pane.getItems().length).toBe(1);
        expect(tabBar.element).toHaveClass("hidden");
      }));

    describe("when there are multiple panes", () =>
      it("hides each tab bar separately", async () => {
        const item3 = new TestView("Item 3");
        const item4 = new TestView("Item 4");
        const pane2 = pane.splitRight({ items: [item3, item4] });
        const tabBar2 = new TabBarView(pane2, "center", tabTransferService);

        expect(tabBar.element).not.toHaveClass("hidden");
        expect(tabBar2.element).not.toHaveClass("hidden");

        await pane2.destroyItem(item3);

        expect(pane2.getItems().length).toBe(1);

        expect(tabBar.element).not.toHaveClass("hidden");
        expect(tabBar2.element).toHaveClass("hidden");
      }));
  });

  if (
    lumine.workspace.buildTextEditor().isPending != null ||
    lumine.workspace.getActivePane().getActiveItem != null
  ) {
    const isPending = function (item) {
      if (item.isPending != null) {
        return item.isPending();
      } else {
        return lumine.workspace.getActivePane().getPendingItem() === item;
      }
    };

    describe("when tab's pane item is pending", () => {
      beforeEach(() => pane.destroyItems());

      describe("when opening a new tab", () =>
        it("adds tab with class 'temp'", async () => {
          editor1 = null;
          const o = await lumine.workspace.open("sample.txt", { pending: true });
          editor1 = o;

          pane.activateItem(editor1);
          expect(tabBar.element.querySelectorAll(".tab .temp").length).toBe(1);
          expect(tabBar.element.querySelectorAll(".tab")[0].querySelector(".title")).toHaveClass(
            "temp",
          );
        }));

      describe("when tabs:keep-pending-tab is triggered on the pane", () =>
        it("terminates pending state on the tab's item", async () => {
          editor1 = null;
          const o = await lumine.workspace.open("sample.txt", { pending: true });
          editor1 = o;

          pane.activateItem(editor1);
          expect(isPending(editor1)).toBe(true);
          lumine.commands.dispatch(
            lumine.workspace.getActivePane().getElement(),
            "tabs:keep-pending-tab",
          );
          expect(isPending(editor1)).toBe(false);
        }));

      describe("when there is a temp tab already", () => {
        it("it will replace an existing temporary tab", async () => {
          editor1 = null;
          let editor2 = null;

          const o = await lumine.workspace.open("sample.txt", { pending: true });
          editor1 = o;
          await lumine.workspace.open("sample2.txt", { pending: true }).then((o) => (editor2 = o));

          expect(editor1.isDestroyed()).toBe(true);
          expect(tabBar.tabForItem(editor1)).toBeUndefined();
          expect(tabBar.tabForItem(editor2).element.querySelector(".title")).toHaveClass("temp");
        });

        it("makes the tab permanent when double-clicking the tab", async () => {
          const o = await lumine.workspace.open("sample.txt", { pending: true });
          editor2 = o;

          pane.activateItem(editor2);
          expect(tabBar.tabForItem(editor2).element.querySelector(".title")).toHaveClass("temp");
          triggerMouseEvent("dblclick", tabBar.tabForItem(editor2).element, { button: 0 });
          expect(tabBar.tabForItem(editor2).element.querySelector(".title")).not.toHaveClass(
            "temp",
          );
        });
      });

      describe("when editing a file in pending state", () =>
        it("makes the item and tab permanent", async () => {
          editor1 = null;
          const o = await lumine.workspace.open("sample.txt", { pending: true });
          editor1 = o;
          pane.activateItem(editor1);
          editor1.insertText("x");
          await advanceClock(editor1.buffer.stoppedChangingDelay);

          expect(tabBar.tabForItem(editor1).element.querySelector(".title")).not.toHaveClass(
            "temp",
          );
        }));

      describe("when saving a file", () =>
        it("makes the tab permanent", async () => {
          editor1 = null;
          const o = await lumine.workspace.open(path.join(temp.mkdirSync("tabs-"), "sample.txt"), {
            pending: true,
          });
          editor1 = o;
          pane.activateItem(editor1);
          await editor1.save();

          expect(tabBar.tabForItem(editor1).element.querySelector(".title")).not.toHaveClass(
            "temp",
          );
        }));

      describe("when splitting a pending tab", () => {
        editor1 = null;
        beforeEach(async () => {
          const o = await lumine.workspace.open("sample.txt", { pending: true });
          editor1 = o;
        });

        it("makes the tab permanent in the new pane", () => {
          pane.activateItem(editor1);
          const pane2 = pane.splitRight({ copyActiveItem: true });
          const tabBar2 = new TabBarView(pane2, "center", tabTransferService);
          const newEditor = pane2.getActiveItem();
          expect(isPending(newEditor)).toBe(false);
          expect(tabBar2.tabForItem(newEditor).element.querySelector(".title")).not.toHaveClass(
            "temp",
          );
        });

        it("keeps the pending tab in the old pane", () => {
          expect(isPending(editor1)).toBe(true);
          expect(tabBar.tabForItem(editor1).element.querySelector(".title")).toHaveClass("temp");
        });
      });

      describe("when dragging a pending tab to a different pane", () =>
        it("makes the tab permanent in the other pane", async () => {
          editor1 = null;
          const o = await lumine.workspace.open("sample.txt", { pending: true });
          editor1 = o;

          pane.activateItem(editor1);
          const pane2 = pane.splitRight();

          const tabBar2 = new TabBarView(pane2, "center", tabTransferService);
          pane.moveItemToPane(editor1, pane2, 0);
          pane2.activateItem(editor1);

          expect(
            tabBar2.tabForItem(pane2.getActiveItem()).element.querySelector(".title"),
          ).not.toHaveClass("temp");
        }));
    });
  }

  describe("integration with version control systems", () => {
    let [repository, tab, tab1] = Array.from([]);

    beforeEach(async () => {
      tab = tabBar.tabForItem(editor1);
      spyOn(tab, "setupVcsStatus").and.callThrough();
      spyOn(tab, "updateVcsStatus").and.callThrough();

      tab1 = tabBar.tabForItem(item1);
      tab1.path = "/some/path/outside/the/repository";
      spyOn(tab1, "updateVcsStatus").and.callThrough();

      // Mock the repository
      repository = jasmine.createSpyObj("repo", ["isPathIgnoredCached", "getPathStatusSummary"]);
      repository.onDidChangeStatusSnapshot = function () {
        return { dispose() {} };
      };

      repository.onDidChangeStatus = function (callback) {
        if (this.changeStatusCallbacks == null) {
          this.changeStatusCallbacks = [];
        }
        this.changeStatusCallbacks.push(callback);
        return { dispose: () => _.remove(this.changeStatusCallbacks, callback) };
      };
      repository.emitDidChangeStatus = function (event) {
        return Array.from(this.changeStatusCallbacks != null ? this.changeStatusCallbacks : []).map(
          (callback) => callback(event),
        );
      };

      repository.onDidChangeStatuses = function (callback) {
        if (this.changeStatusesCallbacks == null) {
          this.changeStatusesCallbacks = [];
        }
        this.changeStatusesCallbacks.push(callback);
        return { dispose: () => _.remove(this.changeStatusesCallbacks, callback) };
      };
      repository.emitDidChangeStatuses = function (event) {
        return Array.from(
          this.changeStatusesCallbacks != null ? this.changeStatusesCallbacks : [],
        ).map((callback) => callback(event));
      };

      // Mock the repository registry to pretend we are working within a repository.
      spyOn(lumine.repositories, "resolveForPath").and.callFake((filePath) =>
        Promise.resolve(filePath === tab1.path ? null : repository),
      );

      // Re-resolve against the mocked registry (the tabs were constructed
      // against the real one).
      tab.setupVcsStatus();

      await conditionPromise(
        () =>
          (repository.changeStatusCallbacks != null
            ? repository.changeStatusCallbacks.length
            : undefined) > 0,
      );
    });

    describe("when working inside a VCS repository", () => {
      it("adds custom style for new items", () => {
        repository.getPathStatusSummary.and.returnValue({
          source: "cache",
          conflicted: false,
          modified: false,
          added: true,
        });
        tab.updateVcsStatus(repository);
        expect(tabBar.element.querySelectorAll(".tab")[1].querySelector(".title")).toHaveClass(
          "status-added",
        );
      });

      it("adds custom style for modified items", () => {
        repository.getPathStatusSummary.and.returnValue({
          source: "cache",
          conflicted: false,
          modified: true,
          added: false,
        });
        tab.updateVcsStatus(repository);
        expect(tabBar.element.querySelectorAll(".tab")[1].querySelector(".title")).toHaveClass(
          "status-modified",
        );
      });

      it("adds custom style for conflicted items", () => {
        repository.getPathStatusSummary.and.returnValue({
          source: "snapshot",
          conflicted: true,
          modified: false,
          added: false,
        });
        tab.updateVcsStatus(repository);
        expect(tabBar.element.querySelectorAll(".tab")[1].querySelector(".title")).toHaveClass(
          "status-conflicted",
        );
      });

      it("adds custom style for ignored items", () => {
        repository.isPathIgnoredCached.and.returnValue(true);
        tab.updateVcsStatus(repository);
        expect(tabBar.element.querySelectorAll(".tab")[1].querySelector(".title")).toHaveClass(
          "status-ignored",
        );
      });

      it("does not add any styles for items not in the repository", () => {
        expect(tabBar.element.querySelectorAll(".tab")[0].querySelector(".title")).not.toHaveClass(
          "status-added",
        );
        expect(tabBar.element.querySelectorAll(".tab")[0].querySelector(".title")).not.toHaveClass(
          "status-modified",
        );
        expect(tabBar.element.querySelectorAll(".tab")[0].querySelector(".title")).not.toHaveClass(
          "status-ignored",
        );
      });
    });

    describe("when changes in item statuses are notified", () => {
      it("updates status for items in the repository", () => {
        tab.updateVcsStatus.calls.reset();
        repository.emitDidChangeStatuses();
        expect(tab.updateVcsStatus.calls.count()).toEqual(1);
      });

      it("updates the status of an item if it has changed", () => {
        expect(tabBar.element.querySelectorAll(".tab")[1].querySelector(".title")).not.toHaveClass(
          "status-modified",
        );
        repository.getPathStatusSummary.and.returnValue({
          source: "cache",
          conflicted: false,
          modified: true,
          added: false,
        });
        repository.emitDidChangeStatus({ path: tab.path });
        expect(tabBar.element.querySelectorAll(".tab")[1].querySelector(".title")).toHaveClass(
          "status-modified",
        );
      });

      it("does not update status for items not in the repository", () => {
        tab1.updateVcsStatus.calls.reset();
        repository.emitDidChangeStatuses();
        expect(tab1.updateVcsStatus.calls.count()).toEqual(0);
      });
    });

    describe("when an item is saved", () => {
      it("does not update VCS subscription if the item's path remains the same", () => {
        tab.setupVcsStatus.calls.reset();
        tab.item.buffer.emitter.emit("did-save", { path: tab.path });
        expect(tab.setupVcsStatus.calls.count()).toBe(0);
      });

      it("updates VCS subscription if the item's path has changed", () => {
        tab.setupVcsStatus.calls.reset();
        tab.item.buffer.emitter.emit("did-save", { path: "/some/other/path" });
        expect(tab.setupVcsStatus.calls.count()).toBe(1);
      });
    });

    if (lumine.workspace.getLeftDock != null) {
      describe("a pane in the dock", () => {
        beforeEach(() => main.activate());
        afterEach(() => main.deactivate());
        it("gets decorated with tabs", () => {
          const dock = lumine.workspace.getLeftDock();
          const dockElement = dock.getElement();
          const item = new TestView("Dock Item 1");
          expect(dockElement.querySelectorAll(".tab").length).toBe(0);
          pane = dock.getActivePane();
          pane.activateItem(item);
          expect(dockElement.querySelectorAll(".tab").length).toBe(1);
          pane.destroyItem(item);
          expect(dockElement.querySelectorAll(".tab").length).toBe(0);
        });
      });
    }
  });
});
