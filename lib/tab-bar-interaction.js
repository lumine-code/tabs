const { CompositeDisposable, Disposable } = require("lumine");
const { pathToFileURL } = require("node:url");

class TabBarInteraction {
  constructor(bar, transferScope) {
    this.bar = bar;
    this.transferScope = transferScope;
    this.subscriptions = new CompositeDisposable();
    this.wheelDelta = 0;
    this.dropIndex = null;
    const listen = (name, handler, options) => {
      const callback = handler.bind(this);
      bar.element.addEventListener(name, callback, options);
      this.subscriptions.add(
        new Disposable(() => bar.element.removeEventListener(name, callback, options)),
      );
    };
    listen("mouseenter", () => bar.layout.lockWidths());
    listen("mouseleave", () => bar.layout.resetWidths());
    listen("wheel", this.onWheel, { passive: true });
    listen("mousedown", this.onMouseDown);
    listen("click", this.onClick);
    listen("auxclick", this.onClick);
    listen("dblclick", this.onDoubleClick);
    listen("dragstart", this.onDragStart);
    listen("dragend", this.onDragEnd);
    listen("dragleave", (event) => {
      if (!bar.element.contains(event.relatedTarget)) bar.layout.resetWidths();
    });
    this.subscriptions.add(
      lumine.config.observe("tabs.tabScrolling", (value) => {
        this.scrolling = value === "platform" ? process.platform === "linux" : value;
      }),
      lumine.config.observe("tabs.tabScrollingThreshold", (value) => {
        this.scrollingThreshold = Math.max(1, value);
      }),
      lumine.workspaceDrops.addTarget(
        bar.element,
        {
          surface: "tab-bar",
          getPane: () => bar.pane,
          dropElement: bar.element,
          getIndex: (event) => this.getDropIndex(event),
          onDragEnter: (context) => this.updateDropTarget(context),
          onDragOver: (context) => this.updateDropTarget(context),
          onDragLeave: () => this.clearInsertionTarget(),
          onDropFinished: () => this.clearInsertionTarget(),
        },
        { priority: 100 },
      ),
    );
  }

  onMouseDown(event) {
    const { bar } = this;
    const tab = bar.tabForElement(event.target);
    const context = event.button === 2 || (event.button === 0 && event.ctrlKey);
    if (!bar.pane.isDestroyed()) {
      // Select before focus publishes the pane, so observers see only the
      // chosen item rather than its previously selected item first.
      if (tab && event.button === 0 && !context && !event.target.closest(".close-icon")) {
        bar.pane.activateItem(tab.item, { activatePane: true });
      } else {
        bar.pane.activate();
      }
    }
    if (context) {
      bar.layout.resetWidths();
      this.setContextTab(tab);
    }
    if (tab && (context || event.button === 1)) event.preventDefault();
  }

  onClick(event) {
    const { bar } = this;
    const tab = bar.tabForElement(event.target);
    if (!tab) return;
    event.preventDefault();
    if (event.button === 2 || (event.button === 0 && event.ctrlKey)) return;
    if (event.button === 0 && !event.target.closest(".close-icon")) {
      bar.pane.activateItem(tab.item);
      // Chromium may focus the draggable bar after mousedown, including
      // when its selected item did not change and emitted no focus event.
      bar.paneElement.focus();
    } else if (event.button === 1) {
      void bar.closeTab(tab);
    }
  }

  onDoubleClick(event) {
    const tab = this.bar.tabForElement(event.target);
    if (tab) tab.terminatePendingState();
    else if (event.target === this.bar.element) {
      lumine.commands.dispatch(this.bar.element, "application:new-file");
      event.preventDefault();
    }
  }

  onWheel(event) {
    if (event.shiftKey || !this.scrolling) return;
    const scale =
      event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? this.bar.element.clientHeight : 1;
    this.wheelDelta += event.deltaY * scale;
    if (this.wheelDelta >= this.scrollingThreshold) {
      this.wheelDelta = 0;
      this.bar.pane.activateNextItem();
    } else if (this.wheelDelta <= -this.scrollingThreshold) {
      this.wheelDelta = 0;
      this.bar.pane.activatePreviousItem();
    }
  }

  setContextTab(tab) {
    this.contextTab?.element.classList.remove("right-clicked");
    this.contextTab = tab;
    tab?.element.classList.add("right-clicked");
  }

  onDragStart(event) {
    const tab = this.bar.tabForElement(event.target);
    if (!tab) return;
    const descriptor = this.transferScope.createTransfer(this.bar.pane, tab.item);
    this.draggedTab = tab;
    this.dropIndex = null;
    tab.element.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    const uri = descriptor.items[0].uri;
    if (uri != null) {
      event.dataTransfer.setData("text/plain", uri);
      if (process.platform === "darwin") {
        let externalURI;
        try {
          externalURI = new URL(uri).href;
        } catch {
          externalURI = pathToFileURL(uri).href;
        }
        event.dataTransfer.setData("text/uri-list", externalURI);
      }
    }
    lumine.workspaceDrops.write(event.dataTransfer, descriptor);
  }

  onDragEnd() {
    // Core's session TTL handles abandoned drags; dragend can arrive before
    // a destination window acknowledges a successful transfer.
    this.bar.layout.resetWidths();
    this.draggedTab?.element.classList.remove("is-dragging");
    this.draggedTab = null;
    this.clearInsertionTarget();
  }

  removeTab(tab) {
    if (tab === this.draggedTab) this.onDragEnd();
    if (tab === this.contextTab) this.setContextTab(undefined);
  }

  updateDropTarget({ offer, native, event }) {
    if (
      offer.kind !== "pane-item" &&
      !((offer.kind === "paths" || offer.kind === "tree-entries") && offer.files) &&
      !(offer.native && (!native.known || native.hasFiles))
    ) {
      this.clearInsertionTarget();
      return;
    }
    const index = this.getDropIndex(event);
    if (index == null || index === this.dropIndex) return;
    this.clearInsertionTarget();
    this.dropIndex = index;
    this.placeholder = document.createElement("li");
    this.placeholder.classList.add("placeholder");
    const next = this.bar.tabs[index];
    const previous = this.bar.tabs[index - 1];
    next?.element.classList.add("is-drop-target");
    if (!next) previous?.element.classList.add("drop-target-is-after");
    this.bar.element.insertBefore(this.placeholder, next?.element ?? null);
  }

  getDropIndex(event) {
    if (event.target === this.placeholder) return;
    const tab = this.bar.tabForElement(event.target) ?? this.bar.tabs.at(-1);
    if (!tab) return 0;
    const { left, width } = tab.element.getBoundingClientRect();
    return this.bar.tabs.indexOf(tab) + (event.clientX < left + width / 2 ? 0 : 1);
  }

  clearInsertionTarget() {
    this.dropIndex = null;
    for (const tab of this.bar.tabs) {
      tab.element.classList.remove("is-drop-target", "drop-target-is-after");
    }
    this.placeholder?.remove();
    this.placeholder = null;
  }

  dispose() {
    this.subscriptions.dispose();
    this.onDragEnd();
    this.setContextTab(undefined);
  }
}

module.exports = TabBarInteraction;
