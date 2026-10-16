const fs = require("fs");
const os = require("os");
const path = require("path");
const { Disposable } = require("lumine");

describe("tab titles with unsaved buffers", () => {
  let directory, editor, tab, repository, summary, ignored;

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "tabs-buffer-status-"));
    const filePath = path.join(directory, "example.txt");
    fs.writeFileSync(filePath, "original\n");
    summary = null;
    ignored = false;
    repository = {
      getStatusSnapshot: () => ({ initialized: true }),
      getPathStatusSummary: () => summary,
      isPathIgnoredCached: () => ignored,
      onDidChangeStatusSnapshot: () => new Disposable(),
    };
    const main = (await lumine.packages.activatePackage(path.join(__dirname, ".."))).mainModule;
    editor = await lumine.workspace.open(filePath);
    const pane = lumine.workspace.paneForItem(editor);
    tab = [...main.tabBarViews.values()].find((bar) => bar.pane === pane).tabForItem(editor);
    await tab.setupVcsStatus();
    tab.updateVcsStatus(repository);
  });

  afterEach(() => {
    editor?.destroy();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it("colors an edit before saving and clears the color after undo", () => {
    editor.insertText("changed");
    expect(tab.itemTitle).toHaveClass("status-modified");
    expect(tab.element.dataset.fileState).toBe("modified");
    expect(fs.readFileSync(editor.getPath(), "utf8")).toBe("original\n");
    editor.undo();
    expect(tab.itemTitle).not.toHaveClass("status-modified");
    expect(tab.element.dataset.fileState).toBe("unmodified");
  });

  for (const status of ["added", "conflicted", "ignored"]) {
    it(`preserves the ${status} Git color while the buffer is dirty`, () => {
      summary = { [status]: true };
      ignored = status === "ignored";
      tab.updateVcsStatus(repository);
      editor.insertText("changed");
      expect(tab.itemTitle).toHaveClass(`status-${status}`);
      expect(tab.itemTitle).not.toHaveClass("status-modified");
    });
  }

  it("retains a saved Git modification after undoing a later unsaved edit", () => {
    summary = { modified: true };
    tab.updateVcsStatus(repository);
    editor.insertText("changed");
    editor.undo();
    expect(tab.element.dataset.fileState).toBe("unmodified");
    expect(tab.itemTitle).toHaveClass("status-modified");
  });

  it("keeps unsaved coloring when repository discovery finishes without a repository", async () => {
    editor.insertText("changed");
    await tab.setupVcsStatus();
    expect(tab.itemTitle).toHaveClass("status-modified");
  });

  it("colors both tabs sharing a buffer and clears both after undo", async () => {
    const pane = lumine.workspace.paneForItem(editor).splitRight({ items: [editor.copy()] });
    await conditionPromise(() => pane.getElement().querySelector(".tab .title"));
    const otherTitle = pane.getElement().querySelector(".tab .title");
    editor.insertText("changed");
    expect(tab.itemTitle).toHaveClass("status-modified");
    expect(otherTitle).toHaveClass("status-modified");
    editor.undo();
    expect(otherTitle).not.toHaveClass("status-modified");
    pane.destroy();
  });

  it("clears the unsaved title when saving outside Git", async () => {
    editor.insertText("changed");
    await editor.save();
    expect(tab.itemTitle).not.toHaveClass("status-modified");
    expect(tab.element.dataset.fileState).toBe("unmodified");
  });
});
