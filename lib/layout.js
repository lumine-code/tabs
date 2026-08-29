module.exports = {
  activate() {
    this.view = document.createElement("div");
    lumine.workspace.getElement().appendChild(this.view);
    this.view.classList.add("tabs-layout-overlay");
    this.disableOnDragEnd = () => this.disableView();
    window.addEventListener("dragend", this.disableOnDragEnd, true);
  },

  deactivate() {
    window.removeEventListener("dragend", this.disableOnDragEnd, true);
    if (this.view?.parentElement) {
      this.view.parentElement.removeChild(this.view);
    }
    this.view = null;
  },

  test: {},

  resolvePane(pane, split) {
    switch (split) {
      case "left":
        return pane.splitLeft();
      case "right":
        return pane.splitRight();
      case "up":
        return pane.splitUp();
      case "down":
        return pane.splitDown();
      default:
        return pane;
    }
  },

  normalizeCoords({ left, top, width, height }, [x, y]) {
    return [(x - left) / width, (y - top) / height];
  },

  splitType([x, y]) {
    if (x < 1 / 3) {
      return "left";
    } else if (x > 2 / 3) {
      return "right";
    } else if (y < 1 / 3) {
      return "up";
    } else if (y > 2 / 3) {
      return "down";
    }
  },

  boundsForSplit(split) {
    switch (split) {
      case "left":
        return [0, 0, 0.5, 1];
      case "right":
        return [0.5, 0, 0.5, 1];
      case "up":
        return [0, 0, 1, 0.5];
      case "down":
        return [0, 0.5, 1, 0.5];
      default:
        return [0, 0, 1, 1];
    }
  },

  innerBounds({ left, top, width, height }, [x, y, w, h]) {
    left += x * width;
    top += y * height;
    width *= w;
    height *= h;
    return { left, top, width, height };
  },

  updateViewBounds({ left, top, width, height }) {
    this.view.style.left = `${left}px`;
    this.view.style.top = `${top}px`;
    this.view.style.width = `${width}px`;
    this.view.style.height = `${height}px`;
  },

  updateView(pane, coords) {
    if (!this.view) return;
    this.view.classList.add("visible");
    const rect = this.test.rect || pane.getBoundingClientRect();
    const split = coords ? this.splitType(this.normalizeCoords(rect, coords)) : undefined;
    this.updateViewBounds(this.innerBounds(rect, this.boundsForSplit(split)));
    return split;
  },

  disableView() {
    this.view?.classList.remove("visible");
  },
};
