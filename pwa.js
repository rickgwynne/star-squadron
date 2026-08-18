(() => {
  'use strict';
  const installButton = document.querySelector('#installButton');
  const installPanel = document.querySelector('#installPanel');
  const closeButton = document.querySelector('#closeInstallButton');
  const appExitButton = document.querySelector('#appExitButton');
  const exitPanel = document.querySelector('#exitPanel');
  const closeExitButton = document.querySelector('#closeExitButton');
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  let installPrompt = null;

  if ('serviceWorker' in navigator) {
    addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(() => {}));
  }

  if (standalone) installButton.classList.add('hidden');
  addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; });

  installButton.addEventListener('click', async () => {
    if (installPrompt) {
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
    } else {
      installPanel.classList.remove('hidden');
    }
  });
  closeButton.addEventListener('click', () => installPanel.classList.add('hidden'));
  installPanel.addEventListener('click', event => { if (event.target === installPanel) installPanel.classList.add('hidden'); });
  appExitButton.addEventListener('click', () => {
    window.close();
    setTimeout(() => { if (!document.hidden) exitPanel.classList.remove('hidden'); }, 120);
  });
  closeExitButton.addEventListener('click', () => exitPanel.classList.add('hidden'));
  exitPanel.addEventListener('click', event => { if (event.target === exitPanel) exitPanel.classList.add('hidden'); });
  addEventListener('appinstalled', () => installButton.classList.add('hidden'));
})();
