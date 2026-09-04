const { GitStatusUpdateScheduler } = require("../lib/git-status-update-scheduler");

describe("GitStatusUpdateScheduler", () => {
  let scheduledTasks, scheduler, repository, repositorySubscription;

  beforeEach(() => {
    scheduledTasks = [];
    scheduler = new GitStatusUpdateScheduler({
      schedule: (callback) => scheduledTasks.push(callback),
      getTime: () => 0,
      maxUpdatesPerSlice: 2,
    });
    repositorySubscription = jasmine.createSpyObj("subscription", ["dispose"]);
    repository = {
      onDidChangeStatusSnapshot: jasmine
        .createSpy("onDidChangeStatusSnapshot")
        .and.callFake((callback) => {
          repository.emitStatusSnapshot = callback;
          return repositorySubscription;
        }),
    };
  });

  const runNextTask = () => scheduledTasks.shift()();

  it("shares one repository listener and defers tab updates", () => {
    const firstUpdate = jasmine.createSpy("firstUpdate");
    const secondUpdate = jasmine.createSpy("secondUpdate");

    scheduler.subscribe(repository, firstUpdate);
    scheduler.subscribe(repository, secondUpdate);

    expect(repository.onDidChangeStatusSnapshot.calls.count()).toBe(1);
    expect(firstUpdate).not.toHaveBeenCalled();
    expect(secondUpdate).not.toHaveBeenCalled();
    expect(scheduledTasks.length).toBe(1);

    runNextTask();

    expect(firstUpdate).toHaveBeenCalledOnceWith(repository);
    expect(secondUpdate).toHaveBeenCalledOnceWith(repository);
  });

  it("limits the work performed in one renderer turn", () => {
    const updates = Array.from({ length: 5 }, (_, index) => jasmine.createSpy(`update-${index}`));
    updates.forEach((update) => scheduler.subscribe(repository, update));

    runNextTask();

    expect(updates.filter((update) => update.calls.count() === 1).length).toBe(2);
    expect(scheduledTasks.length).toBe(1);

    runNextTask();
    expect(updates.filter((update) => update.calls.count() === 1).length).toBe(4);

    runNextTask();
    expect(updates.every((update) => update.calls.count() === 1)).toBe(true);
    expect(scheduledTasks.length).toBe(0);
  });

  it("coalesces repeated snapshots while an update is pending", () => {
    const update = jasmine.createSpy("update");
    scheduler.subscribe(repository, update);

    repository.emitStatusSnapshot();
    repository.emitStatusSnapshot();

    expect(scheduledTasks.length).toBe(1);
    runNextTask();
    expect(update.calls.count()).toBe(1);
  });

  it("removes pending work and the shared listener when the last tab leaves", () => {
    const firstUpdate = jasmine.createSpy("firstUpdate");
    const secondUpdate = jasmine.createSpy("secondUpdate");
    const firstSubscription = scheduler.subscribe(repository, firstUpdate);
    const secondSubscription = scheduler.subscribe(repository, secondUpdate);

    firstSubscription.dispose();
    runNextTask();

    expect(firstUpdate).not.toHaveBeenCalled();
    expect(secondUpdate).toHaveBeenCalled();
    expect(repositorySubscription.dispose).not.toHaveBeenCalled();

    secondSubscription.dispose();
    expect(repositorySubscription.dispose).toHaveBeenCalled();
  });
});
