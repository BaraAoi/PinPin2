import { App } from './app';

declare global {
  interface Window {
    pinpin?: App;
  }
}

function boot(): void {
  const app = new App();
  window.pinpin = app;
  void app.start();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
