module.exports = class TabDropProvider {
  constructor(transferScope, { windowService = lumine.window } = {}) {
    this.transferScope = transferScope;
    this.windowService = windowService;
  }

  propose({ offer, pane }) {
    if (offer?.kind !== "pane-item") return null;

    const isOnlyItemInOwnPane =
      offer.source?.onlyItem &&
      offer.source.windowId === this.windowService.getId() &&
      offer.source.paneId === pane?.id;
    return {
      effect: "move",
      allowedLocations: offer.allowedLocations,
      allowSplit: !isOnlyItemInOwnPane,
    };
  }

  prepareDrop({ descriptor, pane }) {
    return this.transferScope.prepareDrop(descriptor, pane);
  }

  perform(context, prepared) {
    return this.transferScope.performDrop(context, prepared);
  }
};
