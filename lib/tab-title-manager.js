class TabTitleManager {
  constructor(tabs) {
    this.tabs = tabs;
  }

  refresh() {
    const titles = this.tabs.map((tab) => tab.item.getTitle());
    const counts = new Map();
    for (const title of titles) counts.set(title, (counts.get(title) ?? 0) + 1);

    this.tabs.forEach((tab, index) => {
      const title = titles[index];
      const resolvedTitle = counts.get(title) > 1 ? (tab.item.getLongTitle?.() ?? title) : title;
      tab.updateTitle(resolvedTitle);
    });
  }
}

module.exports = TabTitleManager;
