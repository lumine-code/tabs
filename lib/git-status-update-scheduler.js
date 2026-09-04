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

  subscribe(repository, update) {
    let group = this.groups.get(repository);
    if (group == null) {
      group = { repository, subscribers: new Set() };
      group.subscription = repository.onDidChangeStatusSnapshot(() => this.queueGroup(group));
      this.groups.set(repository, group);
    }

    const subscriber = { group, update, disposed: false };
    group.subscribers.add(subscriber);
    this.queue(subscriber);

    return {
      dispose: () => {
        if (subscriber.disposed) return;
        subscriber.disposed = true;
        this.pendingUpdates.delete(subscriber);
        group.subscribers.delete(subscriber);

        if (group.subscribers.size === 0) {
          group.subscription.dispose();
          this.groups.delete(repository);
        }
      },
    };
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
