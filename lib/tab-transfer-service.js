module.exports = class TabTransferService {
  constructor({ workspace = lumine.workspace, workspaceDrops = lumine.workspaceDrops } = {}) {
    this.workspace = workspace;
    this.workspaceDrops = workspaceDrops;
    this.tokens = new Set();
  }

  createSession(pane, item) {
    const { token } = this.workspaceDrops.createSession(
      { pane, item },
      {
        commit: (_result, session) => this.commitSession(token, session),
        rollback: () => this.tokens.delete(token),
      },
    );
    this.tokens.add(token);
    return token;
  }

  getSession(token) {
    return this.workspaceDrops.getSession(token) ?? null;
  }

  commitRemote(sourceWindowId, token, result = {}) {
    if (!token || !Number.isInteger(sourceWindowId)) return false;
    return this.workspaceDrops.commit(token, {
      ...result,
      sourceWindowId,
    });
  }

  release(token, reason = "drag ended without a committed drop") {
    if (!this.tokens.delete(token)) return false;
    void Promise.resolve(this.workspaceDrops.rollback(token, reason)).catch(() => {});
    return true;
  }

  // A dragend can precede a cross-window acknowledgement, so core's session
  // TTL owns abandoned-drag cleanup without racing a successful remote drop.
  finishSession(_token) {}

  commitSession(token, { pane, item }) {
    this.tokens.delete(token);
    const currentPane = this.workspace.paneForItem?.(item);
    const owningPane = currentPane ?? (pane.getItems().includes(item) ? pane : null);
    // The target stages unsaved text before it commits, so this is a move, not
    // a user close that should prompt to save the source copy.
    return owningPane?.destroyItem(item, true);
  }

  dispose() {
    for (const token of Array.from(this.tokens)) {
      this.release(token, "tabs package deactivated");
    }
  }
};
