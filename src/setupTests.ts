import {vi, beforeAll, afterEach, afterAll} from 'vitest';
import '@testing-library/jest-dom';
import {server} from './mocks/server';

beforeAll(() => server.listen({onUnhandledRequest: 'bypass'}));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

window.scrollTo = vi.fn();

Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
  configurable: true,
  get() {
    return () => Promise.resolve();
  },
});
