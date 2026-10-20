import {describe, it, expect} from 'vitest';
import fs from 'fs';
import path from 'path';

describe('PWA & Offline Configuration', () => {
  it('includes theme-color and apple-touch-icon in index.html', () => {
    const indexPath = path.resolve(process.cwd(), 'index.html');
    const html = fs.readFileSync(indexPath, 'utf-8');

    expect(html).toContain('<meta name="theme-color" content="#fcf9f3" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/icon.png" />');
  });

  it('prunes VitePWA from vite.config.ts and serves self-unregistering SW in server.ts', () => {
    const viteConfigPath = path.resolve(process.cwd(), 'vite.config.ts');
    const config = fs.readFileSync(viteConfigPath, 'utf-8');
    expect(config).not.toContain('vite-plugin-pwa');

    const serverPath = path.resolve(process.cwd(), 'server.ts');
    const serverCode = fs.readFileSync(serverPath, 'utf-8');
    expect(serverCode).toContain('SELF_DESTROYING_SW');
    expect(serverCode).toContain("'/sw.js'");
  });
});
