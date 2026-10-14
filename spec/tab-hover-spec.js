const path = require("node:path");

describe("tab hover recovery", () => {
  let main, pane, bar, first, second;

  function arrange(targetBar, top = 40) {
    Object.assign(targetBar.element.style, {
      position: "fixed",
      left: "20px",
      top: `${top}px`,
      width: "400px",
      height: "32px",
      zIndex: "100000",
      display: "flex",
    });
    for (const tab of targetBar.tabs) {
      Object.assign(tab.element.style, {
        flex: "none",
        margin: "0",
        minWidth: "0",
        maxWidth: "none",
        width: "150px",
        height: "32px",
      });
    }
  }

  function moveTo(tab, target = tab.element.ownerDocument.body) {
    const { left, top, width, height } = tab.element.getBoundingClientRect();
    const clientX = left + width / 2;
    const clientY = top + height / 2;
    const document = tab.element.ownerDocument;
    expect(document.elementFromPoint(clientX, clientY)?.closest(".tab")).toBe(tab.element);
    const event = new document.defaultView.MouseEvent("mousemove", {
      bubbles: true,
      clientX,
      clientY,
    });
    target.dispatchEvent(event);
  }

  beforeEach(async () => {
    jasmine.useRealClock();
    const workspace = lumine.workspace.getElement();
    workspace.style.width = "800px";
    workspace.style.height = "400px";
    jasmine.attachToDOM(workspace);
    if (lumine.packages.isPackageLoaded("tabs")) await lumine.packages.unloadPackage("tabs");
    main = (await lumine.packages.activatePackage(path.join(__dirname, ".."))).mainModule;
    const firstItem = await lumine.workspace.open();
    pane = lumine.workspace.paneForItem(firstItem);
    const secondItem = lumine.workspace.buildTextEditor();
    pane.addItem(secondItem);
    bar = main.tabBarViews.get(pane);
    first = bar.tabForItem(firstItem);
    second = bar.tabForItem(secondItem);
    arrange(bar);
    // Emulate the missing native pseudo-class independently of event routing.
    spyOn(first.element, "matches").and.returnValue(false);
    spyOn(second.element, "matches").and.returnValue(false);
  });

  afterEach(async () => {
    await lumine.workspace.discardEditorWindows();
    if (lumine.packages.isPackageLoaded("tabs")) await lumine.packages.unloadPackage("tabs");
  });

  it("uses the real pointer position even when capture retargets movement elsewhere", () => {
    const focus = document.activeElement;
    const clicked = jasmine.createSpy("click");
    first.element.addEventListener("click", clicked);
    moveTo(first, document.body);
    expect(first.element.classList.contains("is-hovered")).toBeTrue();
    expect(second.element.classList.contains("is-hovered")).toBeFalse();
    expect(document.activeElement).toBe(focus);
    expect(clicked).not.toHaveBeenCalled();

    moveTo(second, first.itemTitle);
    expect(first.element.classList.contains("is-hovered")).toBeFalse();
    expect(second.element.classList.contains("is-hovered")).toBeTrue();
  });

  it("clears the fallback when native hover recovers or the pointer leaves every tab", () => {
    moveTo(first);
    first.element.matches.and.returnValue(true);
    moveTo(first);
    expect(first.element.classList.contains("is-hovered")).toBeFalse();
    first.element.matches.and.returnValue(false);
    moveTo(first);
    document.body.dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, clientX: -1, clientY: -1 }),
    );
    expect(first.element.classList.contains("is-hovered")).toBeFalse();
  });

  it("clears on document exit, window blur and drag start without altering focus", () => {
    moveTo(first);
    document.body.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: null }));
    expect(first.element.classList.contains("is-hovered")).toBeFalse();
    moveTo(first);
    window.dispatchEvent(new Event("blur"));
    expect(first.element.classList.contains("is-hovered")).toBeFalse();
    moveTo(first);
    document.body.dispatchEvent(new Event("dragstart", { bubbles: true }));
    expect(first.element.classList.contains("is-hovered")).toBeFalse();
  });

  it("clears a removed tab and a completed drag before the next movement", () => {
    moveTo(first);
    pane.removeItem(first.item);
    expect(first.element.classList.contains("is-hovered")).toBeFalse();
    moveTo(second);
    bar.interaction.onDragEnd();
    expect(second.element.classList.contains("is-hovered")).toBeFalse();
  });

  it("shares one tracker between bars and removes its listeners after the last bar closes", async () => {
    const otherItem = lumine.workspace.buildTextEditor();
    const otherPane = pane.splitRight({ items: [otherItem] });
    const otherBar = main.tabBarViews.get(otherPane);
    arrange(otherBar, 100);
    const otherTab = otherBar.tabForItem(otherItem);
    spyOn(otherTab.element, "matches").and.returnValue(false);
    const tracker = bar.hoverTracker;
    expect(otherBar.hoverTracker).toBe(tracker);
    moveTo(first);
    moveTo(otherTab);
    expect(first.element.classList.contains("is-hovered")).toBeFalse();
    expect(otherTab.element.classList.contains("is-hovered")).toBeTrue();
    const removeDocumentListener = spyOn(document, "removeEventListener").and.callThrough();
    const removeWindowListener = spyOn(window, "removeEventListener").and.callThrough();
    otherPane.destroy();
    expect(otherTab.element.classList.contains("is-hovered")).toBeFalse();
    expect(removeDocumentListener).not.toHaveBeenCalledWith("mousemove", tracker.onMouseMove, true);
    await lumine.packages.unloadPackage("tabs");
    expect(removeDocumentListener).toHaveBeenCalledWith("mousemove", tracker.onMouseMove, true);
    expect(removeDocumentListener).toHaveBeenCalledWith("mouseout", tracker.onMouseOut, true);
    expect(removeDocumentListener).toHaveBeenCalledWith("dragstart", tracker.clear, true);
    expect(removeWindowListener).toHaveBeenCalledWith("blur", tracker.clear);
  });

  it("moves tracking to the pane's document when its window changes", async () => {
    const sourceTracker = bar.hoverTracker;
    moveTo(first);
    const extra = await lumine.workspace.detachPane(pane);
    expect(first.element.classList.contains("is-hovered")).toBeFalse();
    expect(bar.hoverTracker).not.toBe(sourceTracker);
    expect(bar.hoverTracker.document).toBe(extra.getDocument());
    arrange(bar);
    moveTo(first);
    expect(first.element.classList.contains("is-hovered")).toBeTrue();
    window.dispatchEvent(new Event("blur"));
    expect(first.element.classList.contains("is-hovered")).toBeTrue();
    extra.getDOMWindow().dispatchEvent(new (extra.getDOMWindow().Event)("blur"));
    expect(first.element.classList.contains("is-hovered")).toBeFalse();
    await lumine.workspace.attachWindow(extra);
    expect(bar.hoverTracker.document).toBe(document);
    arrange(bar);
    moveTo(first);
    expect(first.element.classList.contains("is-hovered")).toBeTrue();
  });
});
