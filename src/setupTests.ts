import {vi} from 'vitest';
import '@testing-library/jest-dom';

window.scrollTo = vi.fn();

Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
  configurable: true,
  get() {
    return () => Promise.resolve();
  },
});
