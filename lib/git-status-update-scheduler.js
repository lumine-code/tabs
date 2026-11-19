const DEFAULT_MAX_UPDATES_PER_SLICE = 100;
const DEFAULT_SLICE_BUDGET_MS = 4;

const now = () => globalThis.performance?.now?.() ?? Date.now();

const scheduleTask = (callback) => {
  if (typeof setImmediate === "function") {
    setImmediate(callback);
  } else {
    setTimeout(callback, 0);
  }
};

class GitStatusUpdateScheduler {
  constructor({
    schedule = scheduleTask,
    getTime = now,
    maxUpdatesPerSlice = DEFAULT_MAX_UPDATES_PER_SLICE,
    sliceBudgetMs = DEFAULT_SLICE_BUDGET_MS,
  } = {}) {
    this.schedule = schedule;
    this.getTime = getTime;
    this.maxUpdatesPerSlice = maxUpdatesPerSlice;
    this.sliceBudgetMs = sliceBudgetMs;
    this.groups = new WeakMap();
    this.pendingUpdates = new Set();
    this.scheduled = false;
  }

  subscribe(repository, filePath, update) {
    let group = this.groups.get(repository);
    if (group == null) {
      group = { repository, subscribers: new Set(), byPath: new Map() };
      group.subscription =
        repository.onDidChangeStatusPaths && repository.getStatusPathKey
          ? repository.onDidChangeStatusPaths((change) => this.queueChanged(group, change))
          : repository.onDidChangeStatusSnapshot(() => this.queueGroup(group));
      this.groups.set(repository, group);
    }

    const subscriber = { group, update, disposed: false };
    group.subscribers.add(subscriber);
    const key = repository.getStatusPathKey?.(filePath) ?? null;
    if (key != null) {
      let tabs = group.byPath.get(key);
      if (!tabs) group.byPath.set(key, (tabs = new Set()));
      tabs.add(subscriber);
    }
    this.queue(subscriber);

    return {
      dispose: () => {
        if (subscriber.disposed) return;
        subscriber.disposed = true;
        this.pendingUpdates.delete(subscriber);
        group.subscribers.delete(subscriber);
        const tabs = group.byPath.get(key);
        if (tabs?.delete(subscriber) && tabs.size === 0) group.byPath.delete(key);

        if (group.subscribers.size === 0) {
          group.subscription.dispose();
          this.groups.delete(repository);
        }
      },
    };
  }

  queueChanged(group, change) {
    if (change.reset) return this.queueGroup(group);
    const queuePath = (key) => {
      for (const subscriber of group.byPath.get(key) ?? []) this.pendingUpdates.add(subscriber);
    };
    for (const key of change.files) queuePath(key);
    for (const key of change.ignoredFiles) queuePath(key);
    if (change.ignoredDirectories.length > 0) {
      const directories = new Set(change.ignoredDirectories);
      for (const key of group.byPath.keys()) {
        for (let current = key; ;) {
          if (directories.has(current)) {
            queuePath(key);
            break;
          }
          const separator = current.lastIndexOf("/");
          if (separator === -1) break;
          current = current.slice(0, separator);
        }
      }
    }
    this.scheduleDrain();
  }

  queueGroup(group) {
    for (const subscriber of group.subscribers) {
      this.pendingUpdates.add(subscriber);
    }
    this.scheduleDrain();
  }

  queue(subscriber) {
    this.pendingUpdates.add(subscriber);
    this.scheduleDrain();
  }

  scheduleDrain() {
    if (this.scheduled || this.pendingUpdates.size === 0) return;
    this.scheduled = true;
    this.schedule(() => this.drain());
  }

  drain() {
    this.scheduled = false;
    const startedAt = this.getTime();
    let updateCount = 0;

    try {
      while (this.pendingUpdates.size > 0) {
        const subscriber = this.pendingUpdates.values().next().value;
        this.pendingUpdates.delete(subscriber);
        if (!subscriber.disposed) {
          subscriber.update(subscriber.group.repository);
        }

        updateCount++;
        if (
          updateCount >= this.maxUpdatesPerSlice ||
          this.getTime() - startedAt >= this.sliceBudgetMs
        ) {
          break;
        }
      }
    } finally {
      this.scheduleDrain();
    }
  }
}

const gitStatusUpdateScheduler = new GitStatusUpdateScheduler();

module.exports = gitStatusUpdateScheduler;
module.exports.GitStatusUpdateScheduler = GitStatusUpdateScheduler;
