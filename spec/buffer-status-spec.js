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

  it("colors an edit before saving and clears the color after undo", async () => {
    editor.insertText("changed");
    expect(tab.itemTitle).toHaveClass("status-modified");
    expect(tab.element.dataset.fileState).toBe("modified");
    expect(fs.readFileSync(editor.getPath(), "utf8")).toBe("original\n");
    editor.undo();
    await flushMicrotasks();
    expect(tab.itemTitle).not.toHaveClass("status-modified");
    expect(tab.element.dataset.fileState).toBe("unmodified");
  });

  for (const status of ["added", "conflicted", "ignored"]) {
    it(`preserves the ${status} Git color while the buffer is dirty`, async () => {
      summary = { [status]: true };
      ignored = status === "ignored";
      tab.updateVcsStatus(repository);
      editor.insertText("changed");
      expect(tab.itemTitle).toHaveClass(`status-${status}`);
      expect(tab.itemTitle).not.toHaveClass("status-modified");
    });
  }

  it("retains a saved Git modification after undoing a later unsaved edit", async () => {
    summary = { modified: true };
    tab.updateVcsStatus(repository);
    editor.insertText("changed");
    editor.undo();
    await flushMicrotasks();
    expect(tab.element.dataset.fileState).toBe("unmodified");
    expect(tab.itemTitle).toHaveClass("status-modified");
  });

  it("removes Git coloring when discovery confirms the dirty file has no repository", async () => {
    editor.insertText("changed");
    await tab.setupVcsStatus();
    expect(tab.itemTitle).not.toHaveClass("status-modified");
    expect(tab.element.dataset.fileState).toBe("modified");
  });

  it("colors both tabs sharing a buffer and clears both after undo", async () => {
    const pane = lumine.workspace.paneForItem(editor).splitRight({ items: [editor.copy()] });
    await conditionPromise(() => pane.getElement().querySelector(".tab .title"));
    const otherTitle = pane.getElement().querySelector(".tab .title");
    const main = lumine.packages.getActivePackage("tabs").mainModule;
    const otherTab = [...main.tabBarViews.values()]
      .find((bar) => bar.pane === pane)
      .tabForItem(pane.getActiveItem());
    await otherTab.setupVcsStatus();
    otherTab.updateVcsStatus(repository);
    editor.insertText("changed");
    expect(tab.itemTitle).toHaveClass("status-modified");
    expect(otherTitle).toHaveClass("status-modified");
    editor.undo();
    await flushMicrotasks();
    expect(otherTitle).not.toHaveClass("status-modified");
    pane.destroy();
  });

  it("clears the unsaved title when saving outside Git", async () => {
    tab.unsetVcsStatus();
    editor.insertText("changed");
    expect(tab.itemTitle).not.toHaveClass("status-modified");
    await editor.save();
    expect(tab.itemTitle).not.toHaveClass("status-modified");
    expect(tab.element.dataset.fileState).toBe("unmodified");
  });

  it("keeps a dirty file neutral until the first Git snapshot is ready", async () => {
    tab.unsetVcsStatus();
    editor.insertText("changed");
    repository.getStatusSnapshot = () => ({ initialized: false });
    tab.updateVcsStatus(repository);
    expect(tab.itemTitle).not.toHaveClass("status-modified");
    repository.getStatusSnapshot = () => ({ initialized: true, includesIgnored: true });
    tab.updateVcsStatus(repository);
    expect(tab.itemTitle).toHaveClass("status-modified");
  });

  for (const status of ["added", "modified"]) {
    it(`distinguishes staged ${status} content from subsequent unsaved edits`, async () => {
      summary = { [status]: true, staged: true, unstaged: false };
      tab.updateVcsStatus(repository);
      expect(tab.itemTitle).toHaveClass(`status-${status}`);
      expect(tab.itemTitle).toHaveClass("status-staged");
      editor.insertText("changed");
      expect(tab.itemTitle).toHaveClass("status-modified");
      expect(tab.itemTitle).not.toHaveClass("status-staged");
      editor.undo();
      await flushMicrotasks();
      expect(tab.itemTitle).toHaveClass(`status-${status}`);
      expect(tab.itemTitle).toHaveClass("status-staged");
    });
  }

  it("repaints stage changes even when the modified classification stays the same", async () => {
    summary = { modified: true, staged: true, unstaged: false };
    tab.updateVcsStatus(repository);
    expect(tab.itemTitle).toHaveClass("status-staged");
    summary = { modified: true, staged: true, unstaged: true };
    tab.updateVcsStatus(repository);
    expect(tab.itemTitle).toHaveClass("status-modified");
    expect(tab.itemTitle).not.toHaveClass("status-staged");
    summary = { modified: true, staged: false, unstaged: true };
    tab.updateVcsStatus(repository);
    expect(tab.itemTitle).not.toHaveClass("status-staged");
  });

  for (const savedModified of [true, false]) {
    it(`keeps the color until Git confirms a ${savedModified ? "modified" : "clean"} saved file`, async () => {
      let finishRefresh;
      repository.refreshStatusSnapshot = () =>
        new Promise((resolve) => {
          finishRefresh = resolve;
        });
      tab.repository = repository;
      editor.insertText("changed");
      await editor.save();
      expect(editor.getFileState()).toBe("unmodified");
      expect(tab.itemTitle).toHaveClass("status-modified");
      summary = savedModified ? { modified: true, unstaged: true } : null;
      finishRefresh();
      await flushMicrotasks();
      expect(tab.itemTitle.classList.contains("status-modified")).toBe(savedModified);
    });
  }
});
