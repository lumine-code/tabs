const path = require("node:path");
const { createRequire } = require("node:module");

describe("tab action runtime bootstrap", () => {
  let main;
  beforeEach(async () => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    if (lumine.packages.isPackageLoaded("tabs")) await lumine.packages.unloadPackage("tabs");
    main = (await lumine.packages.activatePackage("tabs")).mainModule;
  });
  afterEach(async () => {
    await lumine.packages.unloadPackage("tabs");
  });

  const loaded = () =>
    Object.values(require.cache).some(
      (entry) => entry?.filename === path.join(__dirname, "../lib/tab-action-runtime.js"),
    );

  it("keeps pane creation, title updates and drag cleanup independent from action code", async () => {
    const editor = await lumine.workspace.open();
    const pane = lumine.workspace.paneForItem(editor);
    const bar = main.tabBarViews.get(pane);
    expect(bar.tabForItem(editor)).toBeDefined();
    editor.setText("unsaved");
    bar.interaction.onDragEnd();
    expect(loaded()).toBe(false);
    main.deactivate();
    expect(loaded()).toBe(false);
  });

  it("loads actions on demand without replacing public forwarding methods", async () => {
    const editor = await lumine.workspace.open();
    const bar = main.tabBarViews.get(lumine.workspace.paneForItem(editor));
    const close = bar.closeTab;
    expect(loaded()).toBe(false);
    expect(await close.call(bar, bar.tabForItem(editor))).toBe(true);
    expect(editor.isDestroyed()).toBe(true);
    expect(loaded()).toBe(true);
    expect(bar.closeTab).toBe(close);
  });

  it("uses one bootstrap module while preserving compatibility constructor identities", async () => {
    const editor = await lumine.workspace.open();
    const bar = main.tabBarViews.get(lumine.workspace.paneForItem(editor));
    for (const file of ["tab-title-manager.js", "tab-bar-layout.js", "tab-bar-interaction.js"]) {
      expect(
        Object.values(require.cache).some(
          (entry) => entry?.filename === path.join(__dirname, "../lib", file),
        ),
      ).toBe(false);
    }
    const pack = lumine.packages.getActivePackage("tabs");
    const currentRequire = createRequire(path.join(pack.path, "package.json"));
    expect(bar.titleManager.constructor).toBe(currentRequire("./lib/tab-title-manager.js"));
    expect(bar.layout.constructor).toBe(currentRequire("./lib/tab-bar-layout.js"));
    expect(bar.interaction.constructor).toBe(currentRequire("./lib/tab-bar-interaction.js"));
    const previous = bar.interaction.constructor;
    await lumine.packages.unloadPackage("tabs");
    const current = await lumine.packages.activatePackage("tabs");
    main = current.mainModule;
    const nextBar = main.tabBarViews.get(lumine.workspace.paneForItem(editor));
    const nextRequire = createRequire(path.join(current.path, "package.json"));
    expect(nextBar.interaction.constructor).not.toBe(previous);
    expect(nextBar.interaction.constructor).toBe(nextRequire("./lib/tab-bar-interaction.js"));
  });
});
