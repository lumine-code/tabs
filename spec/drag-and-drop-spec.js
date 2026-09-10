const path = require("path");
const temp = require("@lumine-code/temp");
const { buildDragEvent, buildDragEvents } = require("./event-helpers.js");

describe("Tabs workspace drag-and-drop integration", () => {
  let directory, firstPath, secondPath, firstItem, secondItem, pane, paneElement;

  const tabForItem = (item) =>
    Array.from(paneElement.querySelectorAll(":scope > .tab-bar > .tab")).find(
      (tab) => tab.item === item,
    );

  const dispatchDrag = (source, target, { x = 50, y = 50, pageX = x } = {}) => {
    const [dragStart] = buildDragEvents(source, target);
    source.dispatchEvent(dragStart);
    expect(lumine.workspaceDrops.inspect(dragStart.dataTransfer)?.kind).toBe("pane-item");
    const dragOver = buildDragEvent("dragover", target, dragStart.dataTransfer, {
      clientX: x,
      clientY: y,
      pageX,
    });
    const drop = buildDragEvent("drop", target, dragStart.dataTransfer, {
      clientX: x,
      clientY: y,
      pageX,
    });
    target.dispatchEvent(dragOver);
    target.dispatchEvent(drop);
    return { dragStart, dragOver, drop };
  };

  beforeEach(async () => {
    directory = temp.mkdirSync("tabs-dnd-integration-");
    firstPath = path.join(directory, "first.txt");
    secondPath = path.join(directory, "second.txt");
    firstItem = await lumine.workspace.open(firstPath);
    secondItem = await lumine.workspace.open(secondPath);
    pane = lumine.workspace.getActivePane();
    paneElement = pane.getElement();
    await lumine.packages.activatePackage("tabs");
    jasmine.attachToDOM(lumine.workspace.getElement());
  });

  afterEach(async () => {
    await Promise.resolve(lumine.packages.deactivatePackage("tabs"));
    lumine.workspaceDrops.clearActiveClaim();
  });

  it("reorders a tab through the registered tab-bar target", async () => {
    const source = tabForItem(firstItem);
    const target = tabForItem(secondItem);
    spyOn(target, "getBoundingClientRect").and.returnValue({ left: 100, width: 100 });

    const events = dispatchDrag(source, target, { x: 190, y: 10, pageX: 190 });
    expect(events.dragOver.defaultPrevented).toBe(true);
    await conditionPromise(() => pane.getItems()[1] === firstItem);

    expect(events.dragOver.defaultPrevented).toBe(true);
    expect(events.dragOver.dataTransfer.dropEffect).toBe("move");
    expect(pane.getItems()).toEqual([secondItem, firstItem]);
    expect(pane.getActiveItem()).toBe(firstItem);
  });

  it("writes the text editor selections and scroll position into the transfer", () => {
    firstItem.setText("first line\nsecond line\nthird line");
    firstItem.setSelectedBufferRange(
      [
        [0, 1],
        [0, 5],
      ],
      { reversed: true },
    );
    firstItem.addSelectionForBufferRange([
      [2, 3],
      [2, 3],
    ]);
    spyOn(firstItem, "getScrollTopRow").and.returnValue(12);
    spyOn(firstItem, "getScrollLeftColumn").and.returnValue(7);
    spyOn(firstItem.getElement().component, "captureScrollAnchor").and.returnValue({
      type: "row",
      bufferPosition: [2, 3],
      offset: -4.5,
    });

    const source = tabForItem(firstItem);
    const [dragStart] = buildDragEvents(source, source);
    source.dispatchEvent(dragStart);
    const descriptor = lumine.workspaceDrops.read(dragStart.dataTransfer);

    expect(descriptor.items[0].textEditorState).toEqual(
      jasmine.objectContaining({
        selections: [
          {
            range: [
              [0, 1],
              [0, 5],
            ],
            reversed: true,
          },
          {
            range: [
              [2, 3],
              [2, 3],
            ],
            reversed: false,
          },
        ],
        scrollTopRow: 12,
        scrollLeftColumn: 7,
        scrollAnchor: {
          type: "row",
          bufferPosition: [2, 3],
          offset: -4.5,
        },
      }),
    );
  });

  it("moves a tab into the split selected by the core pane target", async () => {
    const source = tabForItem(firstItem);
    const itemViews = paneElement.querySelector(":scope > .item-views");
    spyOn(itemViews, "getBoundingClientRect").and.returnValue({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
    });

    const events = dispatchDrag(source, itemViews, { x: 80, y: 50 });
    await conditionPromise(() => lumine.workspace.getCenter().getPanes().length === 2);
    const targetPane = lumine.workspace.getActivePane();

    expect(events.dragOver.defaultPrevented).toBe(true);
    expect(targetPane).not.toBe(pane);
    expect(targetPane.getItems()).toEqual([firstItem]);
    expect(pane.getItems()).toEqual([secondItem]);
  });

  it("leaves tab order unchanged when a tab is dropped on its current pane center", async () => {
    const source = tabForItem(firstItem);
    const itemViews = paneElement.querySelector(":scope > .item-views");
    spyOn(itemViews, "getBoundingClientRect").and.returnValue({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
    });

    dispatchDrag(source, itemViews, { x: 50, y: 50 });
    await conditionPromise(() => lumine.workspaceDrops.activeClaim == null);

    expect(pane.getItems()).toEqual([firstItem, secondItem]);
    expect(pane.getActiveItem()).toBe(secondItem);
    expect(lumine.workspace.getCenter().getPanes().length).toBe(1);
  });

  it("opens tree-view files at the tab-bar insertion index", async () => {
    const target = tabForItem(secondItem);
    spyOn(target, "getBoundingClientRect").and.returnValue({ left: 100, width: 100 });
    const thirdPath = path.join(directory, "third.txt");
    const fourthPath = path.join(directory, "fourth.txt");
    const [, drop] = buildDragEvents(document.createElement("div"), target);
    lumine.workspaceDrops.write(drop.dataTransfer, {
      kind: "tree-entries",
      effect: "copyMove",
      allowedLocations: ["center"],
      source: { windowId: lumine.window.getId() + 1 },
      items: [
        { type: "file", path: thirdPath },
        { type: "file", path: fourthPath },
      ],
    });
    const dragOver = buildDragEvent("dragover", target, drop.dataTransfer, {
      clientX: 110,
      clientY: 10,
      pageX: 110,
    });

    target.dispatchEvent(dragOver);
    expect(paneElement.querySelector(".tab-bar .placeholder")).not.toBeNull();
    target.dispatchEvent(drop);
    await conditionPromise(() => pane.getItems().length === 4);

    expect(pane.getItems().map((item) => item.getPath())).toEqual([
      firstPath,
      thirdPath,
      fourthPath,
      secondPath,
    ]);
    expect(pane.getActiveItem().getPath()).toBe(fourthPath);
  });
});
