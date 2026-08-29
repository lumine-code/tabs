const buildMouseEvent = (type, target, param) => {
  if (param == null) {
    param = {};
  }

  const event = new MouseEvent(type, { bubbles: true, cancelable: true });

  if (param?.button != null) {
    Object.defineProperty(event, "button", {
      get() {
        return param?.button;
      },
    });
  }
  if (param?.ctrlKey != null) {
    Object.defineProperty(event, "ctrlKey", {
      get() {
        return param?.ctrlKey;
      },
    });
  }
  if (param?.metaKey != null) {
    Object.defineProperty(event, "metaKey", {
      get() {
        return param.metaKey;
      },
    });
  }
  if (param?.which != null) {
    Object.defineProperty(event, "which", {
      get() {
        return param?.which;
      },
    });
  }
  if (param?.relatedTarget != null) {
    Object.defineProperty(event, "relatedTarget", {
      get() {
        return param?.relatedTarget;
      },
    });
  }
  for (const coordinate of ["clientX", "clientY", "pageX", "pageY"]) {
    if (param?.[coordinate] != null) {
      Object.defineProperty(event, coordinate, {
        get() {
          return param[coordinate];
        },
      });
    }
  }
  Object.defineProperty(event, "target", {
    get() {
      return target;
    },
  });
  Object.defineProperty(event, "srcObject", {
    get() {
      return target;
    },
  });
  spyOn(event, "preventDefault");
  return event;
};

module.exports.triggerMouseEvent = function (type, target, _param) {
  const event = buildMouseEvent(...arguments);
  target.dispatchEvent(event);
  return event;
};

module.exports.triggerClickEvent = function (target, options) {
  const events = {
    mousedown: buildMouseEvent("mousedown", target, options),
    mouseup: buildMouseEvent("mouseup", target, options),
    click: buildMouseEvent("click", target, options),
  };

  target.dispatchEvent(events.mousedown);
  target.dispatchEvent(events.mouseup);
  target.dispatchEvent(events.click);

  return events;
};

module.exports.buildDragEvents = function (dragged, dropTarget) {
  const dataTransfer = {
    data: {},
    files: [],
    nativeItems: [],
    effectAllowed: "uninitialized",
    dropEffect: "none",
    setData(key, value) {
      return (this.data[key] = `${value}`);
    }, // Drag events stringify data values
    getData(key) {
      return this.data[key];
    },
    clearData(key) {
      if (key) delete this.data[key];
      else this.data = {};
    },
    setDragImage() {},
  };

  Object.defineProperty(dataTransfer, "items", {
    get() {
      return dataTransfer.nativeItems.concat(
        Object.keys(dataTransfer.data).map((key) => ({ kind: "string", type: key })),
      );
    },
  });

  const dragStartEvent = module.exports.buildDragEvent("dragstart", dragged, dataTransfer);
  const dropEvent = module.exports.buildDragEvent("drop", dropTarget, dataTransfer);

  return [dragStartEvent, dropEvent];
};

module.exports.buildDragEvent = function (type, target, dataTransfer, options) {
  const event = buildMouseEvent(type, target, options);
  Object.defineProperty(event, "dataTransfer", {
    get() {
      return dataTransfer;
    },
  });
  return event;
};

module.exports.buildWheelEvent = (delta) => new WheelEvent("mousewheel", { wheelDeltaY: delta });

module.exports.buildWheelPlusShiftEvent = (delta) =>
  new WheelEvent("mousewheel", { wheelDeltaY: delta, shiftKey: true });

module.exports.buildDragEnterLeaveEvents = (enterRelatedTarget, leaveRelatedTarget) => {
  const dataTransfer = {
    data: {},
    setData(key, value) {
      this.data[key] = `${value}`; // Drag events stringify data values
    },
    getData(key) {
      return this.data[key];
    },
    clearData(key) {
      if (key) {
        delete this.data[key];
      } else {
        this.data = {};
      }
    },
  };

  Object.defineProperty(dataTransfer, "items", {
    get() {
      return Object.keys(dataTransfer.data).map((key) => ({ type: key }));
    },
  });

  const dragEnterEvent = buildMouseEvent("dragenter", null, { relatedTarget: enterRelatedTarget });
  Object.defineProperty(dragEnterEvent, "dataTransfer", {
    get() {
      return dataTransfer;
    },
  });
  dragEnterEvent.dataTransfer.setData("lumine-tab-event", "true");

  const dragLeaveEvent = buildMouseEvent("dragleave", null, { relatedTarget: leaveRelatedTarget });
  Object.defineProperty(dragLeaveEvent, "dataTransfer", {
    get() {
      return dataTransfer;
    },
  });
  dragLeaveEvent.dataTransfer.setData("lumine-tab-event", "true");

  return [dragEnterEvent, dragLeaveEvent];
};
