class TabBarLayout {
  constructor(bar) {
    this.bar = bar;
    this.frame = null;
    this.disposed = false;
    this.bindWindow();
  }

  bindWindow() {
    if (this.frame != null) this.window.cancelAnimationFrame(this.frame);
    this.frame = null;
    this.resizeObserver?.disconnect();
    this.window = this.bar.element.ownerDocument.defaultView;
    this.resizeObserver = new this.window.ResizeObserver(() => this.scheduleOccupancyUpdate());
    this.resizeObserver.observe(this.bar.element);
    for (const tab of this.bar.tabs) this.resizeObserver.observe(tab.element);
    this.scheduleOccupancyUpdate();
  }

  observe(tab) {
    this.resizeObserver.observe(tab.element);
    this.scheduleOccupancyUpdate();
  }

  unobserve(tab) {
    this.resizeObserver.unobserve(tab.element);
    this.scheduleOccupancyUpdate();
  }

  scheduleOccupancyUpdate() {
    if (this.disposed || this.frame != null) return;
    this.frame = this.window.requestAnimationFrame(() => {
      this.frame = null;
      this.updateOccupancy();
    });
  }

  updateOccupancy() {
    const lastTab = this.bar.tabs.at(-1)?.element;
    let occupied = false;
    if (lastTab) {
      const barRect = this.bar.element.getBoundingClientRect();
      const tabRect = lastTab.getBoundingClientRect();
      const margin = Number.parseFloat(this.window.getComputedStyle(lastTab).marginRight) || 0;
      occupied = barRect.width > 0 && tabRect.right + margin >= barRect.right - 1;
    }
    this.bar.element.classList.toggle("is-fully-occupied", occupied);
    return occupied;
  }

  lockWidths() {
    const widths = this.bar.tabs.map((tab) => tab.element.getBoundingClientRect().width);
    this.bar.tabs.forEach((tab, index) => {
      tab.element.style.maxWidth = `${widths[index].toFixed(2)}px`;
    });
  }

  resetWidths() {
    for (const tab of this.bar.tabs) tab.element.style.maxWidth = "";
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.frame != null) this.window.cancelAnimationFrame(this.frame);
    this.frame = null;
    this.resizeObserver.disconnect();
    this.resetWidths();
  }
}

module.exports = TabBarLayout;
