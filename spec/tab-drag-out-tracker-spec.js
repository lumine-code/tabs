const TabDragOutTracker = require("../lib/tab-drag-out-tracker");

describe("TabDragOutTracker", () => {
  const bounds = { left: 100, right: 500, top: 100, bottom: 400 };
  const event = (x, y, { type = "drag", dropEffect = "none" } = {}) => ({
    type,
    clientX: x,
    clientY: y,
    screenX: x,
    screenY: y,
    dataTransfer: { dropEffect },
  });

  let tracker;

  beforeEach(() => {
    tracker = new TabDragOutTracker({ detachThreshold: 32, reentryDistance: 12 });
    tracker.start();
  });

  it("arms only after the pointer clears the detach threshold", () => {
    expect(tracker.update(event(520, 200), bounds)).toBe(false);
    expect(tracker.update(event(533, 200), bounds)).toBe(true);
  });

  it("uses hysteresis before disarming after re-entry", () => {
    tracker.update(event(533, 200), bounds);

    expect(tracker.update(event(505, 200), bounds)).toBe(true);
    expect(tracker.update(event(105, 200), bounds)).toBe(true);
    expect(tracker.update(event(112, 200), bounds)).toBe(false);
  });

  it("detaches only an armed drag that ended without an accepted drop", () => {
    tracker.update(event(533, 200), bounds);

    expect(tracker.finish(event(533, 200, { type: "dragend" }), bounds)).toBe(true);
  });

  it("does not detach when another drop target accepted the drag", () => {
    tracker.update(event(533, 200), bounds);

    expect(tracker.finish(event(533, 200, { type: "dragend", dropEffect: "move" }), bounds)).toBe(
      false,
    );
  });

  it("rolls an Escape-cancelled drag back even after it was armed", () => {
    tracker.update(event(533, 200), bounds);
    tracker.cancel();

    expect(tracker.finish(event(533, 200, { type: "dragend" }), bounds)).toBe(false);
  });

  it("keeps the last valid position when Chromium reports a zeroed dragend", () => {
    tracker.update(event(533, 200), bounds);
    const dragEnd = event(0, 0, { type: "dragend" });
    dragEnd.screenX = 0;
    dragEnd.screenY = 0;

    expect(tracker.finish(dragEnd, bounds)).toBe(true);
  });

  it("retains the native screen position for placing the detached window", () => {
    const moved = event(533, 200);
    moved.screenX = 900;
    moved.screenY = 450;
    tracker.update(moved, bounds);

    expect(tracker.getScreenPoint()).toEqual({ x: 900, y: 450 });
  });
});
