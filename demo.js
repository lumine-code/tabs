// Authentic package usage. Run with lumine/script/demo.js; fixtures stay in demo/.
module.exports = {
  version: 1,
  dependencies: ["language-javascript", "tree-view"],
  viewport: { width: 1200, height: 760 },
  async before() {},
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
  ],
  async cleanup() {},
};
