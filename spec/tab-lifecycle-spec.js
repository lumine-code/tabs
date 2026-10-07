const path = require("path");
const { Disposable } = require("lumine");

const packageRoot = path.join(__dirname, "..");

describe("tabs package ownership", () => {
  let main, pane, tab;

  beforeEach(async () => {
    main = (await lumine.packages.activatePackage(packageRoot)).mainModule;
    const editor = await lumine.workspace.open();
    pane = lumine.workspace.paneForItem(editor);
    const bar = [...main.tabBarViews.values()].find((view) => view.pane === pane);
    tab = bar.tabForItem(editor);
  });

  it("disposes tab observers and icon bindings when the package is deactivated", async () => {
    spyOn(tab, "updateTitle").and.callThrough();
    spyOn(tab, "updateIconVisibility").and.callThrough();
    spyOn(tab, "setupVcsStatus").and.callThrough();
    const iconBinding = tab.iconDisposable;
    spyOn(iconBinding, "dispose").and.callThrough();
    const previousShowIcons = lumine.config.get("tabs.showIcons");

    await lumine.packages.deactivatePackage("tabs");
    tab.item.buffer.setPath(path.join(__dirname, "fixtures", "renamed.js"));
    lumine.config.set("tabs.showIcons", !previousShowIcons);
    lumine.repositories.emitter.emit("did-change", {});

    expect(iconBinding.dispose).toHaveBeenCalledTimes(1);
    expect(tab.updateTitle).not.toHaveBeenCalled();
    expect(tab.updateIconVisibility).not.toHaveBeenCalled();
    expect(tab.setupVcsStatus).not.toHaveBeenCalled();
    expect(main.tabBarViews.size).toBe(0);
  });

  it("releases the destroyed tab generation before activating a replacement", async () => {
    const oldTab = tab;
    const editor = tab.item;
    spyOn(oldTab, "updateFileState").and.callThrough();

    await lumine.packages.deactivatePackage("tabs");
    main = (await lumine.packages.activatePackage(packageRoot)).mainModule;
    const bar = [...main.tabBarViews.values()].find((view) => view.pane === pane);
    tab = bar.tabForItem(editor);
    spyOn(tab, "updateFileState").and.callThrough();
    editor.setText("changed");

    expect(tab).not.toBe(oldTab);
    expect(tab.element.dataset.fileState).toBe("modified");
    expect(tab.updateFileState).toHaveBeenCalledTimes(1);
    expect(oldTab.updateFileState).not.toHaveBeenCalled();
  });

  it("releases the shared Git status observer when the last tab is deactivated", async () => {
    const repositorySubscription = new Disposable(() => {});
    spyOn(repositorySubscription, "dispose").and.callThrough();
    const repository = {
      getStatusSnapshot: () => ({ initialized: true }),
      getPathStatusSummary: () => null,
      isPathIgnoredCached: () => false,
      onDidChangeStatusSnapshot: () => repositorySubscription,
    };
    tab.subscribeToRepo(repository);

    await lumine.packages.deactivatePackage("tabs");

    expect(repositorySubscription.dispose).toHaveBeenCalledTimes(1);
  });

  it("releases the unloaded generation before loading its replacement modules", async () => {
    const oldTab = tab;
    const oldConstructor = tab.constructor;
    const editor = tab.item;
    spyOn(oldTab, "updateFileState").and.callThrough();

    await lumine.packages.unloadPackage("tabs");
    main = (await lumine.packages.activatePackage(packageRoot)).mainModule;
    tab = main.tabBarViews.get(pane).tabForItem(editor);
    editor.setText("new generation");

    expect(oldTab.destroyed).toBe(true);
    expect(tab.constructor).not.toBe(oldConstructor);
    expect(tab.element.dataset.fileState).toBe("modified");
    expect(oldTab.updateFileState).not.toHaveBeenCalled();
    expect(main.tabBarViews.get(pane).getTabs()).toEqual([tab]);
  });
});
