// The username shown under the slot machine. Runs in the overlay page and in
// the tests: the name shows while spinning, gets a check mark and turns green
// when the spin finishes, then hides HIDE_AFTER_MS later.

export const HIDE_AFTER_MS = 7000;

const HIDDEN = Object.freeze({ phase: 'hidden', user: '', reward: '' });

export class SpinDisplay {
  #state = HIDDEN;
  #timer = null;
  #onChange;

  constructor({ onChange } = {}) {
    this.#onChange = onChange ?? (() => {});
  }

  get state() {
    return this.#state;
  }

  start(user) {
    this.#clearTimer();
    this.#set({ phase: 'spinning', user, reward: '' });
  }

  finish(reward = '') {
    if (this.#state.phase !== 'spinning') return;
    this.#set({ phase: 'done', user: this.#state.user, reward });
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#set(HIDDEN);
    }, HIDE_AFTER_MS);
  }

  #clearTimer() {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  #set(state) {
    this.#state = state;
    this.#onChange(state);
  }
}

// The whole slot machine is only on screen from the start of a spin until the
// name hides again.
export function machineVisible(state) {
  return state.phase !== 'hidden';
}

export function nameView(state) {
  switch (state.phase) {
    case 'spinning':
      return { visible: true, text: state.user, className: 'name spinning' };
    case 'done':
      return { visible: true, text: `${state.user} ✓`, className: 'name done' };
    default:
      return { visible: false, text: '', className: 'name' };
  }
}
