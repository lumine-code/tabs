module.exports = class TabDropProvider {
  constructor(
    tabTransferService,
    {
      workspace = lumine.workspace,
      windowService = lumine.window,
      getTabBarForPane = () => null,
    } = {},
  ) {
    this.tabTransferService = tabTransferService;
    this.workspace = workspace;
    this.windowService = windowService;
    this.getTabBarForPane = getTabBarForPane;
  }

  propose({ offer, pane }) {
    if (offer?.kind !== "pane-item") return null;

    return {
      effect: "move",
      allowedLocations: offer.allowedLocations,
      allowSplit: !this.isOnlyItemFromPane(offer, pane),
    };
  }

  prepareDrop({ descriptor, pane }) {
    if (descriptor?.kind !== "pane-item") return null;
    if (typeof descriptor.token !== "string" || descriptor.token.length === 0) return null;
    if (!Number.isInteger(descriptor.source?.windowId)) return null;
    if (!Array.isArray(descriptor.items) || descriptor.items.length !== 1) return null;

    const transferItem = descriptor.items[0];
    if (!transferItem || transferItem.type !== "pane-item") return null;

    const sourceWindowId = descriptor.source.windowId;
    const sameWindow = sourceWindowId === this.windowService.getId();
    const session = sameWindow ? this.tabTransferService.getSession(descriptor.token) : null;
    if (sameWindow && !session?.item) return null;
    if (!sameWindow && typeof transferItem.uri !== "string") return null;

    return {
      descriptor,
      transferItem,
      sourceWindowId,
      sameWindow,
      session,
      allowSplit: !this.isOnlyItemFromPane(descriptor, pane),
    };
  }

  async perform(context, prepared) {
    if (prepared.sameWindow) return this.moveLocalItem(context, prepared);
    return this.openRemoteItem(context, prepared);
  }

  moveLocalItem(context, prepared) {
    const { descriptor, session } = prepared;
    const { item } = session;
    const sourcePane =
      this.workspace.paneForItem?.(item) ??
      (session.pane?.getItems?.().includes(item) ? session.pane : null);
    if (!sourcePane) throw new Error("The dragged pane item is no longer available");

    if (
      context.surface === "pane" &&
      sourcePane === context.pane &&
      context.candidateSplit == null
    ) {
      this.tabTransferService.release(descriptor.token, "item dropped on its current pane");
      return { pane: sourcePane, item };
    }

    const targetPane = context.resolvePane({ allowSplit: prepared.allowSplit });
    this.moveItem(sourcePane, targetPane, item, context.index);
    targetPane.activateItem(item);
    targetPane.activate();
    this.tabTransferService.release(descriptor.token, "item moved within its source window");
    return { pane: targetPane, item };
  }

  async openRemoteItem(context, prepared) {
    const { descriptor, sourceWindowId, transferItem } = prepared;
    const targetPane = context.resolvePane({ allowSplit: prepared.allowSplit });
    const itemsBeforeOpen = new Set(this.workspace.getPaneItems?.() || []);
    const item = await this.workspace.open(transferItem.uri, {
      pane: targetPane,
      activateItem: false,
      activatePane: false,
      pending: false,
    });
    if (!item) throw new Error("The target window could not open the dragged pane item");

    const openedPane = this.workspace.paneForItem?.(item);
    if (!openedPane) throw new Error("The opened pane item has no owning pane");
    const existedBeforeOpen = itemsBeforeOpen.has(item);
    const originalIndex = openedPane.getItems().indexOf(item);
    const originalActiveItem = openedPane.getActiveItem?.();
    const canRestoreText = existedBeforeOpen && typeof item.getText === "function";
    const originalText = canRestoreText ? item.getText() : undefined;

    try {
      this.moveItem(openedPane, targetPane, item, context.index);

      if (Object.hasOwn(transferItem, "modifiedText") && typeof item.setText === "function") {
        item.setText(transferItem.modifiedText);
      }

      targetPane.activateItem(item);
      targetPane.activate();
      const committed = await this.tabTransferService.commitRemote(
        sourceWindowId,
        descriptor.token,
      );
      if (committed === false) throw new Error("The source window rejected the tab transfer");
    } catch (error) {
      await this.restoreRemoteItem(item, {
        existedBeforeOpen,
        openedPane,
        originalIndex,
        originalActiveItem,
        originalText,
        canRestoreText,
      });
      throw error;
    }

    try {
      await this.windowService.focus?.();
    } catch (error) {
      console.error(error);
    }
    return { pane: targetPane, item };
  }

  async restoreRemoteItem(
    item,
    {
      existedBeforeOpen,
      openedPane,
      originalIndex,
      originalActiveItem,
      originalText,
      canRestoreText,
    },
  ) {
    const currentPane = this.workspace.paneForItem?.(item);
    if (!existedBeforeOpen) {
      await currentPane?.destroyItem?.(item, true);
      return;
    }

    if (currentPane && currentPane !== openedPane) {
      currentPane.moveItemToPane(item, openedPane, originalIndex);
    } else if (
      currentPane === openedPane &&
      openedPane.getItems().indexOf(item) !== originalIndex
    ) {
      openedPane.moveItem(item, originalIndex);
    }
    if (canRestoreText && typeof item.setText === "function") item.setText(originalText);
    if (originalActiveItem && openedPane.getItems().includes(originalActiveItem)) {
      openedPane.activateItem(originalActiveItem);
    }
  }

  moveItem(sourcePane, targetPane, item, index) {
    const sourceIndex = sourcePane.getItems().indexOf(item);
    if (sourceIndex < 0) throw new Error("The dragged pane item is no longer available");

    let targetIndex = Number.isInteger(index)
      ? index
      : Math.max(0, targetPane.getActiveItemIndex() + 1);
    if (sourcePane === targetPane) {
      if (sourceIndex < targetIndex) targetIndex--;
      targetIndex = Math.max(0, Math.min(targetIndex, targetPane.getItems().length - 1));
      if (sourceIndex !== targetIndex) targetPane.moveItem(item, targetIndex);
    } else {
      targetIndex = Math.max(0, Math.min(targetIndex, targetPane.getItems().length));
      const targetTabBar = this.getTabBarForPane(targetPane);
      try {
        if (targetTabBar) targetTabBar.isItemMovingBetweenPanes = true;
        sourcePane.moveItemToPane(item, targetPane, targetIndex);
      } finally {
        if (targetTabBar) targetTabBar.isItemMovingBetweenPanes = false;
      }
    }
    return targetIndex;
  }

  isOnlyItemFromPane(payload, pane) {
    return Boolean(
      payload?.source?.onlyItem &&
      payload.source.windowId === this.windowService.getId() &&
      payload.source.paneId === pane?.id,
    );
  }
};
