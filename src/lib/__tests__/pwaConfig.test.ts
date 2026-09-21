import {describe, it, expect} from 'vitest';
import fs from 'fs';
import path from 'path';

describe('PWA & Offline Configuration', () => {
  it('includes manifest and theme-color in index.html', () => {
    const indexPath = path.resolve(process.cwd(), 'index.html');
    const html = fs.readFileSync(indexPath, 'utf-8');

    expect(html).toContain(
      '<link rel="manifest" href="/manifest.webmanifest" />',
    );
    expect(html).toContain('<meta name="theme-color" content="#fcf9f3" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/icon.png" />');
  });

  it('configures VitePWA in vite.config.ts with devOptions and workbox runtime caching', () => {
    const viteConfigPath = path.resolve(process.cwd(), 'vite.config.ts');
    const config = fs.readFileSync(viteConfigPath, 'utf-8');

    expect(config).toContain('devOptions:');
    expect(config).toContain('enabled: true');
    expect(config).toContain("start_url: '/'");
    expect(config).toContain("display: 'standalone'");
    expect(config).toContain('google-books-covers');
    expect(config).toContain('openlibrary-covers');
    expect(config).toContain('wikimedia-covers');
  });
});
