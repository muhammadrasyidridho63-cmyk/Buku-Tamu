/**
 * ============================================================================
 * SI-BUKU TAMU (E-Tamu PTUN) — MODUL PWA (Service Worker & Install Prompt)
 * ============================================================================
 * Mengelola:
 * 1. Registrasi Service Worker (./sw.js) untuk GitHub Pages
 * 2. Tombol "Pasang Aplikasi" (Add to Home Screen / beforeinstallprompt)
 * 3. Indikator status Offline/Online di antarmuka
 * ============================================================================
 */
(function () {
  let deferredInstallPrompt = null;

  // 1. Daftarkan Service Worker (path relatif ./ wajib untuk GitHub Pages)
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      // Lewati registrasi jika dibuka langsung via file://
      if (window.location.protocol === 'file:') return;
      navigator.serviceWorker
        .register('./sw.js')
        .then(function (reg) {
          console.log('[PWA] Service Worker aktif:', reg.scope);
          reg.addEventListener('updatefound', function () {
            const newWorker = reg.installing;
            if (!newWorker) return;
            newWorker.addEventListener('statechange', function () {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('[PWA] Versi baru tersedia di latar belakang.');
              }
            });
          });
        })
        .catch(function (err) {
          console.warn('[PWA] Gagal mendaftarkan Service Worker:', err);
        });
    });
  }

  function toggleInstallButtons(show) {
    const ids = ['btn-pwa-install', 'btn-pwa-install-sidebar'];
    ids.forEach(function (id) {
      const el = document.getElementById(id);
      if (!el) return;
      if (show) el.classList.remove('hidden');
      else el.classList.add('hidden');
    });
  }

  // 2. Tangkap event beforeinstallprompt (Chrome / Edge / Android)
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredInstallPrompt = e;
    toggleInstallButtons(true);
  });

  window.addEventListener('appinstalled', function () {
    deferredInstallPrompt = null;
    toggleInstallButtons(false);
    console.log('[PWA] Aplikasi berhasil dipasang ke perangkat.');
  });

  async function triggerInstall() {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    try {
      const choice = await deferredInstallPrompt.userChoice;
      if (choice && choice.outcome === 'accepted') {
        toggleInstallButtons(false);
      }
    } catch (e) {}
    deferredInstallPrompt = null;
  }

  // 3. Banner Status Koneksi Offline/Online
  function updateOnlineBanner() {
    const banner = document.getElementById('pwa-offline-banner');
    if (!banner) return;
    if (navigator.onLine) {
      banner.classList.add('hidden');
    } else {
      banner.classList.remove('hidden');
    }
  }

  window.addEventListener('DOMContentLoaded', function () {
    const btnTop = document.getElementById('btn-pwa-install');
    const btnSide = document.getElementById('btn-pwa-install-sidebar');
    if (btnTop) btnTop.addEventListener('click', triggerInstall);
    if (btnSide) btnSide.addEventListener('click', triggerInstall);

    updateOnlineBanner();
    window.addEventListener('online', updateOnlineBanner);
    window.addEventListener('offline', updateOnlineBanner);
  });

  window.ETamuPWA = {
    install: triggerInstall,
    isInstallable: function () { return !!deferredInstallPrompt; }
  };
})();
