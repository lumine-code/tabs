const path = require("path");
const { Emitter } = require("lumine");

const packageRoot = path.join(__dirname, "..");

describe("tab title groups", () => {
  let pane, bar, items;

  const addItem = (title, parent) => {
    const emitter = new Emitter();
    const item = {
      element: document.createElement("div"),
      title,
      getTitle() {
        return this.title;
      },
      getLongTitle() {
        return `${parent}/${this.title}`;
      },
      onDidChangeTitle: (callback) => emitter.on("title", callback),
      rename(newTitle) {
        this.title = newTitle;
        emitter.emit("title", newTitle);
      },
      destroy: () => emitter.dispose(),
    };
    items.push(item);
    pane.addItem(item);
    return item;
  };

  const titleFor = (item) => bar.tabForItem(item).itemTitle.textContent;

  beforeEach(async () => {
    const main = (await lumine.packages.activatePackage(packageRoot)).mainModule;
    pane = lumine.workspace.getActivePane();
    bar = [...main.tabBarViews.values()].find((view) => view.pane === pane);
    items = [];
  });

  afterEach(async () => {
    for (const item of items) {
      if (pane.getItems().includes(item)) await pane.destroyItem(item);
    }
  });

  it("restores the short title when a rename dissolves a collision", () => {
    const first = addItem("same.txt", "a");
    const second = addItem("same.txt", "b");
    expect(titleFor(first)).toBe("a/same.txt");
    expect(titleFor(second)).toBe("b/same.txt");

    second.rename("renamed.txt");

    expect(titleFor(first)).toBe("same.txt");
    expect(titleFor(second)).toBe("renamed.txt");
  });

  it("updates both groups when a rename changes which title collides", () => {
    const first = addItem("same.txt", "a");
    const renamed = addItem("same.txt", "b");
    const destination = addItem("other.txt", "c");

    renamed.rename("other.txt");

    expect(titleFor(first)).toBe("same.txt");
    expect(titleFor(renamed)).toBe("b/other.txt");
    expect(titleFor(destination)).toBe("c/other.txt");
  });
});
