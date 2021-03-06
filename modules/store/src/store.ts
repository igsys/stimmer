import {Draft, createDraft, finishDraft, Immutable} from 'immer';

export type ActionInfo = {
  featureName: string,
  name: string,
  args: any[]
  isAsync?: boolean,
}

type StateChangeHandler<T> = (state: Immutable<T>, action: ActionInfo) => unknown;

export class Store<T> {
  private stateChangeHandlers: Array<StateChangeHandler<T>> = [];

  private state: T = Object.create(null);

  private currentDraft?: Draft<T>;

  getState(): Immutable<T> {
    return this.state as Immutable<T>;
  }

  subscribe(callback: StateChangeHandler<T>): void {
    this.stateChangeHandlers.push(callback);
  }

  unsubscribe(callback: StateChangeHandler<T>): void {
    this.stateChangeHandlers = this.stateChangeHandlers.filter(h => h !== callback);
  }

  private finishDraft(draft: Draft<T>, actionInfo: ActionInfo): void {
    (this.state as any) = finishDraft(draft);

    this.stateChangeHandlers.forEach(handler => {
      handler(this.state as Immutable<T>, actionInfo);
    });
  }

  _getCurrentDraft(): Draft<T>|undefined {
    return this.currentDraft;
  }

  /**
   * This is intended to be used by async actions using async/await. The draft created by this function
   * will be completed using a microtask (at the end of the current event loop in modern browsers).
   */
  _startAsyncDraft(actionInfo: ActionInfo): Draft<T> {
    if (this.currentDraft) {
      throw new Error('Cannot start a new draft while one is active');
    }

    const draft = this.currentDraft = createDraft(this.state);

    // Complete the draft asynchronously after it can be determined whether the current async "leg"
    // will throw or not (if it throws, draft changes are not persisted).
    Promise.resolve().then(() => Promise.resolve()).then(() => {
      if (draft === this.currentDraft) {
        try {
          this.finishDraft(
            this.currentDraft,
            actionInfo
          );
          this.currentDraft = undefined;
        } catch (e) {
        }
      }
    });

    return this.currentDraft;
  }

  _update(fn: (draft: Draft<T>) => unknown, actionInfo: ActionInfo): unknown {
    let draftCreated;

    if (!this.currentDraft) {
      this.currentDraft = createDraft(this.state);
      draftCreated = true;
    }

    let ret;
    try {
      ret = fn(this.currentDraft);

      if (draftCreated) {
        this.finishDraft(this.currentDraft, actionInfo);
      }
    } finally {
      if (draftCreated) {
        this.currentDraft = undefined;
      }
    }

    // TODO: Thenable
    if (ret instanceof Promise) {
      ret.then(() => {
        if (this.currentDraft) {
          this.finishDraft(this.currentDraft, {...actionInfo, isAsync: true});
          this.currentDraft = undefined;
        }
      }).catch(() => {
        this.currentDraft = undefined;
      });
    }

    return ret;
  }
}