const fs = require("fs");
const path = require("path");

describe("Tab persistence-marker CSS roles", () => {
  it("keeps disk-state markers independent from Git title colors", () => {
    const sheets = [
      lumine.styles.addStyleSheet(
        fs.readFileSync(path.join(__dirname, "../styles/main.css"), "utf8"),
        { priority: 1000 },
      ),
      lumine.styles.addStyleSheet(
        fs.readFileSync(
          path.join(
            path.dirname(require.resolve("lumine")),
            "../static/lumine-ui/styles/git-status.css",
          ),
          "utf8",
        ),
        { priority: 1000 },
      ),
    ];
    const colorsWereDisabled = document.body.classList.contains("git-colorize-disabled");
    document.body.classList.remove("git-colorize-disabled");
    try {
      const bar = document.createElement("ul");
      bar.className = "tab-bar";
      for (const [name, value] of Object.entries({
        "accent-indicator-color": "rgb(10, 20, 30)",
        "text-color-warning": "rgb(40, 50, 60)",
        "text-color-error": "rgb(70, 80, 90)",
        "text-color-modified": "rgb(100, 110, 120)",
        "text-color-removed": "rgb(130, 140, 150)",
      }))
        bar.style.setProperty(`--${name}`, value);
      const cases = [
        ["modified", "status-modified", "rgb(10, 20, 30)", "rgb(100, 110, 120)"],
        ["conflicted", "status-modified", "rgb(40, 50, 60)", "rgb(100, 110, 120)"],
        ["removed", "status-removed", "rgb(70, 80, 90)", "rgb(130, 140, 150)"],
      ];
      for (const [state, gitClass, markerColor, titleColor] of cases) {
        const tab = document.createElement("li");
        tab.className = "tab active";
        tab.dataset.fileState = state;
        tab.style.pointerEvents = "none";
        tab.innerHTML = `<span class="title ${gitClass}">file.txt</span><span class="tab-status"></span>`;
        bar.appendChild(tab);
        jasmine.attachToDOM(bar);
        expect(getComputedStyle(tab.querySelector(".tab-status")).backgroundColor).toBe(
          markerColor,
        );
        expect(getComputedStyle(tab.querySelector(".title")).color).toBe(titleColor);
      }
    } finally {
      for (const sheet of sheets) sheet.dispose();
      if (colorsWereDisabled) document.body.classList.add("git-colorize-disabled");
    }
  });
});
