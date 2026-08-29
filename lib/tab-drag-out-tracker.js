const DEFAULT_DETACH_THRESHOLD = 32;
const DEFAULT_REENTRY_DISTANCE = 12;

module.exports = class TabDragOutTracker {
  constructor({
    detachThreshold = DEFAULT_DETACH_THRESHOLD,
    reentryDistance = DEFAULT_REENTRY_DISTANCE,
  } = {}) {
    this.detachThreshold = detachThreshold;
    this.reentryDistance = reentryDistance;
    this.reset();
  }

  start() {
    this.active = true;
    this.armed = false;
    this.cancelled = false;
    this.lastScreenPoint = null;
  }

  update(event, bounds, domWindow) {
    if (!this.active || this.cancelled) return false;
    const point = pointForEvent(event, domWindow);
    const screenPoint = screenPointForEvent(event);
    if (screenPoint) this.lastScreenPoint = screenPoint;
    if (!point || !validBounds(bounds)) return this.armed;

    if (this.armed) {
      if (distanceInside(bounds, point) >= this.reentryDistance) this.armed = false;
    } else if (distanceOutside(bounds, point) >= this.detachThreshold) {
      this.armed = true;
    }
    return this.armed;
  }

  cancel() {
    if (this.active) this.cancelled = true;
  }

  finish(event, bounds, domWindow) {
    this.update(event, bounds, domWindow);
    const shouldDetach =
      this.active && !this.cancelled && this.armed && event?.dataTransfer?.dropEffect === "none";
    this.reset();
    return shouldDetach;
  }

  getScreenPoint() {
    return this.lastScreenPoint ? { ...this.lastScreenPoint } : null;
  }

  reset() {
    this.active = false;
    this.armed = false;
    this.cancelled = false;
    this.lastScreenPoint = null;
  }
};

function screenPointForEvent(event) {
  const x = Number(event?.screenX);
  const y = Number(event?.screenY);
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    (event?.type === "dragend" && x === 0 && y === 0)
  ) {
    return null;
  }
  return { x, y };
}

function pointForEvent(event, domWindow) {
  if (!event) return null;
  const clientX = Number(event.clientX);
  const clientY = Number(event.clientY);
  const screenX = Number(event.screenX);
  const screenY = Number(event.screenY);
  const dragEndSentinel =
    event.type === "dragend" &&
    clientX === 0 &&
    clientY === 0 &&
    (!Number.isFinite(screenX) || screenX === 0) &&
    (!Number.isFinite(screenY) || screenY === 0);
  if (dragEndSentinel) return null;
  if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
    return { x: clientX, y: clientY };
  }
  if (
    Number.isFinite(screenX) &&
    Number.isFinite(screenY) &&
    domWindow &&
    Number.isFinite(domWindow.screenX) &&
    Number.isFinite(domWindow.screenY)
  ) {
    return { x: screenX - domWindow.screenX, y: screenY - domWindow.screenY };
  }
  return null;
}

function validBounds(bounds) {
  return (
    bounds &&
    Number.isFinite(bounds.left) &&
    Number.isFinite(bounds.right) &&
    Number.isFinite(bounds.top) &&
    Number.isFinite(bounds.bottom)
  );
}

function distanceOutside(bounds, point) {
  return Math.max(
    bounds.left - point.x,
    point.x - bounds.right,
    bounds.top - point.y,
    point.y - bounds.bottom,
    0,
  );
}

function distanceInside(bounds, point) {
  if (
    point.x < bounds.left ||
    point.x > bounds.right ||
    point.y < bounds.top ||
    point.y > bounds.bottom
  ) {
    return 0;
  }
  return Math.min(
    point.x - bounds.left,
    bounds.right - point.x,
    point.y - bounds.top,
    bounds.bottom - point.y,
  );
}
