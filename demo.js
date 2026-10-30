// Authentic package usage. Run with lumine/script/demo.js; fixtures stay in demo/.
module.exports = {
  version: 1,
  dependencies: [
    "language-javascript",
    "language-gfm",
    "tree-view",
    "navigation-panel",
    "git-panel",
  ],
  viewport: { width: 1200, height: 760 },
  async before({ lumine }) {
    lumine.config.set("tabs.dockTabsMode", "titles");
  },
  async prepare(context) {
    const { lumine, state, fixture, open } = context;
    state.editor = await open("Signal Lab/src/signal.js");
    await lumine.project.setPaths([fixture("Signal Lab")]);
  },
  scenes: [
    {
      id: "scene-1",
      file: "demo.png",
      caption: "Switch between open source, project notes and metadata.",
      timeout: 60000,
      async run(context) {
        const { lumine, state, fixture } = context;
        {
          await lumine.workspace.open(fixture("Signal Lab/README.md"));
          await lumine.workspace.open(fixture("Signal Lab/package.json"));
          await lumine.workspace.open(state.editor);
          lumine.commands.dispatch(lumine.views.getView(state.editor), "tree-view:show");
        }
      },
      ready() {
        return Boolean(document.querySelectorAll(".tab-bar .tab").length >= 3);
      },
    },
    {
      id: "dock-icons",
      file: "demo-dock-icons.png",
      caption: "Keep dock tools in a compact icon strip while source tabs retain their titles.",
      timeout: 60000,
      async run({ lumine, state, fixture, waitFor }) {
        lumine.config.set("tabs.dockTabsMode", "icons");
        await lumine.workspace.open(fixture("Signal Lab/README.md"));
        const navigation = lumine.packages.getActivePackage("navigation-panel").mainModule;
        navigation.open({ location: "left" });
        await waitFor(
          () => document.querySelector(".navigation-panel")?.innerText.includes("Signal Lab"),
          "document navigation headings",
        );
        await lumine.workspace.open("lumine-git://dock-item/git", { location: "left" });
        lumine.commands.dispatch(lumine.views.getView(state.editor), "tree-view:show");
        lumine.workspace.getLeftDock().setState({ size: 270 });
        lumine.workspace.getCenter().getActivePane().activateItem(state.editor);
        lumine.views.getView(state.editor).focus();
      },
      ready({ lumine }) {
        const dockTabs = document.querySelector('.tab-bar.icons-only[location="left"]');
        const closeButton = dockTabs?.parentElement.querySelector(".dock-tab-close");
        const centerTabs = lumine.workspace
          .getCenter()
          .getActivePane()
          .getElement()
          .querySelector(".tab-bar:not(.icons-only)");
        return Boolean(
          dockTabs?.querySelectorAll(".tab").length >= 3 &&
          dockTabs.querySelector(".tab.active .icon-file-submodule") &&
          closeButton &&
          !closeButton.hidden &&
          !closeButton.disabled &&
          centerTabs?.innerText.includes("signal.js") &&
          centerTabs.innerText.includes("README.md") &&
          centerTabs.innerText.includes("package.json") &&
          document.querySelector(".tree-view")?.textContent.includes("Signal Lab"),
        );
      },
    },
  ],
  async cleanup() {},
};
