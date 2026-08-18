(() => {
  'use strict';
  const installButton = document.querySelector('#installButton');
  const installPanel = document.querySelector('#installPanel');
  const closeButton = document.querySelector('#closeInstallButton');
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
  addEventListener('appinstalled', () => installButton.classList.add('hidden'));
})();
