const path = require("path");
const { Disposable, Emitter, Icon } = require("lumine");

describe("tab icons", () => {
  let tab;

  beforeEach(async () => {
    await lumine.workspace.open(path.join(__dirname, "fixtures", "sample.js"));

    await lumine.packages.activatePackage("tabs");

    // The registry only repaints elements that are in the document, as they
    // are in a real window.
    jasmine.attachToDOM(lumine.workspace.getElement());
    tab = lumine.workspace.getElement().querySelector(".tab");
  });

  const provide = (iconFor, extra = {}) =>
    lumine.packages.serviceHub.provide("icons.provider", "1.0.0", { iconFor, ...extra });

  const tabFor = (item) => {
    const tabs = lumine.workspace.getElement().querySelectorAll(".tab");
    return Array.from(tabs).find((candidate) => candidate.item === item);
  };

  const addItem = (item) => {
    const pane = lumine.workspace.getActivePane();
    pane.addItem(item);
    pane.activateItem(item);
    return tabFor(item);
  };

  // A tab carries the editor's own file-type icon with no icon package
  // installed, and `tabs.showIcons` decides whether it is shown.
  it("falls back to the built-in file icon", () => {
    expect(tab.itemTitle.className).toBe("title icon icon-file-text");
  });

  it("takes an icon from a provider, and gives it back", () => {
    const disposable = provide(() => Icon.classes(["foo", "bar"]));
    expect(tab.itemTitle.className).toBe("title icon foo bar");

    disposable.dispose();
    expect(tab.itemTitle.className).toBe("title icon icon-file-text");
  });

  it("hides the icon rather than dropping it when showIcons is off", () => {
    lumine.config.set("tabs.showIcons", false);
    expect(tab.itemTitle.classList.contains("hide-icon")).toBe(true);
    expect(tab.itemTitle.classList.contains("icon-file-text")).toBe(true);
  });

  it("accepts a class descriptor", () => {
    provide(() => Icon.classes(["foo", "bar"]));
    expect(tab.itemTitle.className).toBe("title icon foo bar");
  });

  it("repaints when a provider reports its answers changed", () => {
    let notify;
    let classes = "first";
    const disposable = provide(() => Icon.classes([classes]), {
      onDidChange(callback) {
        notify = callback;
        return new Disposable(() => (notify = null));
      },
    });
    expect(tab.itemTitle.className).toBe("title icon first");

    classes = "second";
    notify();
    expect(tab.itemTitle.className).toBe("title icon second");

    disposable.dispose();
    expect(notify).toBe(null);
  });

  // No provider stylesheet, no !important, no per-extension generated rules:
  // the data URL rides on the element itself.
  it("renders an image icon", () => {
    provide(() => Icon.image("data:image/png;base64,AAAA"));
    expect(tab.itemTitle.classList.contains("icon-image")).toBe(true);
    expect(tab.itemTitle.style.getPropertyValue("--icon-image")).toBe(
      'url("data:image/png;base64,AAAA")',
    );
  });

  describe("an item that names its own icon", () => {
    let item;
    let namedTab;

    beforeEach(() => {
      item = {
        element: document.createElement("div"),
        getElement() {
          return this.element;
        },
        getTitle: () => "Named",
        getIconName: () => "tools",
      };
      namedTab = addItem(item);
    });

    it("uses the name rather than any path icon", () => {
      expect(namedTab.itemTitle.classList.contains("icon-tools")).toBe(true);
    });

    // `getIconName()` is a target like any other now, so a provider can restyle
    // it — it is no longer a hard short circuit ahead of the chain.
    it("can still be overridden by a provider", () => {
      provide((target) => (target.type === "name" ? Icon.classes(["named"]) : null));
      expect(namedTab.itemTitle.classList.contains("named")).toBe(true);
    });
  });

  it("follows an item's icon changes through the live registry binding", () => {
    const emitter = new Emitter();
    let iconName = "tools";
    const item = {
      element: document.createElement("div"),
      getElement() {
        return this.element;
      },
      getTitle: () => "Dynamic icon",
      getIconName: () => iconName,
      onDidChangeIcon: (callback) => emitter.on("icon", callback),
    };
    const dynamicTab = addItem(item);
    expect(dynamicTab.itemTitle.classList.contains("icon-tools")).toBe(true);

    iconName = "flame";
    emitter.emit("icon");
    expect(dynamicTab.itemTitle.classList.contains("icon-flame")).toBe(true);
    expect(dynamicTab.itemTitle.classList.contains("icon-tools")).toBe(false);
  });

  it("follows an item's path changes without a manual icon refresh", () => {
    const emitter = new Emitter();
    let filePath = path.join(__dirname, "fixtures", "sample.js");
    provide((target) => {
      if (target.type !== "path") return null;
      return Icon.classes([target.path.endsWith(".js") ? "path-js" : "path-md"]);
    });
    const item = {
      element: document.createElement("div"),
      getElement() {
        return this.element;
      },
      getTitle: () => "Dynamic path",
      getPath: () => filePath,
      onDidChangePath: (callback) => emitter.on("path", callback),
    };
    const dynamicTab = addItem(item);
    expect(dynamicTab.itemTitle.classList.contains("path-js")).toBe(true);

    filePath = path.join(__dirname, "fixtures", "sample.md");
    emitter.emit("path", filePath);
    expect(dynamicTab.itemTitle.classList.contains("path-md")).toBe(true);
    expect(dynamicTab.itemTitle.classList.contains("path-js")).toBe(false);
    expect(dynamicTab.itemTitle.dataset.path).toBe(filePath);
  });
});
