/**
 * ============================================================================
 * SI-BUKU TAMU (E-Tamu PTUN) — CONTROLLER SPA UTAMA (app.js)
 * ============================================================================
 * - Zero-delay tab switching (0ms) & SWR Cache
 * - Optimistic UI untuk aksi petugas (Panggil / Selesai / Check-out)
 * - Adaptive Visibility-Aware Polling (15s aktif -> 60s diam -> pause hidden)
 * - Webcam Capture terkompresi (Canvas max 640px JPEG 0.7)
 * - Ekspor Excel (.csv UTF-8 BOM) & Cetak Rekap PDF
 * ============================================================================
 */
window.AppUI = (function () {
  const state = {
    view: 'kiosk',
    boot: null,
    pantau: null,
    pantauMode: 'PTSP',
    pantauFilter: 'ALL',
    pantauSearch: '',
    dash: null,
    activeTiket: null,
    ptspLoket: 'e-Court',
    ptspFoto: '',
    sidangPeran: 'Penggugat',
    sidangPerkara: '',
    sidangFoto: '',
    countdownTimer: null,
    countdownSec: 30,
    lastActivity: Date.now(),
    pollTimer: null,
    charts: { tren: null, dist: null },
    pendingRedirectView: null,
    camTarget: null,
    camStream: null,
    pendingLogoBase64: ''
  };

  const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const DEFAULT_LOKET_PTSP = [
    { kode: 'e-Court', nama: 'Loket e-Court', badge: 'LOKET 1', deskripsi: 'Pendaftaran perkara online, e-Filing & aktivasi akun.' },
    { kode: 'Informasi', nama: 'Informasi & Posbakum', badge: 'LOKET 2', deskripsi: 'Informasi publik, PPID & layanan konsultasi hukum.' },
    { kode: 'Hukum', nama: 'Kepaniteraan Hukum', badge: 'LOKET 3', deskripsi: 'Legalisasi surat kuasa, surat keterangan & salinan putusan.' },
    { kode: 'Umum', nama: 'Umum & Kesekretariatan', badge: 'LOKET 4', deskripsi: 'Surat masuk/keluar, kepegawaian & audiensi kedinasan.' }
  ];
  const DEFAULT_PERAN_SIDANG = [
    { nama: 'Penggugat', keterangan: 'Pihak Utama' },
    { nama: 'Tergugat', keterangan: 'Instansi / Pejabat' },
    { nama: 'Turut Tergugat', keterangan: 'Pihak Terkait' },
    { nama: 'Kuasa Hukum', keterangan: 'Advokat / Jaksa TUN' },
    { nama: 'Saksi', keterangan: 'Fakta / Kejadian' },
    { nama: 'Ahli', keterangan: 'Keterangan Khusus' }
  ];
  const DEFAULT_RUANG_SIDANG = [
    { nama: 'Ruang Sidang Utama (Kartika)', keterangan: 'Lantai 1' },
    { nama: 'Ruang Sidang II (Tirta)', keterangan: 'Lantai 1' },
    { nama: 'Ruang Sidang III (Candra)', keterangan: 'Lantai 2' },
    { nama: 'Ruang Pemeriksaan Persiapan / Mediasi', keterangan: 'Lantai 1' }
  ];

  function getRuangSidangList() {
    const raw = state.boot && state.boot.pengaturan && state.boot.pengaturan.RUANG_SIDANG_JSON;
    if (raw) {
      try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (Array.isArray(parsed) && parsed.length) return parsed;
      } catch (e) {}
    }
    return DEFAULT_RUANG_SIDANG.slice();
  }

  function setSelectValueSafe(sel, val) {
    if (!sel || !val) return;
    const exists = Array.prototype.some.call(sel.options, function (o) { return o.value === val; });
    if (!exists) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = val;
      sel.appendChild(opt);
    }
    sel.value = val;
  }

  function renderRuangSidangSelects() {
    const list = getRuangSidangList();
    ['jdw-ruang', 'mps-select-ruang'].forEach(function (id) {
      const sel = document.getElementById(id);
      if (!sel) return;
      const prev = sel.value;
      sel.innerHTML = list.map(function (r) {
        const label = r.keterangan ? (r.nama + ' — ' + r.keterangan) : r.nama;
        return '<option value="' + esc(r.nama) + '">' + esc(label) + '</option>';
      }).join('');
      if (prev && list.some(function (r) { return r.nama === prev; })) {
        sel.value = prev;
      } else if (list.length) {
        sel.value = list[0].nama;
      }
    });
  }

  function getPeranSidangList() {
    const raw = state.boot && state.boot.pengaturan && state.boot.pengaturan.PERAN_SIDANG_JSON;
    if (raw) {
      try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (Array.isArray(parsed) && parsed.length) return parsed;
      } catch (e) {}
    }
    return DEFAULT_PERAN_SIDANG.slice();
  }

  function renderKioskPeranPills() {
    const box = document.getElementById('kiosk-peran-pills');
    if (!box) return;
    box.innerHTML = getPeranSidangList().map(function (p) {
      return '<span class="px-3 py-1.5 rounded-lg bg-surface-container-low text-xs font-medium text-on-surface">' + esc(p.nama) + '</span>';
    }).join('');
  }

  function renderSidangPeranGrid() {
    const grid = document.getElementById('sidang-peran-grid');
    if (!grid) return;
    const list = getPeranSidangList();
    const stillExists = list.some(function (p) { return p.nama === state.sidangPeran; });
    if (!stillExists && list.length) {
      state.sidangPeran = list[0].nama;
    }

    grid.innerHTML = list.map(function (p) {
      const active = p.nama === state.sidangPeran;
      return '<button type="button" data-peran="' + esc(p.nama) + '" class="peran-card p-3 rounded-xl border-2 text-left transition-all ' +
        (active ? 'bg-primary-container text-white border-primary-container shadow-sm' : 'bg-surface-container-low/60 text-on-surface border-transparent hover:border-outline-variant') + '">' +
        '<span class="block font-display font-bold text-sm">' + esc(p.nama) + '</span>' +
        '<span class="block text-[11px] ' + (active ? 'opacity-80' : 'text-on-surface-variant') + '">' + esc(p.keterangan || 'Pihak Persidangan') + '</span>' +
      '</button>';
    }).join('');

    grid.querySelectorAll('.peran-card').forEach(function (card) {
      card.onclick = function () {
        state.sidangPeran = card.getAttribute('data-peran');
        renderSidangPeranGrid();
      };
    });
  }

  function getLoketList() {
    const raw = state.boot && state.boot.pengaturan && state.boot.pengaturan.LOKET_PTSP_JSON;
    if (raw) {
      try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (Array.isArray(parsed) && parsed.length) return parsed;
      } catch (e) {}
    }
    return DEFAULT_LOKET_PTSP.slice();
  }

  function renderKioskLoketPills() {
    const box = document.getElementById('kiosk-loket-pills');
    if (!box) return;
    box.innerHTML = getLoketList().map(function (l) {
      return '<span class="px-3 py-1.5 rounded-lg bg-surface-container-low text-xs font-medium text-on-surface">' + esc(l.nama || l.kode) + '</span>';
    }).join('');
  }

  function renderPtspLoketGrid() {
    const grid = document.getElementById('ptsp-loket-grid');
    if (!grid) return;
    const list = getLoketList();
    const stillExists = list.some(function (l) { return l.kode === state.ptspLoket; });
    if (!stillExists && list.length) {
      state.ptspLoket = list[0].kode;
    }

    const selLabel = document.getElementById('ptsp-loket-terpilih');
    if (selLabel) selLabel.textContent = (state.ptspLoket || '-') + ' Terpilih';

    grid.innerHTML = list.map(function (l, idx) {
      const active = l.kode === state.ptspLoket;
      const badge = l.badge || ('LOKET ' + (idx + 1));
      return '<button type="button" data-loket="' + esc(l.kode) + '" class="loket-card text-left p-4 rounded-xl border-2 transition-all ' +
        (active ? 'bg-primary-container text-white border-primary-container shadow-sm' : 'bg-surface-container-low/60 text-on-surface border-transparent hover:border-outline-variant') + '">' +
        '<div class="flex items-center justify-between gap-2 mb-1">' +
          '<span class="font-display font-bold text-sm">' + esc(l.nama || l.kode) + '</span>' +
          '<span class="text-[10px] px-2 py-0.5 rounded font-bold shrink-0 ' + (active ? 'bg-secondary-container text-on-secondary-fixed' : 'bg-white text-outline') + '">' + esc(badge) + '</span>' +
        '</div>' +
        '<p class="text-xs ' + (active ? 'opacity-85' : 'text-on-surface-variant') + '">' + esc(l.deskripsi || 'Layanan loket ' + l.kode) + '</p>' +
      '</button>';
    }).join('');

    grid.querySelectorAll('.loket-card').forEach(function (card) {
      card.onclick = function () {
        state.ptspLoket = card.getAttribute('data-loket');
        renderPtspLoketGrid();
      };
    });
  }

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtJam(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ' WIB';
  }

  function fmtTglJam(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.getDate() + ' ' + BULAN[d.getMonth()] + ' ' + d.getFullYear() + ' • ' + fmtJam(iso);
  }

  function todayYmd() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function toast(message, type) {
    type = type || 'info';
    const colors = {
      success: 'bg-emerald-900 text-white border-emerald-700',
      error: 'bg-red-800 text-white border-red-600',
      warning: 'bg-amber-600 text-white border-amber-500',
      info: 'bg-primary-container text-white border-primary'
    };
    const icons = {
      success: 'check_circle',
      error: 'error',
      warning: 'warning',
      info: 'info'
    };
    const box = document.getElementById('toast-container');
    if (!box) return;
    const el = document.createElement('div');
    el.className = 'px-4 py-3 rounded-xl shadow-lg border text-xs sm:text-sm font-medium flex items-center gap-2.5 transition-all ' + (colors[type] || colors.info);
    el.innerHTML = '<span class="material-symbols-outlined text-[18px]">' + (icons[type] || 'info') + '</span><span>' + esc(message) + '</span>';
    box.appendChild(el);
    setTimeout(function () {
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 250);
    }, 3800);
  }

  // ==========================================================================
  // HELPER PERAN PETURGAS & MODE TATA LETAK (DUAL-MODE)
  // - Admin, Petugas PTSP, Petugas Sidang (Panitera), Satpam => Menu Samping (Sidebar) di SEMUA halaman
  // - Pengunjung Publik (Belum Login / Kiosk) => Menu Atas (Horizontal Navbar)
  // ==========================================================================
  function isStaffLoggedIn() {
    const u = window.ApiClient.getUser();
    if (!u) return false;
    const staffRoles = ['Admin', 'PTSP', 'Panitera', 'Satpam'];
    return staffRoles.indexOf(u.role) > -1 || u.username === 'admin' || !!u.role;
  }

  function updateLayoutMode() {
    const isStaff = isStaffLoggedIn();
    document.body.classList.toggle('is-staff-view', isStaff);
  }

  // ==========================================================================
  // NAVIGASI SPA INSTAN (0ms) & KONTROL HAK AKSES
  // ==========================================================================
  function goView(target) {
    const user = window.ApiClient.getUser();

    if (target === 'pantau') {
      if (!user) {
        state.pendingRedirectView = 'pantau';
        openLoginModal();
        return;
      }
    }

    if (target === 'dashboard') {
      if (!user) {
        state.pendingRedirectView = 'dashboard';
        openLoginModal();
        return;
      }
      if (user.role !== 'Admin') {
        toast('Dashboard & Laporan hanya dapat diakses oleh Administrator / Pimpinan.', 'warning');
        return;
      }
    }

    // Stop auto-reset countdown jika keluar dari tiket
    if (target !== 'tiket' && state.countdownTimer) {
      clearInterval(state.countdownTimer);
      state.countdownTimer = null;
    }

    state.view = target;
    const views = ['kiosk', 'ptsp', 'sidang', 'tiket', 'pantau', 'dashboard', 'display'];
    const mapId = {
      kiosk: 'view-kiosk',
      ptsp: 'view-form-ptsp',
      sidang: 'view-form-sidang',
      tiket: 'view-tiket',
      pantau: 'view-pantau',
      dashboard: 'view-dashboard',
      display: 'view-display'
    };

    views.forEach(function (v) {
      const el = document.getElementById(mapId[v]);
      if (el) el.classList.toggle('hidden', v !== target);
    });

    // Mode Tampilan Dual-Mode:
    // 1. Sidebar (Menu Kesamping) untuk Admin, Petugas PTSP, Petugas Sidang (Panitera), dan Satpam di SEMUA menu
    // 2. Navbar horizontal atas tetap untuk Pengunjung Publik (belum login)
    updateLayoutMode();
    closeSidebarMobile();

    // Update active state nav pills
    document.querySelectorAll('.nav-pill').forEach(function (b) {
      const active = b.getAttribute('data-nav') === target;
      b.className = active
        ? 'nav-pill px-3 py-1.5 rounded-lg text-xs font-bold bg-primary text-secondary-fixed shadow-inner transition-all'
        : 'nav-pill px-3 py-1.5 rounded-lg text-xs font-semibold text-primary-fixed-dim hover:text-white hover:bg-primary/50 transition-all';
    });
    document.querySelectorAll('.nav-pill-mob').forEach(function (b) {
      const active = b.getAttribute('data-nav') === target;
      b.className = active
        ? 'nav-pill-mob shrink-0 px-3 py-1 rounded-lg text-xs font-bold bg-secondary-container text-on-secondary-fixed'
        : 'nav-pill-mob shrink-0 px-3 py-1 rounded-lg text-xs font-semibold text-primary-fixed-dim';
    });

    // Update active state nav side buttons (Sidebar / Menu ke samping)
    document.querySelectorAll('.nav-side-btn').forEach(function (b) {
      const active = b.getAttribute('data-nav') === target;
      b.className = active
        ? 'nav-side-btn w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold bg-secondary-container text-on-secondary-fixed shadow-md transition-all text-left'
        : 'nav-side-btn w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold text-primary-fixed-dim hover:text-white hover:bg-white/10 transition-all text-left group';

      const icon = b.querySelector('.material-symbols-outlined');
      if (icon) {
        icon.className = active
          ? 'material-symbols-outlined text-[20px] text-on-secondary-fixed'
          : 'material-symbols-outlined text-[20px] text-secondary-fixed group-hover:scale-110 transition-transform';
      }
    });

    // Update topbar title
    const titleMap = {
      kiosk: 'Beranda',
      ptsp: 'Registrasi PTSP',
      sidang: 'Registrasi Sidang',
      tiket: 'Tiket Digital',
      pantau: 'Layar Pantau Petugas',
      dashboard: 'Dashboard & Laporan',
      display: 'Display Ruang Tunggu'
    };
    const topTitle = document.getElementById('topbar-view-title');
    if (topTitle) {
      topTitle.textContent = titleMap[target] || 'Beranda';
    }

    if (window.innerWidth < 1024) {
      closeSidebarMobile();
    }

    if (target === 'kiosk') {
      initDisplayView();
      renderDisplayQueue(false);
    } else if (target === 'display') {
      initDisplayView();
      renderDisplayQueue(false);
    } else {
      // Hentikan suara dan video pada kedua iframe saat keluar dari halaman display/kiosk
      ['kiosk-yt-iframe', 'display-yt-iframe'].forEach(function (id) {
        const iframe = document.getElementById(id);
        if (iframe && iframe.contentWindow) {
          try {
            iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), '*');
            iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'mute', args: [] }), '*');
          } catch (e) {}
        }
      });
    }

    if (target === 'sidang') renderJadwalOptions();
    if (target === 'tiket') renderTiketView();
    if (target === 'pantau') loadPantauData(true);
    if (target === 'dashboard') loadDashboardData();

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ==========================================================================
  // BOOTSTRAP & LIVE CLOCK
  // ==========================================================================
  function startClock() {
    const tick = function () {
      const d = new Date();
      const jam = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
      const tgl = d.getDate() + ' ' + BULAN[d.getMonth()] + ' ' + d.getFullYear();
      const el = document.getElementById('live-clock');
      if (el) el.textContent = jam + ' WIB • ' + tgl;

      const kd = document.getElementById('kiosk-date-label');
      if (kd) kd.textContent = HARI[d.getDay()] + ', ' + tgl;

      const dClock = document.getElementById('display-clock-jumbo');
      if (dClock) dClock.textContent = jam + ' WIB';

      const dDate = document.getElementById('display-date-label');
      if (dDate) dDate.textContent = HARI[d.getDay()] + ', ' + tgl;
    };
    tick();
    setInterval(tick, 1000);
  }

  function updateAuthChip() {
    const u = window.ApiClient.getUser();
    const initEl = document.getElementById('user-avatar-initials');
    const nameEl = document.getElementById('user-chip-name');
    const roleEl = document.getElementById('user-chip-role');
    const iconEl = document.getElementById('user-chip-icon');

    if (u) {
      initEl.textContent = (u.nama || u.username || 'P').charAt(0).toUpperCase();
      nameEl.textContent = u.nama || u.username;
      if (roleEl) {
        roleEl.textContent = u.role + ' (Aktif)';
        roleEl.classList.remove('hidden');
      }
      iconEl.textContent = 'expand_more';
      document.getElementById('btn-auth-chip').title = 'Menu Akun: Edit Password / Keluar';
      const ddName = document.getElementById('dd-user-name');
      const ddRole = document.getElementById('dd-user-role');
      if (ddName) ddName.textContent = u.nama || u.username;
      if (ddRole) ddRole.textContent = '@' + u.username + ' • ' + u.role;
    } else {
      initEl.textContent = 'T';
      nameEl.textContent = 'Login';
      if (roleEl) {
        roleEl.textContent = '';
        roleEl.classList.add('hidden');
      }
      iconEl.textContent = 'lock';
      document.getElementById('btn-auth-chip').title = 'Login Petugas / Pimpinan';
      closeUserDropdown();
    }

    // Terapkan layout mode: Samping untuk Petugas/Admin, Atas untuk Pengunjung Publik
    updateLayoutMode();

    const btnAturRuang = document.getElementById('btn-shortcut-atur-ruang');
    if (btnAturRuang) {
      btnAturRuang.classList.toggle('hidden', !(u && u.role === 'Admin'));
    }
  }

  async function loadBootPublic(useCacheFirst) {
    if (useCacheFirst) {
      const cached = window.ApiClient.swrGet('bootPublic', 3600000);
      if (cached) applyBootData(cached);
    }
    const res = await window.ApiClient.call('bootPublic', {}, { swrKey: 'bootPublic' });
    if (res && res.success && res.data) {
      applyBootData(res.data);
    }
  }

  function applySatkerName(nama) {
    const clean = String(nama || '').trim();
    if (!clean) return;
    if (state.boot && state.boot.pengaturan) {
      state.boot.pengaturan.NAMA_SATKER = clean;
    }
    ['hero-satker-name', 'nav-satker-subtitle', 'sidebar-satker-subtitle', 'dash-satker-name', 'footer-satker-name', 'tkt-satker-nama', 'display-satker-name'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.textContent = clean;
    });
    const dashInp = document.getElementById('dash-nama-pengadilan');
    if (dashInp && document.activeElement !== dashInp) dashInp.value = clean;
    const cfgInp = document.getElementById('cfg-nama');
    if (cfgInp && document.activeElement !== cfgInp) cfgInp.value = clean;
    document.title = 'SI-BUKU TAMU — ' + clean;
  }

  const DEFAULT_LOGO_URL = 'img/logo-mahkamah-agung.svg';
  const DEFAULT_LOGO_FALLBACK = 'https://upload.wikimedia.org/wikipedia/commons/9/98/Insignia_of_the_Supreme_Court_of_the_Republic_of_Indonesia.svg';
  const DEFAULT_LOGO_HTML = '<img src="' + DEFAULT_LOGO_URL + '" alt="Logo Mahkamah Agung" class="w-full h-full object-contain p-0.5" onerror="this.onerror=null;this.src=\'' + DEFAULT_LOGO_FALLBACK + '\';" />';

  function applySatkerLogo(url) {
    const clean = String(url || '').trim();
    if (state.boot && state.boot.pengaturan) {
      state.boot.pengaturan.LOGO_URL = clean;
    }

    const navBox = document.getElementById('nav-logo-box');
    const sideBox = document.getElementById('sidebar-logo-box');
    const kioskBox = document.getElementById('kiosk-satker-logo');
    const dispBox = document.getElementById('display-satker-logo');
    const tktBox = document.getElementById('tkt-logo-box');
    const prevBox = document.getElementById('cfg-logo-preview');
    const urlInp = document.getElementById('cfg-logo-url');

    if (urlInp && document.activeElement !== urlInp) {
      urlInp.value = clean.indexOf('data:image') === 0 ? '' : clean;
    }

    const effectiveUrl = clean || DEFAULT_LOGO_URL;

    const renderImg = function (box) {
      if (!box) return;
      box.innerHTML = '';
      const img = document.createElement('img');
      img.src = effectiveUrl;
      img.alt = 'Logo Pengadilan';
      img.className = 'w-full h-full object-contain p-0.5';
      img.onerror = function () {
        if (img.src !== DEFAULT_LOGO_FALLBACK) {
          img.src = DEFAULT_LOGO_FALLBACK;
        } else {
          box.innerHTML = '<span class="material-symbols-outlined text-secondary-fixed">account_balance</span>';
        }
      };
      box.appendChild(img);
    };

    [navBox, sideBox, kioskBox, dispBox, prevBox, tktBox].forEach(function (box) {
      renderImg(box);
    });

    // Update favicon
    let fav = document.querySelector('link[rel="icon"]');
    if (!fav) {
      fav = document.createElement('link');
      fav.rel = 'icon';
      fav.type = 'image/svg+xml';
      document.head.appendChild(fav);
    }
    fav.href = effectiveUrl;
  }

  function applyBootData(d) {
    state.boot = d;
    const cfg = d.pengaturan || {};
    const ring = d.ringkasan || {};
    const jadwal = d.jadwalHariIni || [];

    if (cfg.NAMA_SATKER) {
      applySatkerName(cfg.NAMA_SATKER);
    }
    applySatkerLogo(cfg.LOGO_URL || '');
    if (cfg.JAM_LAYANAN) {
      const jl = document.getElementById('kiosk-jam-layanan');
      if (jl) jl.textContent = cfg.JAM_LAYANAN;
    }

    document.getElementById('kiosk-ptsp-berjalan').textContent = ring.ptspBerjalan || 'P-000';
    document.getElementById('kiosk-ptsp-menunggu').textContent = (ring.ptspMenunggu || 0) + ' Orang';
    document.getElementById('kiosk-sidang-count').textContent = jadwal.length + ' Perkara';
    document.getElementById('kiosk-sidang-next').textContent = ring.sidangBerikutnya || 'S-001';
    document.getElementById('kiosk-stat-total').textContent = (ring.totalHariIni || 0) + ' Terdaftar';
    document.getElementById('kiosk-stat-ptsp').textContent = (ring.ptspTotal || 0) + ' Orang';
    document.getElementById('kiosk-stat-sidang').textContent = (ring.sidangTotal || 0) + ' Orang';
    document.getElementById('kiosk-stat-selesai').textContent = (ring.totalSelesai || 0) + ' Orang';

    const nextPtsp = ring.ptspBerikutnya || 'P-001';
    const nextSidang = ring.sidangBerikutnya || 'S-001';
    document.getElementById('ptsp-next-badge').textContent = nextPtsp;
    document.getElementById('btn-ptsp-submit-label').textContent = 'Terbitkan Tiket Antrean (' + nextPtsp + ')';
    document.getElementById('btn-sidang-submit-label').textContent = 'Konfirmasi Kehadiran (' + nextSidang + ')';

    if (d.struk) {
      window.StrukPrinter.pasang({
        templates: d.struk.templates || [],
        server: d.struk.printer || {}
      });
    }

    renderKioskLoketPills();
    renderPtspLoketGrid();
    renderKioskPeranPills();
    renderSidangPeranGrid();
    renderRuangSidangSelects();
    if (state.view === 'sidang') renderJadwalOptions();
    if (state.view === 'pantau') renderPantau();
    renderDisplayQueue(false);
  }

  // ==========================================================================
  // FORM REGISTRASI PTSP & SIDANG (TANPA NIK) + KAMERA TERKOMPRESI
  // ==========================================================================
  function formatNomorWaInput(raw) {
    let digits = String(raw || '').replace(/\D/g, '');
    if (digits.indexOf('628') === 0) digits = digits.slice(2);
    else if (digits.indexOf('0') === 0) digits = digits.replace(/^0+/, '');
    digits = digits.slice(0, 13);
    if (digits.length <= 3) return digits;
    if (digits.length <= 7) return digits.slice(0, 3) + '-' + digits.slice(3);
    return digits.slice(0, 3) + '-' + digits.slice(3, 7) + '-' + digits.slice(7);
  }

  function normalisasiNoHpSubmit(raw) {
    let digits = String(raw || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.indexOf('62') === 0 && digits.length > 9) digits = '0' + digits.slice(2);
    else if (digits.indexOf('0') !== 0) digits = '0' + digits;
    return digits;
  }

  function bindInputNomorWa(el) {
    if (!el) return;
    el.addEventListener('input', function () {
      const formatted = formatNomorWaInput(el.value);
      if (el.value !== formatted) {
        el.value = formatted;
      }
    });
  }

  function initForms() {
    // Render & pasang klik kartu Loket PTSP, Peran Sidang & Dropdown Ruang Sidang dinamis
    renderKioskLoketPills();
    renderPtspLoketGrid();
    renderKioskPeranPills();
    renderSidangPeranGrid();
    renderRuangSidangSelects();

    // Format otomatis penulisan nomor WhatsApp / HP (812-3456-7890)
    bindInputNomorWa(document.getElementById('ptsp-hp'));
    bindInputNomorWa(document.getElementById('sidang-hp'));

    // Pencarian Jadwal Sidang
    const cariPerkara = document.getElementById('sidang-cari-perkara');
    cariPerkara.oninput = function () {
      state.sidangPerkara = cariPerkara.value;
      renderJadwalOptions();
    };

    // Reset Form PTSP
    document.getElementById('btn-ptsp-reset').onclick = function () {
      document.getElementById('form-ptsp').reset();
      state.ptspFoto = '';
      updateFotoPreview('ptsp', '');
    };

    // Submit PTSP
    document.getElementById('form-ptsp').onsubmit = async function (e) {
      e.preventDefault();
      const nama = document.getElementById('ptsp-nama').value.trim();
      const instansi = document.getElementById('ptsp-instansi').value.trim();
      const noHp = document.getElementById('ptsp-hp').value.trim();
      const keperluan = document.getElementById('ptsp-keperluan').value.trim();

      const errNama = document.getElementById('err-ptsp-nama');
      const errInst = document.getElementById('err-ptsp-instansi');
      errNama.classList.add('hidden');
      errInst.classList.add('hidden');

      let valid = true;
      if (!nama) {
        errNama.textContent = 'Nama lengkap wajib diisi.';
        errNama.classList.remove('hidden');
        valid = false;
      }
      if (!instansi) {
        errInst.textContent = 'Asal instansi atau tulis "Pribadi" wajib diisi.';
        errInst.classList.remove('hidden');
        valid = false;
      }
      if (!valid) return;

      const btn = document.getElementById('btn-ptsp-submit');
      btn.disabled = true;
      btn.classList.add('opacity-70');

      const user = window.ApiClient.getUser();
      const action = user ? 'ptsp.daftarPetugas' : 'daftarPtsp';
      const res = await window.ApiClient.call(action, {
        nama: nama,
        instansi: instansi,
        noHp: normalisasiNoHpSubmit(noHp),
        loket: state.ptspLoket,
        keperluan: keperluan,
        fotoBase64: state.ptspFoto
      });

      btn.disabled = false;
      btn.classList.remove('opacity-70');

      if (!res || !res.success) {
        toast((res && res.message) || 'Gagal menyimpan registrasi PTSP.', 'error');
        return;
      }

      toast('Tiket antrean ' + res.data.Nomor_Antrean + ' berhasil diterbitkan!', 'success');
      state.activeTiket = res.data;
      document.getElementById('form-ptsp').reset();
      state.ptspFoto = '';
      updateFotoPreview('ptsp', '');
      loadBootPublic(false);
      goView('tiket');
    };

    // Submit Sidang
    document.getElementById('form-sidang').onsubmit = async function (e) {
      e.preventDefault();
      const nama = document.getElementById('sidang-nama').value.trim();
      const noHp = document.getElementById('sidang-hp').value.trim();
      const nomorPerkara = document.getElementById('sidang-cari-perkara').value.trim();
      const agendaSidang = document.getElementById('sidang-agenda') ? document.getElementById('sidang-agenda').value.trim() : '';

      const errNama = document.getElementById('err-sidang-nama');
      const errPerkara = document.getElementById('err-sidang-perkara');
      const errAgenda = document.getElementById('err-sidang-agenda');
      errNama.classList.add('hidden');
      errPerkara.classList.add('hidden');
      if (errAgenda) errAgenda.classList.add('hidden');

      let valid = true;
      if (!nama) {
        errNama.textContent = 'Nama lengkap wajib diisi.';
        errNama.classList.remove('hidden');
        valid = false;
      }
      if (!nomorPerkara) {
        errPerkara.textContent = 'Nomor perkara persidangan wajib diisi.';
        errPerkara.classList.remove('hidden');
        valid = false;
      }
      if (!agendaSidang) {
        if (errAgenda) {
          errAgenda.textContent = 'Agenda sidang wajib diisi.';
          errAgenda.classList.remove('hidden');
        }
        valid = false;
      }
      if (!valid) return;

      const btn = document.getElementById('btn-sidang-submit');
      btn.disabled = true;
      btn.classList.add('opacity-70');

      const user = window.ApiClient.getUser();
      const action = user ? 'sidang.daftarPetugas' : 'daftarSidang';
      const res = await window.ApiClient.call(action, {
        nama: nama,
        noHp: normalisasiNoHpSubmit(noHp),
        peran: state.sidangPeran,
        nomorPerkara: nomorPerkara,
        ruangSidang: 'Belum Ditentukan',
        agenda: agendaSidang,
        fotoBase64: state.sidangFoto
      });

      btn.disabled = false;
      btn.classList.remove('opacity-70');

      if (!res || !res.success) {
        toast((res && res.message) || 'Gagal mengonfirmasi kehadiran sidang.', 'error');
        return;
      }

      toast('Kehadiran Sidang ' + res.data.Nomor_Antrean + ' berhasil dicatat!', 'success');
      state.activeTiket = res.data;
      document.getElementById('form-sidang').reset();
      state.sidangPerkara = '';
      state.sidangFoto = '';
      updateFotoPreview('sidang', '');
      loadBootPublic(false);
      goView('tiket');
    };

    // Kamera handlers
    document.getElementById('btn-ptsp-kamera').onclick = function () { openKamera('ptsp'); };
    document.getElementById('btn-sidang-kamera').onclick = function () { openKamera('sidang'); };
    document.getElementById('btn-ptsp-hapus-foto').onclick = function () { state.ptspFoto = ''; updateFotoPreview('ptsp', ''); };
    document.getElementById('btn-sidang-hapus-foto').onclick = function () { state.sidangFoto = ''; updateFotoPreview('sidang', ''); };
    document.getElementById('btn-close-kamera').onclick = closeKamera;
    document.getElementById('btn-jepret').onclick = captureKamera;
  }

  function renderJadwalOptions() {
    const listEl = document.getElementById('sidang-jadwal-list');
    if (!listEl) return;
    const badgeEl = document.getElementById('sidang-jadwal-badge');
    if (badgeEl) badgeEl.textContent = '';
    const jadwal = (state.boot && state.boot.jadwalHariIni) ? state.boot.jadwalHariIni : [];
    const q = String(document.getElementById('sidang-cari-perkara').value || '').toLowerCase().trim();

    const filtered = jadwal.filter(function (j) {
      return !q || String(j.Nomor_Perkara).toLowerCase().indexOf(q) > -1 || String(j.Agenda).toLowerCase().indexOf(q) > -1;
    });

    if (!filtered.length) {
      listEl.innerHTML = '<div class="p-3 rounded-xl bg-surface-container-low text-xs text-on-surface-variant flex items-center gap-2"><span class="material-symbols-outlined text-outline text-[18px]">edit_note</span>Silakan isi nomor perkara persidangan secara manual pada kolom di atas (contoh: 24/G/2026/PTUN.PLG).</div>';
      return;
    }

    listEl.innerHTML = filtered.map(function (j) {
      const selected = String(state.sidangPerkara).trim() === String(j.Nomor_Perkara).trim();
      return '<button type="button" data-perkara="' + esc(j.Nomor_Perkara) + '" data-ruang="' + esc(j.Ruang_Sidang) + '" data-agenda="' + esc(j.Agenda) + '" class="jadwal-opt w-full text-left p-3.5 rounded-xl border transition-all ' + (selected ? 'bg-primary-container text-white border-primary-container shadow-sm' : 'bg-surface-container-low/50 hover:bg-surface-container-low border-outline-variant/50') + '">' +
        '<div class="flex items-center justify-between gap-2">' +
        '  <span class="font-display font-bold text-sm">' + esc(j.Nomor_Perkara) + '</span>' +
        '  <span class="text-[11px] px-2 py-0.5 rounded-full font-semibold ' + (selected ? 'bg-secondary-container text-on-secondary-fixed' : 'bg-white text-primary-container') + '">' + esc(j.Ruang_Sidang) + '</span>' +
        '</div>' +
        '<div class="text-xs mt-1 ' + (selected ? 'text-primary-fixed-dim' : 'text-on-surface-variant') + '">' + esc(j.Agenda || 'Persidangan Umum') + '</div>' +
      '</button>';
    }).join('');

    listEl.querySelectorAll('.jadwal-opt').forEach(function (b) {
      b.onclick = function () {
        const np = b.getAttribute('data-perkara');
        const rs = b.getAttribute('data-ruang');
        const ag = b.getAttribute('data-agenda');
        state.sidangPerkara = np;
        document.getElementById('sidang-cari-perkara').value = np;
        const sr = document.getElementById('sidang-ruang');
        if (sr) setSelectValueSafe(sr, rs);
        const agInp = document.getElementById('sidang-agenda');
        if (agInp) agInp.value = ag || '';
        renderJadwalOptions();
      };
    });
  }

  async function openKamera(target) {
    state.camTarget = target;
    const modal = document.getElementById('modal-kamera');
    const video = document.getElementById('kamera-video');
    modal.classList.remove('hidden');
    try {
      state.camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } }, audio: false });
      video.srcObject = state.camStream;
    } catch (e) {
      toast('Kamera tidak tersedia atau izin ditolak: ' + e.message, 'warning');
      closeKamera();
    }
  }

  function closeKamera() {
    document.getElementById('modal-kamera').classList.add('hidden');
    if (state.camStream) {
      state.camStream.getTracks().forEach(function (t) { t.stop(); });
      state.camStream = null;
    }
  }

  function captureKamera() {
    const video = document.getElementById('kamera-video');
    if (!video.videoWidth) return;
    const canvas = document.createElement('canvas');
    const maxW = 640;
    const scale = Math.min(1, maxW / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);

    if (state.camTarget === 'ptsp') {
      state.ptspFoto = dataUrl;
      updateFotoPreview('ptsp', dataUrl);
    } else {
      state.sidangFoto = dataUrl;
      updateFotoPreview('sidang', dataUrl);
    }
    closeKamera();
    toast('Foto berhasil diambil & dikompresi.', 'success');
  }

  function updateFotoPreview(target, dataUrl) {
    const box = document.getElementById(target + '-foto-preview');
    const delBtn = document.getElementById('btn-' + target + '-hapus-foto');
    if (dataUrl) {
      box.innerHTML = '<img src="' + dataUrl + '" alt="Foto" class="w-full h-full object-cover" />';
      delBtn.classList.remove('hidden');
    } else {
      box.innerHTML = '<span class="material-symbols-outlined text-outline">photo_camera</span>';
      delBtn.classList.add('hidden');
    }
  }

  // ==========================================================================
  // VIEW 4: TIKET DIGITAL & INTEGRASI PRINTER THERMAL
  // ==========================================================================
  function renderTiketView() {
    const t = state.activeTiket;
    const emptyEl = document.getElementById('tiket-empty-state');
    const wrapEl = document.getElementById('tiket-content-wrap');

    if (!t) {
      emptyEl.classList.remove('hidden');
      wrapEl.classList.add('hidden');
      return;
    }
    emptyEl.classList.add('hidden');
    wrapEl.classList.remove('hidden');

    const cfg = (state.boot && state.boot.pengaturan) ? state.boot.pengaturan : {};
    const isPtsp = t.jalur === 'PTSP' || String(t.ID_Tiket).indexOf('PTSP-') === 0;

    const ruangText = (t.Ruang_Sidang && t.Ruang_Sidang !== 'Belum Ditentukan' && t.Ruang_Sidang !== '-') ? (' (' + t.Ruang_Sidang + ')') : ' (Menunggu Panggilan Ruang)';
    document.getElementById('tkt-satker-nama').textContent = cfg.NAMA_SATKER || 'PENGADILAN TATA USAHA NEGARA';
    document.getElementById('tkt-satker-alamat').textContent = cfg.ALAMAT_SATKER || 'PTSP & Persidangan Terpadu';
    document.getElementById('tkt-nomor-antrean').textContent = t.Nomor_Antrean;
    document.getElementById('tkt-badge-tujuan').textContent = isPtsp
      ? ('LOKET PELAYANAN PTSP — ' + t.Loket_Tujuan)
      : ('PERSIDANGAN — ' + t.Peran_Sidang + ruangText);
    document.getElementById('tkt-nama').textContent = t.Nama_Lengkap;
    document.getElementById('tkt-label-meta').textContent = isPtsp ? 'Asal Instansi' : 'Nomor Perkara';
    document.getElementById('tkt-val-meta').textContent = isPtsp ? t.Asal_Instansi : t.Nomor_Perkara;
    document.getElementById('tkt-waktu').textContent = fmtTglJam(t.Waktu_Masuk);
    document.getElementById('tkt-status').textContent = isPtsp ? t.Status_Layanan : t.Status_Kehadiran;
    document.getElementById('tkt-id-code').textContent = 'KODE TIKET: ' + t.ID_Tiket;

    // QR Code Verifikasi HMAC
    const verifUrl = window.location.origin + window.location.pathname + '#verifikasi=' + encodeURIComponent(t.ID_Tiket) + '&sig=' + encodeURIComponent(t.Sig || '');
    const qrBox = document.getElementById('tkt-qr-box');
    if (typeof window.qrcode === 'function') {
      const qr = window.qrcode(0, 'M');
      qr.addData(verifUrl);
      qr.make();
      qrBox.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 1 });
    } else {
      qrBox.textContent = t.ID_Tiket;
    }

    const openStruk = function () {
      const dict = window.StrukEngine.dataTiketStruk(t, cfg);
      window.StrukUI.pratinjau({
        jenis: isPtsp ? 'PTSP' : 'SIDANG',
        data: dict,
        nomor: t.ID_Tiket,
        waNomor: t.No_HP
      });
    };

    document.getElementById('btn-tkt-cetak').onclick = openStruk;
    document.getElementById('btn-tkt-wa').onclick = function () {
      const dict = window.StrukEngine.dataTiketStruk(t, cfg);
      const tpl = window.StrukPrinter.getTemplateByJenis(isPtsp ? 'PTSP' : 'SIDANG');
      const lines = window.StrukEngine.parseLines((tpl && tpl.Isi_Direktif) || '', dict, 58);
      const msg = window.StrukEngine.renderWaText(lines);
      const hp = String(t.No_HP || '').replace(/[^\d]/g, '');
      const waHp = hp.indexOf('0') === 0 ? '62' + hp.slice(1) : hp;
      window.open(waHp ? 'https://wa.me/' + waHp + '?text=' + encodeURIComponent(msg) : 'https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
    };
    document.getElementById('btn-tkt-selesai').onclick = function () { goView('kiosk'); };

    // Countdown kembali ke Kiosk jika mode Kiosk publik
    if (state.countdownTimer) clearInterval(state.countdownTimer);
    if (!window.ApiClient.getUser()) {
      state.countdownSec = Number(cfg.AUTO_RESET_DETIK || 30);
      document.getElementById('tkt-countdown').textContent = state.countdownSec;
      state.countdownTimer = setInterval(function () {
        state.countdownSec--;
        const cdEl = document.getElementById('tkt-countdown');
        if (cdEl) cdEl.textContent = Math.max(0, state.countdownSec);
        if (state.countdownSec <= 0) {
          clearInterval(state.countdownTimer);
          state.countdownTimer = null;
          if (state.view === 'tiket') goView('kiosk');
        }
      }, 1000);
    } else {
      document.getElementById('tkt-countdown').textContent = '∞';
    }
  }

  // ==========================================================================
  // VIEW 5: LAYAR PANTAU PETUGAS REAL-TIME (OPTIMISTIC UI + TTS PANGGILAN)
  // ==========================================================================
  async function loadPantauData(showSkeletonIfEmpty) {
    const user = window.ApiClient.getUser();
    if (!user) return;

    // Default tab sesuai role
    if (!state.pantau && user.role) {
      if (user.role === 'Panitera') state.pantauMode = 'SIDANG';
      else if (user.role === 'Satpam') state.pantauMode = 'SATPAM';
      else state.pantauMode = 'PTSP';
    }

    const cached = window.ApiClient.swrGet('pantau_boot', 120000);
    if (cached && !state.pantau) {
      state.pantau = cached;
      renderPantau();
    } else if (showSkeletonIfEmpty && !state.pantau) {
      renderPantauSkeleton();
    }

    const res = await window.ApiClient.call('pantau.boot', { tanggal: todayYmd() }, { swrKey: 'pantau_boot' });
    if (res && res.success && res.data) {
      state.pantau = res.data;
      renderPantau();
    }
  }

  function renderPantauSkeleton() {
    const tbody = document.getElementById('pantau-tbody');
    if (!tbody) return;
    tbody.innerHTML = Array(4).fill(0).map(function () {
      return '<tr><td colspan="5" class="p-4"><div class="h-10 rounded-xl skeleton-shimmer"></div></td></tr>';
    }).join('');
  }

  function statusBadge(st) {
    if (st === 'Selesai') return '<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-primary-fixed text-on-primary-fixed">● Selesai</span>';
    if (st === 'Dilayani' || st === 'Masuk Ruang Sidang') return '<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800">● ' + esc(st) + '</span>';
    return '<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-secondary-fixed text-on-secondary-fixed-variant">● ' + esc(st) + '</span>';
  }

  function panggilSuara(teks, onEndCallback) {
    try {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utt = new SpeechSynthesisUtterance(teks);
        utt.lang = 'id-ID';
        utt.rate = 0.95;

        let callbackFired = false;
        const fireCallback = function () {
          if (!callbackFired) {
            callbackFired = true;
            if (typeof onEndCallback === 'function') onEndCallback();
          }
        };

        utt.onend = fireCallback;
        utt.onerror = fireCallback;

        // Fallback durasi aman jika event onend tidak terpicu
        const estimatedDuration = Math.max(3500, (String(teks || '').length * 85));
        setTimeout(fireCallback, estimatedDuration);

        window.speechSynthesis.speak(utt);
      } else {
        if (typeof onEndCallback === 'function') {
          setTimeout(onEndCallback, 3000);
        }
      }
    } catch (e) {
      if (typeof onEndCallback === 'function') onEndCallback();
    }
    toast('Memanggil: ' + teks, 'info');
  }

  function renderPantau() {
    if (!state.pantau) return;
    const ptsp = state.pantau.ptsp || [];
    const sidang = state.pantau.sidang || [];
    const jadwal = state.pantau.jadwal || [];

    // Update mode tab styles
    document.querySelectorAll('.pview-tab').forEach(function (b) {
      const m = b.getAttribute('data-pview');
      const active = m === state.pantauMode;
      b.className = active
        ? 'pview-tab px-4 py-2 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 bg-primary-container text-white shadow-sm'
        : 'pview-tab px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-2 text-on-surface-variant hover:bg-surface-container-low';
    });

    // KPIs
    const all = ptsp.concat(sidang);
    const menunggu = ptsp.filter(function (r) { return r.Status_Layanan === 'Menunggu'; }).length +
      sidang.filter(function (r) { return r.Status_Kehadiran === 'Hadir di Ruang Tunggu'; }).length;
    const dilayani = ptsp.filter(function (r) { return r.Status_Layanan === 'Dilayani'; }).length +
      sidang.filter(function (r) { return r.Status_Kehadiran === 'Masuk Ruang Sidang'; }).length;
    const selesai = ptsp.filter(function (r) { return r.Status_Layanan === 'Selesai'; }).length +
      sidang.filter(function (r) { return r.Status_Kehadiran === 'Selesai'; }).length;
    const digedung = all.filter(function (r) { return !r.Waktu_Keluar; }).length;

    document.getElementById('pt-kpi-menunggu').textContent = menunggu;
    document.getElementById('pt-kpi-dilayani').textContent = dilayani;
    document.getElementById('pt-kpi-selesai').textContent = selesai;
    document.getElementById('pt-kpi-digedung').textContent = digedung;

    // Filter chips
    const chipsBox = document.getElementById('pantau-filter-chips');
    let chips = [];
    if (state.pantauMode === 'PTSP') {
      chips = ['ALL'].concat(getLoketList().map(function (l) { return l.kode; }));
    } else if (state.pantauMode === 'SIDANG') {
      chips = ['ALL', 'Hadir di Ruang Tunggu', 'Masuk Ruang Sidang', 'Selesai'];
    } else {
      chips = ['ALL', 'BELUM_CHECKOUT', 'PTSP', 'SIDANG'];
    }
    if (chips.indexOf(state.pantauFilter) === -1) state.pantauFilter = 'ALL';

    chipsBox.innerHTML = chips.map(function (c) {
      const label = c === 'ALL' ? 'Semua' : (c === 'BELUM_CHECKOUT' ? 'Masih di Gedung' : c);
      const active = state.pantauFilter === c;
      return '<button type="button" data-fchip="' + esc(c) + '" class="fchip shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ' + (active ? 'bg-primary-container text-white border-primary-container' : 'bg-white text-on-surface-variant border-outline-variant hover:bg-surface-container-low') + '">' + esc(label) + '</button>';
    }).join('');

    chipsBox.querySelectorAll('.fchip').forEach(function (b) {
      b.onclick = function () {
        state.pantauFilter = b.getAttribute('data-fchip');
        renderPantau();
      };
    });

    // Source rows
    let rows = [];
    if (state.pantauMode === 'PTSP') rows = ptsp.slice();
    else if (state.pantauMode === 'SIDANG') rows = sidang.slice();
    else rows = all.slice();

    // Filter by chip & search
    const q = state.pantauSearch.toLowerCase().trim();
    rows = rows.filter(function (r) {
      if (state.pantauMode === 'PTSP' && state.pantauFilter !== 'ALL' && r.Loket_Tujuan !== state.pantauFilter) return false;
      if (state.pantauMode === 'SIDANG' && state.pantauFilter !== 'ALL' && r.Status_Kehadiran !== state.pantauFilter) return false;
      if (state.pantauMode === 'SATPAM') {
        if (state.pantauFilter === 'BELUM_CHECKOUT' && r.Waktu_Keluar) return false;
        if (state.pantauFilter === 'PTSP' && r.jalur !== 'PTSP') return false;
        if (state.pantauFilter === 'SIDANG' && r.jalur !== 'SIDANG') return false;
      }
      if (!q) return true;
      const hay = [r.Nomor_Antrean, r.ID_Tiket, r.Nama_Lengkap, r.Asal_Instansi, r.Loket_Tujuan, r.Nomor_Perkara, r.Peran_Sidang].join(' ').toLowerCase();
      return hay.indexOf(q) > -1;
    });

    document.getElementById('pantau-count-label').textContent = rows.length + ' Pengunjung Ditampilkan';
    const tbody = document.getElementById('pantau-tbody');

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="p-10 text-center text-on-surface-variant"><span class="material-symbols-outlined text-4xl text-outline block mb-2">inbox</span>Belum ada tamu pada filter ini.</td></tr>';
    } else {
      tbody.innerHTML = rows.map(function (r) {
        const isPtsp = r.jalur === 'PTSP';
        const status = isPtsp ? r.Status_Layanan : r.Status_Kehadiran;
        const subMeta = isPtsp ? esc(r.Asal_Instansi) : (esc(r.Peran_Sidang) + ' • ' + esc(r.No_HP || '-'));
        const hasRuang = r.Ruang_Sidang && r.Ruang_Sidang !== 'Belum Ditentukan' && r.Ruang_Sidang !== '-';
        const tujuan = isPtsp
          ? ('<div class="font-semibold text-on-surface">Loket ' + esc(r.Loket_Tujuan) + '</div><div class="text-xs text-on-surface-variant">' + esc(r.Keperluan || '-') + '</div>')
          : ('<div class="font-semibold text-on-surface">' + esc(r.Nomor_Perkara) + '</div>' +
             (hasRuang
               ? ('<div class="text-xs font-semibold text-primary-container flex items-center gap-1 mt-0.5"><span class="material-symbols-outlined text-[14px]">meeting_room</span>' + esc(r.Ruang_Sidang) + '</div>')
               : '<div class="mt-0.5"><span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200"><span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>Ruang Belum Ditentukan</span></div>')
            );

        let aksiHtml = '';
        if (isPtsp) {
          if (status === 'Menunggu') {
            aksiHtml += '<button type="button" data-act="layani" data-id="' + esc(r.ID_Tiket) + '" data-jalur="PTSP" class="act-btn px-3 h-9 rounded-lg bg-primary-container hover:bg-primary text-white text-xs font-bold">Panggil ke Loket</button>';
          } else if (status === 'Dilayani') {
            aksiHtml += '<button type="button" data-act="panggil" data-id="' + esc(r.ID_Tiket) + '" data-jalur="PTSP" class="act-btn px-2.5 h-9 rounded-lg border border-outline-variant bg-white hover:bg-surface-container-low text-xs font-semibold mr-1">Panggil Ulang</button>';
            aksiHtml += '<button type="button" data-act="selesai" data-id="' + esc(r.ID_Tiket) + '" data-jalur="PTSP" class="act-btn px-3 h-9 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold">Selesaikan</button>';
          }
        } else {
          if (status === 'Hadir di Ruang Tunggu') {
            aksiHtml += '<button type="button" data-act="masukSidang" data-id="' + esc(r.ID_Tiket) + '" data-jalur="SIDANG" class="act-btn px-3 h-9 rounded-lg bg-secondary-container hover:bg-secondary-fixed-dim text-on-secondary-fixed text-xs font-bold inline-flex items-center gap-1.5"><span class="material-symbols-outlined text-[16px]">campaign</span>Panggil Sidang</button>';
          } else if (status === 'Masuk Ruang Sidang') {
            aksiHtml += '<button type="button" data-act="masukSidang" data-id="' + esc(r.ID_Tiket) + '" data-jalur="SIDANG" class="act-btn px-2.5 h-9 rounded-lg border border-outline-variant bg-white hover:bg-surface-container-low text-xs font-semibold mr-1 inline-flex items-center gap-1" title="Panggil Ulang atau Ubah Ruang Sidang"><span class="material-symbols-outlined text-[15px]">campaign</span>Panggil / Ganti Ruang</button>';
            aksiHtml += '<button type="button" data-act="selesai" data-id="' + esc(r.ID_Tiket) + '" data-jalur="SIDANG" class="act-btn px-3 h-9 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold">Selesaikan</button>';
          }
        }
        if (!r.Waktu_Keluar) {
          aksiHtml += '<button type="button" data-act="checkout" data-id="' + esc(r.ID_Tiket) + '" data-jalur="' + esc(r.jalur) + '" class="act-btn ml-1 px-2.5 h-9 rounded-lg border border-outline-variant bg-white hover:bg-surface-container-low text-xs font-semibold" title="Catat Jam Keluar Gedung">Check-out</button>';
        } else {
          aksiHtml += '<span class="ml-2 text-xs text-outline">Keluar ' + fmtJam(r.Waktu_Keluar) + '</span>';
        }

        return '<tr class="hover:bg-surface-container-low/40 transition-colors">' +
          '<td class="py-3.5 px-4 align-top"><div class="font-display font-extrabold text-base ' + (isPtsp ? 'text-primary-container' : 'text-secondary') + '">' + esc(r.Nomor_Antrean) + '</div><div class="text-xs text-on-surface-variant">' + fmtJam(r.Waktu_Masuk) + '</div></td>' +
          '<td class="py-3.5 px-4 align-top"><div class="flex items-center gap-2.5">' + (r.Link_Foto ? '<img src="' + esc(r.Link_Foto) + '" class="w-9 h-9 rounded-full object-cover border border-outline-variant shrink-0" alt="Foto">' : '') + '<div><div class="font-semibold text-on-surface">' + esc(r.Nama_Lengkap) + '</div><div class="text-xs text-on-surface-variant">' + subMeta + '</div></div></div></td>' +
          '<td class="py-3.5 px-4 align-top">' + tujuan + '</td>' +
          '<td class="py-3.5 px-4 align-top">' + statusBadge(status) + '</td>' +
          '<td class="py-3.5 px-4 align-top text-right whitespace-nowrap">' + aksiHtml + '</td>' +
        '</tr>';
      }).join('');

      tbody.querySelectorAll('.act-btn').forEach(function (b) {
        b.onclick = function () {
          handleOfficerAction(b.getAttribute('data-act'), b.getAttribute('data-id'), b.getAttribute('data-jalur'));
        };
      });
    }

    // Bottom Rol Sidang Cards
    const rolBox = document.getElementById('pantau-rol-sidang');
    if (!jadwal.length) {
      rolBox.innerHTML = '<div class="text-xs text-on-surface-variant col-span-2">Belum ada jadwal sidang hari ini.</div>';
    } else {
      rolBox.innerHTML = jadwal.map(function (j) {
        const hadir = sidang.filter(function (s) { return String(s.Nomor_Perkara).trim() === String(j.Nomor_Perkara).trim(); });
        const peranList = hadir.map(function (h) { return h.Peran_Sidang + ' (' + h.Nomor_Antrean + ')'; }).join(', ') || 'Belum ada pihak check-in';
        return '<div class="p-4 rounded-xl border border-outline-variant/50 bg-surface-container-low/40 flex flex-col justify-between gap-2">' +
          '<div class="flex items-center justify-between gap-2"><span class="text-xs font-bold text-primary-container">' + esc(j.Ruang_Sidang) + '</span><span class="px-2 py-0.5 rounded-full text-[10px] font-bold ' + (hadir.length ? 'bg-primary-fixed text-on-primary-fixed' : 'bg-secondary-fixed text-on-secondary-fixed-variant') + '">' + hadir.length + ' Pihak Hadir</span></div>' +
          '<div class="font-display font-bold text-sm text-on-surface">' + esc(j.Nomor_Perkara) + '</div>' +
          '<div class="text-xs text-on-surface-variant">' + esc(j.Agenda || '-') + '</div>' +
          '<div class="text-[11px] font-medium text-emerald-800 pt-1 border-t border-outline-variant/30">' + esc(peranList) + '</div>' +
        '</div>';
      }).join('');
    }

    // Bottom Status Loket PTSP (Dinamis sesuai pengaturan loket)
    const lokets = getLoketList();
    document.getElementById('pantau-loket-status').innerHTML = lokets.map(function (l) {
      const lk = l.kode;
      const active = ptsp.find(function (r) { return r.Loket_Tujuan === lk && r.Status_Layanan === 'Dilayani'; });
      const wait = ptsp.filter(function (r) { return r.Loket_Tujuan === lk && r.Status_Layanan === 'Menunggu'; }).length;
      return '<div class="p-3.5 rounded-xl border border-outline-variant/40 bg-surface-container-low/40 flex items-center justify-between">' +
        '<div><div class="font-display font-bold text-sm text-on-surface">' + esc(l.nama || ('Loket ' + lk)) + '</div><div class="text-xs text-on-surface-variant">' + (active ? ('Melayani ' + esc(active.Nomor_Antrean) + ' (' + esc(active.Nama_Lengkap) + ')') : ('Siap melayani • ' + wait + ' menunggu')) + '</div></div>' +
        '<span class="px-2.5 py-1 rounded-full text-[11px] font-bold ' + (active ? 'bg-blue-100 text-blue-800' : 'bg-primary-fixed text-on-primary-fixed') + '">' + (active ? 'Melayani' : 'Siap') + '</span>' +
      '</div>';
    }).join('');
  }

  /**
   * Optimistic UI update: ubah state lokal seketika (0ms), kirim request di belakang
   */
  async function handleOfficerAction(act, idTiket, jalur) {
    const list = jalur === 'PTSP' ? state.pantau.ptsp : state.pantau.sidang;
    const item = list.find(function (r) { return r.ID_Tiket === idTiket; });
    if (!item) return;

    if (act === 'panggil') {
      updateLiveDisplayQueue({
        nomor: item.Nomor_Antrean,
        loket: item.Loket_Tujuan ? ('Loket ' + item.Loket_Tujuan) : 'Loket Layanan PTSP',
        nama: item.Nama_Lengkap,
        jalur: 'PTSP',
        status: 'Dipanggil ke Loket'
      }, true);
      return;
    }

    if (act === 'masukSidang') {
      openModalPanggilSidang(item);
      return;
    }

    const prevSnapshot = Object.assign({}, item);

    if (act === 'checkout') {
      item.Waktu_Keluar = new Date().toISOString();
      if (jalur === 'PTSP') item.Status_Layanan = 'Selesai';
      else item.Status_Kehadiran = 'Selesai';
      renderPantau();
      const res = await window.ApiClient.call('tamu.checkout', { idTiket: idTiket, jalur: jalur });
      if (!res || !res.success) {
        Object.assign(item, prevSnapshot);
        renderPantau();
        toast((res && res.message) || 'Gagal check-out.', 'error');
      } else {
        toast('Check-out ' + item.Nomor_Antrean + ' berhasil.', 'success');
      }
      return;
    }

    let nextStatus = '';
    if (act === 'layani') nextStatus = 'Dilayani';
    else if (act === 'selesai') nextStatus = 'Selesai';

    if (jalur === 'PTSP') item.Status_Layanan = nextStatus;
    else item.Status_Kehadiran = nextStatus;
    renderPantau();

    if (act === 'layani') {
      updateLiveDisplayQueue({
        nomor: item.Nomor_Antrean,
        loket: item.Loket_Tujuan ? ('Loket ' + item.Loket_Tujuan) : 'Loket Layanan PTSP',
        nama: item.Nama_Lengkap,
        jalur: 'PTSP',
        status: 'Sedang Dilayani'
      }, true);
    }

    const res = await window.ApiClient.call('tamu.ubahStatus', {
      idTiket: idTiket,
      jalur: jalur,
      status: nextStatus,
      noHp: item.No_HP,
      nama: item.Nama_Lengkap,
      nomorAntrean: item.Nomor_Antrean,
      loket: item.Loket_Tujuan
    });
    if (!res || !res.success) {
      Object.assign(item, prevSnapshot);
      renderPantau();
      toast((res && res.message) || 'Gagal memperbarui status.', 'error');
    } else {
      loadBootPublic(false);
    }
  }

  function openModalPanggilSidang(item) {
    state.activePanggilSidang = item;
    const modal = document.getElementById('modal-panggil-sidang');
    if (!modal) return;

    document.getElementById('mps-antrean').textContent = item.Nomor_Antrean || '-';
    document.getElementById('mps-peran').textContent = item.Peran_Sidang || 'Pihak Sidang';
    document.getElementById('mps-nama').textContent = item.Nama_Lengkap || '-';
    document.getElementById('mps-perkara').textContent = 'Perkara: ' + (item.Nomor_Perkara || '-');

    renderRuangSidangSelects();
    const sel = document.getElementById('mps-select-ruang');
    const list = getRuangSidangList();

    // Prioritas Ruang Sidang:
    // 1. Ruang sidang yang saat ini tersimpan (jika sudah ada & bukan 'Belum Ditentukan')
    // 2. Ruang sidang pihak lain dalam nomor perkara yang sama (sinkronisasi satu ruang perkara)
    // 3. Ruang sidang dari jadwal hari ini untuk nomor perkara tersebut
    // 4. Ruang pertama dari daftar master ruang
    let defaultRuang = '';
    if (item.Ruang_Sidang && item.Ruang_Sidang !== 'Belum Ditentukan' && item.Ruang_Sidang !== '-') {
      defaultRuang = item.Ruang_Sidang;
    } else {
      const matchPihakLain = (state.pantau && state.pantau.sidang) ? state.pantau.sidang.find(function (s) {
        return s.ID_Tiket !== item.ID_Tiket &&
          String(s.Nomor_Perkara).trim() === String(item.Nomor_Perkara).trim() &&
          s.Ruang_Sidang && s.Ruang_Sidang !== 'Belum Ditentukan' && s.Ruang_Sidang !== '-';
      }) : null;
      if (matchPihakLain) {
        defaultRuang = matchPihakLain.Ruang_Sidang;
      } else {
        const jdw = (state.boot && state.boot.jadwalHariIni) ? state.boot.jadwalHariIni.find(function (j) {
          return String(j.Nomor_Perkara).trim() === String(item.Nomor_Perkara).trim();
        }) : null;
        if (jdw && jdw.Ruang_Sidang) {
          defaultRuang = jdw.Ruang_Sidang;
        } else if (list.length) {
          defaultRuang = list[0].nama;
        }
      }
    }

    if (sel && defaultRuang) {
      setSelectValueSafe(sel, defaultRuang);
    }

    modal.classList.remove('hidden');
    if (sel) sel.focus();
  }

  function closeModalPanggilSidang() {
    const modal = document.getElementById('modal-panggil-sidang');
    if (modal) modal.classList.add('hidden');
    state.activePanggilSidang = null;
  }

  async function submitPanggilSidangModal() {
    const item = state.activePanggilSidang;
    if (!item) return;

    const sel = document.getElementById('mps-select-ruang');
    const ruang = sel ? sel.value.trim() : '';
    if (!ruang) {
      toast('Silakan pilih ruang sidang terlebih dahulu.', 'warning');
      return;
    }

    const withSuara = document.getElementById('mps-check-suara') ? document.getElementById('mps-check-suara').checked : true;
    closeModalPanggilSidang();

    const prevSnapshot = Object.assign({}, item);
    item.Ruang_Sidang = ruang;
    item.Status_Kehadiran = 'Masuk Ruang Sidang';
    renderPantau();

    updateLiveDisplayQueue({
      nomor: item.Nomor_Antrean,
      loket: ruang || 'Ruang Sidang Utama',
      nama: item.Nama_Lengkap + (item.Nomor_Perkara ? ' (' + item.Nomor_Perkara + ')' : ''),
      jalur: 'SIDANG',
      status: 'Masuk Ruang Sidang'
    }, withSuara);

    const res = await window.ApiClient.call('tamu.ubahStatus', {
      idTiket: item.ID_Tiket,
      jalur: 'SIDANG',
      status: 'Masuk Ruang Sidang',
      ruangSidang: ruang,
      noHp: item.No_HP,
      nama: item.Nama_Lengkap,
      nomorAntrean: item.Nomor_Antrean,
      nomorPerkara: item.Nomor_Perkara,
      peranSidang: item.Peran_Sidang,
      agenda: item.Agenda
    });

    if (!res || !res.success) {
      Object.assign(item, prevSnapshot);
      renderPantau();
      toast((res && res.message) || 'Gagal memanggil tamu ke ruang sidang.', 'error');
    } else {
      toast('Tamu ' + item.Nama_Lengkap + ' (' + item.Nomor_Antrean + ') dipanggil ke ' + ruang + '.', 'success');
      loadBootPublic(false);
    }
  }

  // ==========================================================================
  // VIEW 6: DASHBOARD ANALITIK, LAPORAN & ADMINISTRASI
  // ==========================================================================
  async function loadDashboardData() {
    const curNama = state.boot && state.boot.pengaturan && state.boot.pengaturan.NAMA_SATKER;
    if (curNama) {
      const dashInp = document.getElementById('dash-nama-pengadilan');
      if (dashInp) dashInp.value = curNama;
    }

    const startEl = document.getElementById('dash-start');
    const endEl = document.getElementById('dash-end');
    if (!endEl.value) endEl.value = todayYmd();
    if (!startEl.value) {
      const d = new Date();
      d.setDate(1);
      startEl.value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    const res = await window.ApiClient.call('admin.dashboard', {
      start: startEl.value,
      end: endEl.value,
      jalur: document.getElementById('dash-jalur').value
    });
    if (res && res.success && res.data) {
      state.dash = res.data;
      renderDashboard();
    }
    if (!curNama) {
      loadBootPublic(false);
    }
  }

  function renderDashboard() {
    if (!state.dash) return;
    const k = state.dash.kpi || {};
    const tot = k.totalPengunjung || 0;
    document.getElementById('d-kpi-total').textContent = tot;
    document.getElementById('d-kpi-ptsp').textContent = k.totalPtsp || 0;
    document.getElementById('d-kpi-sidang').textContent = k.totalSidang || 0;
    document.getElementById('d-kpi-ptsp-pct').textContent = (tot ? Math.round((k.totalPtsp / tot) * 100) : 0) + '% dari total kunjungan';
    document.getElementById('d-kpi-sidang-pct').textContent = (tot ? Math.round((k.totalSidang / tot) * 100) : 0) + '% dari total kunjungan';
    document.getElementById('d-kpi-durasi').textContent = (k.rataDurasiMenit || 0) + ' m';

    renderDashboardCharts();
    renderRiwayatTable();
  }

  function renderDashboardCharts() {
    if (typeof window.Chart !== 'function' || !state.dash) return;
    const tren = state.dash.trenHarian || [];
    const dist = state.dash.loketDist || {};

    if (state.charts.tren) state.charts.tren.destroy();
    const ctxTren = document.getElementById('chart-tren').getContext('2d');
    state.charts.tren = new window.Chart(ctxTren, {
      type: 'bar',
      data: {
        labels: tren.map(function (t) { return t.tanggal; }),
        datasets: [
          { label: 'Tamu PTSP', data: tren.map(function (t) { return t.ptsp; }), backgroundColor: '#1b4332', borderRadius: 6 },
          { label: 'Tamu Sidang', data: tren.map(function (t) { return t.sidang; }), backgroundColor: '#ffc641', borderRadius: 6 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'top' } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
      }
    });

    if (state.charts.dist) state.charts.dist.destroy();
    const ctxDist = document.getElementById('chart-distribusi').getContext('2d');
    const keys = Object.keys(dist);
    const palette = ['#012d1d', '#1b4332', '#d4a017', '#a5d0b9', '#0039b5', '#795900', '#3f6653', '#64748b'];
    state.charts.dist = new window.Chart(ctxDist, {
      type: 'doughnut',
      data: {
        labels: keys,
        datasets: [{
          data: keys.map(function (k) { return dist[k]; }),
          backgroundColor: keys.map(function (_, i) { return palette[i % palette.length]; }),
          borderWidth: 2,
          borderColor: '#ffffff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: { legend: { position: 'bottom' } }
      }
    });
  }

  function renderRiwayatTable() {
    if (!state.dash) return;
    const q = String(document.getElementById('dash-search-riwayat').value || '').toLowerCase().trim();
    const rows = (state.dash.riwayat || []).filter(function (r) {
      if (!q) return true;
      const hay = [r.ID_Tiket, r.Nomor_Antrean, r.Nama_Lengkap, r.Asal_Instansi, r.Loket_Tujuan, r.Nomor_Perkara, r.Peran_Sidang].join(' ').toLowerCase();
      return hay.indexOf(q) > -1;
    });

    document.getElementById('dash-riwayat-count').textContent = rows.length + ' Data Ditampilkan';
    const tbody = document.getElementById('dash-riwayat-tbody');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="p-8 text-center text-on-surface-variant">Tidak ada riwayat kunjungan pada rentang/filter ini.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.slice(0, 100).map(function (r) {
      const isPtsp = r.jalur === 'PTSP';
      const st = isPtsp ? r.Status_Layanan : r.Status_Kehadiran;
      const tujuan = isPtsp ? ('PTSP • Loket ' + r.Loket_Tujuan) : ('Sidang • ' + r.Nomor_Perkara + ' (' + r.Peran_Sidang + ')');
      return '<tr class="hover:bg-surface-container-low/40">' +
        '<td class="py-3 px-3 font-mono text-xs font-bold">' + esc(r.Nomor_Antrean) + '<div class="text-[10px] text-outline">' + esc(r.ID_Tiket) + '</div></td>' +
        '<td class="py-3 px-3 font-semibold text-on-surface">' + esc(r.Nama_Lengkap) + '<div class="text-xs font-normal text-on-surface-variant">' + esc(isPtsp ? r.Asal_Instansi : r.Ruang_Sidang) + '</div></td>' +
        '<td class="py-3 px-3 text-xs">' + esc(tujuan) + '</td>' +
        '<td class="py-3 px-3 text-xs">' + fmtTglJam(r.Waktu_Masuk) + '</td>' +
        '<td class="py-3 px-3 text-xs">' + (r.Waktu_Keluar ? fmtJam(r.Waktu_Keluar) : '-') + '</td>' +
        '<td class="py-3 px-3">' + statusBadge(st) + '</td>' +
        '<td class="py-3 px-3 text-right no-print"><button type="button" data-print-id="' + esc(r.ID_Tiket) + '" class="btn-hist-print px-2.5 py-1.5 rounded-lg border border-outline-variant hover:border-primary-container text-xs font-semibold">Struk</button></td>' +
      '</tr>';
    }).join('');

    tbody.querySelectorAll('.btn-hist-print').forEach(function (b) {
      b.onclick = function () {
        const id = b.getAttribute('data-print-id');
        const found = rows.find(function (x) { return x.ID_Tiket === id; });
        if (!found) return;
        const cfg = (state.boot && state.boot.pengaturan) || {};
        window.StrukUI.pratinjau({
          jenis: found.jalur,
          data: window.StrukEngine.dataTiketStruk(found, cfg),
          nomor: found.ID_Tiket,
          waNomor: found.No_HP
        });
      };
    });
  }

  function exportCsv() {
    if (!state.dash || !state.dash.riwayat.length) {
      toast('Tidak ada data untuk diunduh.', 'warning');
      return;
    }
    const headers = ['ID_Tiket', 'Jalur', 'Nomor_Antrean', 'Waktu_Masuk', 'Waktu_Keluar', 'Nama_Lengkap', 'No_HP', 'Instansi_atau_Peran', 'Tujuan_atau_Nomor_Perkara', 'Ruang_Sidang', 'Status'];
    const escCsv = function (v) { return '"' + String(v || '').replace(/"/g, '""') + '"'; };
    const lines = [headers.join(',')];
    state.dash.riwayat.forEach(function (r) {
      const isPtsp = r.jalur === 'PTSP';
      lines.push([
        r.ID_Tiket,
        r.jalur,
        r.Nomor_Antrean,
        r.Waktu_Masuk,
        r.Waktu_Keluar || '',
        r.Nama_Lengkap,
        r.No_HP || '',
        isPtsp ? r.Asal_Instansi : r.Peran_Sidang,
        isPtsp ? r.Loket_Tujuan : r.Nomor_Perkara,
        isPtsp ? '' : r.Ruang_Sidang,
        isPtsp ? r.Status_Layanan : r.Status_Kehadiran
      ].map(escCsv).join(','));
    });

    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'Rekap_Buku_Tamu_PTUN_' + todayYmd() + '.csv';
    a.click();
    toast('File Excel (.csv) berhasil diunduh.', 'success');
  }

  function openAdminTab(t) {
    document.querySelectorAll('.atab-btn').forEach(function (b) {
      const active = b.getAttribute('data-atab') === t;
      b.className = active
        ? 'atab-btn px-4 py-2.5 text-xs sm:text-sm font-bold border-b-2 border-primary-container text-primary-container whitespace-nowrap'
        : 'atab-btn px-4 py-2.5 text-xs sm:text-sm font-semibold border-b-2 border-transparent text-on-surface-variant hover:text-on-surface whitespace-nowrap';
    });
    document.querySelectorAll('.atab-pane').forEach(function (p) {
      p.classList.toggle('hidden', p.id !== 'atab-' + t);
    });
    if (t === 'jadwal') loadAdminJadwal();
    if (t === 'ruang') { renderAdminRuangList(); loadAdminPengaturan(); }
    if (t === 'users') loadAdminUsers();
    if (t === 'display') loadAdminDisplayTab();
    if (t === 'pengaturan' || t === 'migrasi') loadAdminPengaturan();
    if (t === 'crm') loadNotifCrmTab();
  }

  function loadAdminDisplayTab() {
    const dispSt = getDisplaySettings();
    const inAdminYt = document.getElementById('admin-disp-yt');
    const inAdminMarq = document.getElementById('admin-disp-marquee');
    const inAdminAudio = document.getElementById('admin-disp-audio-toggle');
    const inAdminVideo = document.getElementById('admin-disp-videosound');
    const inAdminAutoMute = document.getElementById('admin-disp-automute');
    if (inAdminYt) inAdminYt.value = dispSt.ytId || DEFAULT_DISPLAY_SETTINGS.ytId;
    if (inAdminMarq) inAdminMarq.value = dispSt.marquee || DEFAULT_DISPLAY_SETTINGS.marquee;
    if (inAdminAudio) inAdminAudio.checked = (dispSt.audioEnabled !== false);
    if (inAdminVideo) inAdminVideo.checked = (dispSt.videoSound === true);
    if (inAdminAutoMute) inAdminAutoMute.checked = (dispSt.autoMuteOnCall !== false);
  }

  function initAdminTabs() {
    initCrmEvents();
    document.querySelectorAll('.atab-btn').forEach(function (btn) {
      btn.onclick = function () {
        openAdminTab(btn.getAttribute('data-atab'));
      };
    });

    const btnShortcutRuang = document.getElementById('btn-shortcut-atur-ruang');
    if (btnShortcutRuang) {
      btnShortcutRuang.onclick = function () {
        goView('dashboard');
        openAdminTab('ruang');
      };
    }

    document.getElementById('btn-dash-filter').onclick = loadDashboardData;
    document.getElementById('dash-search-riwayat').oninput = renderRiwayatTable;
    document.getElementById('btn-export-csv').onclick = exportCsv;
    document.getElementById('btn-export-pdf').onclick = function () {
      document.body.classList.remove('printing-thermal');
      document.body.classList.add('printing-report');
      setTimeout(function () {
        window.print();
        setTimeout(function () { document.body.classList.remove('printing-report'); }, 500);
      }, 100);
    };

    // Simpan Jadwal
    document.getElementById('form-jadwal').onsubmit = async function (e) {
      e.preventDefault();
      const res = await window.ApiClient.call('jadwal.simpan', {
        ID_Jadwal: document.getElementById('jdw-id').value,
        Tanggal: document.getElementById('jdw-tgl').value,
        Nomor_Perkara: document.getElementById('jdw-perkara').value,
        Ruang_Sidang: document.getElementById('jdw-ruang').value,
        Agenda: document.getElementById('jdw-agenda').value
      });
      if (res && res.success) {
        toast(res.message, 'success');
        document.getElementById('form-jadwal').reset();
        document.getElementById('jdw-id').value = '';
        loadAdminJadwal();
        loadBootPublic(false);
      } else {
        toast((res && res.message) || 'Gagal menyimpan jadwal.', 'error');
      }
    };

    // Simpan User
    document.getElementById('form-user').onsubmit = async function (e) {
      e.preventDefault();
      const res = await window.ApiClient.call('users.simpan', {
        Username: document.getElementById('usr-username').value,
        Nama_Petugas: document.getElementById('usr-nama').value,
        Role: document.getElementById('usr-role').value,
        pinBaru: document.getElementById('usr-pin').value,
        Status_Aktif: 'Aktif'
      });
      if (res && res.success) {
        toast(res.message, 'success');
        document.getElementById('form-user').reset();
        renderAdminUsers(res.data || []);
      } else {
        toast((res && res.message) || 'Gagal menyimpan pengguna.', 'error');
      }
    };

    // Simpan Cepat Nama Pengadilan dari Dashboard Admin
    document.getElementById('form-dash-nama-pengadilan').onsubmit = async function (e) {
      e.preventDefault();
      const inp = document.getElementById('dash-nama-pengadilan');
      const namaBaru = String(inp.value || '').trim();
      if (!namaBaru) {
        toast('Nama pengadilan tidak boleh kosong.', 'warning');
        inp.focus();
        return;
      }
      const btn = document.getElementById('btn-simpan-nama-pengadilan');
      btn.disabled = true;
      btn.classList.add('opacity-70');
      const res = await window.ApiClient.call('pengaturan.simpan', { NAMA_SATKER: namaBaru });
      btn.disabled = false;
      btn.classList.remove('opacity-70');
      if (res && res.success) {
        applySatkerName((res.data && res.data.NAMA_SATKER) || namaBaru);
        toast('Nama pengadilan berhasil diperbarui.', 'success');
        loadBootPublic(false);
      } else {
        toast((res && res.message) || 'Gagal memperbarui nama pengadilan.', 'error');
      }
    };

    const btnKePengaturan = document.getElementById('btn-ke-pengaturan-lengkap');
    if (btnKePengaturan) {
      btnKePengaturan.onclick = function () {
        const tabBtn = document.querySelector('.atab-btn[data-atab="pengaturan"]');
        if (tabBtn) {
          tabBtn.click();
          tabBtn.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      };
    }

    const navBtnPengaturanLengkap = document.getElementById('nav-btn-pengaturan-lengkap');
    if (navBtnPengaturanLengkap) {
      navBtnPengaturanLengkap.onclick = function () {
        closeSidebarMobile();
        goView('dashboard');
        openAdminTab('pengaturan');
        const tabBtn = document.querySelector('.atab-btn[data-atab="pengaturan"]');
        if (tabBtn) tabBtn.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
    }

    // Simpan Pengaturan
    document.getElementById('form-pengaturan').onsubmit = async function (e) {
      e.preventDefault();
      const namaBaru = String(document.getElementById('cfg-nama').value || '').trim();
      if (!namaBaru) {
        toast('Nama pengadilan tidak boleh kosong.', 'warning');
        document.getElementById('cfg-nama').focus();
        return;
      }
      const res = await window.ApiClient.call('pengaturan.simpan', {
        NAMA_SATKER: namaBaru,
        ALAMAT_SATKER: document.getElementById('cfg-alamat').value,
        JAM_LAYANAN: document.getElementById('cfg-jam').value,
        CATATAN_KAKI_STRUK: document.getElementById('cfg-kaki').value
      });
      if (res && res.success) {
        applySatkerName((res.data && res.data.NAMA_SATKER) || namaBaru);
        toast(res.message, 'success');
        loadBootPublic(false);
        loadAdminPengaturan();
      } else {
        toast((res && res.message) || 'Gagal menyimpan pengaturan.', 'error');
      }
    };

    // Simpan Rahasia (R5 Allowlist)
    document.getElementById('form-rahasia').onsubmit = async function (e) {
      e.preventDefault();
      const res = await window.ApiClient.call('rahasia.simpan', {
        WA_GATEWAY_TOKEN: document.getElementById('sec-wa-token').value,
        WA_GATEWAY_URL: document.getElementById('sec-wa-url').value,
        SIPP_SYNC_KEY: document.getElementById('sec-sipp-key').value
      });
      if (res && res.success) {
        toast(res.message, 'success');
        document.getElementById('form-rahasia').reset();
        applyMaskedSecrets(res.data || {});
        loadWaStatus();
      } else {
        toast((res && res.message) || 'Gagal menyimpan rahasia.', 'error');
      }
    };

    // WhatsApp Gateway: Panel Pengaturan Token, Cek Status & Tes Kirim
    function toggleWaSettingsPanel(forceOpen) {
      const panel = document.getElementById('wa-panel-pengaturan');
      if (!panel) return;
      if (forceOpen === true) panel.classList.remove('hidden');
      else if (forceOpen === false) panel.classList.add('hidden');
      else panel.classList.toggle('hidden');

      if (!panel.classList.contains('hidden')) {
        const inp = document.getElementById('wa-card-token-input');
        if (inp) inp.focus();
      }
    }

    const btnBukaPengaturanWa = document.getElementById('btn-wa-buka-pengaturan');
    if (btnBukaPengaturanWa) {
      btnBukaPengaturanWa.onclick = function () { toggleWaSettingsPanel(); };
    }

    const btnBukaPengaturanHeaderWa = document.getElementById('btn-wa-buka-pengaturan-header');
    if (btnBukaPengaturanHeaderWa) {
      btnBukaPengaturanHeaderWa.onclick = function () { toggleWaSettingsPanel(); };
    }

    const badgeWaStatus = document.getElementById('wa-status-badge');
    if (badgeWaStatus) {
      badgeWaStatus.onclick = function () { toggleWaSettingsPanel(); };
    }

    const btnTutupPanelWa = document.getElementById('btn-wa-panel-tutup');
    if (btnTutupPanelWa) {
      btnTutupPanelWa.onclick = function () { toggleWaSettingsPanel(false); };
    }

    const btnBatalPanelWa = document.getElementById('btn-wa-panel-batal');
    if (btnBatalPanelWa) {
      btnBatalPanelWa.onclick = function () { toggleWaSettingsPanel(false); };
    }

    // Toggle Visibility Password Token Fonnte
    const btnToggleVis = document.getElementById('btn-toggle-wa-token-visibility');
    if (btnToggleVis) {
      btnToggleVis.onclick = function () {
        const inp = document.getElementById('wa-card-token-input');
        const icon = document.getElementById('icon-toggle-wa-token');
        if (!inp) return;
        if (inp.type === 'password') {
          inp.type = 'text';
          if (icon) icon.textContent = 'visibility_off';
        } else {
          inp.type = 'password';
          if (icon) icon.textContent = 'visibility';
        }
      };
    }

    // Simpan Token dari Panel WhatsApp
    const btnSimpanWaPanel = document.getElementById('btn-wa-panel-simpan');
    if (btnSimpanWaPanel) {
      btnSimpanWaPanel.onclick = async function () {
        const tokenVal = (document.getElementById('wa-card-token-input').value || '').trim();
        const urlVal = (document.getElementById('wa-card-url-input').value || '').trim();
        if (!tokenVal) {
          toast('Masukkan token Fonnte terlebih dahulu.', 'warning');
          return;
        }

        btnSimpanWaPanel.disabled = true;
        btnSimpanWaPanel.innerHTML = '<span class="material-symbols-outlined text-sm animate-spin">refresh</span><span>Menyimpan...</span>';

        const res = await window.ApiClient.call('rahasia.simpan', {
          WA_GATEWAY_TOKEN: tokenVal,
          WA_GATEWAY_URL: urlVal || 'https://api.fonnte.com/send'
        });

        btnSimpanWaPanel.disabled = false;
        btnSimpanWaPanel.innerHTML = '<span class="material-symbols-outlined text-sm">save</span><span>Simpan Token</span>';

        if (res && res.success) {
          toast('Token WhatsApp Gateway berhasil disimpan ke Script Properties!', 'success');
          document.getElementById('wa-card-token-input').value = '';
          toggleWaSettingsPanel(false);
          applyMaskedSecrets(res.data || {});
          await loadWaStatus();
        } else {
          toast((res && res.message) || 'Gagal menyimpan token.', 'error');
        }
      };
    }

    const btnCekWa = document.getElementById('btn-wa-cek-status');
    if (btnCekWa) {
      btnCekWa.onclick = async function () {
        btnCekWa.disabled = true;
        btnCekWa.innerHTML = '<span class="material-symbols-outlined text-sm animate-spin">sync</span><span>Memeriksa...</span>';
        await loadWaStatus();
        btnCekWa.disabled = false;
        btnCekWa.innerHTML = '<span class="material-symbols-outlined text-sm">sync</span><span>Cek Status Koneksi Fonnte</span>';
        toast('Status WhatsApp Gateway diperbarui.', 'info');
      };
    }

    const btnTestWa = document.getElementById('btn-wa-test-kirim');
    if (btnTestWa) {
      btnTestWa.onclick = async function () {
        const phone = (document.getElementById('wa-test-phone').value || '').trim();
        const resultBox = document.getElementById('wa-test-result');
        if (!phone) {
          toast('Masukkan nomor WhatsApp tujuan uji coba terlebih dahulu.', 'warning');
          return;
        }
        btnTestWa.disabled = true;
        btnTestWa.innerHTML = '<span class="material-symbols-outlined text-sm animate-spin">refresh</span><span>Mengirim...</span>';
        if (resultBox) {
          resultBox.className = 'p-2.5 rounded-lg text-xs font-mono bg-slate-50 text-slate-600 border border-slate-200';
          resultBox.textContent = 'Menghubungi Fonnte Gateway...';
          resultBox.classList.remove('hidden');
        }
        const res = await window.ApiClient.call('wa.testKirim', { noHp: phone });
        btnTestWa.disabled = false;
        btnTestWa.innerHTML = '<span class="material-symbols-outlined text-sm">send</span><span>Kirim Tes</span>';

        if (res && res.success) {
          toast(res.message || 'Pesan uji coba terkirim!', 'success');
          if (resultBox) {
            resultBox.className = 'p-2.5 rounded-lg text-xs font-mono bg-emerald-50 text-emerald-800 border border-emerald-200';
            resultBox.textContent = '✅ ' + (res.message || 'Pesan berhasil dikirim via Fonnte.');
          }
          loadWaStatus();
        } else {
          const msg = (res && res.message) || 'Gagal mengirim pesan uji coba.';
          toast(msg, 'error');
          if (resultBox) {
            resultBox.className = 'p-2.5 rounded-lg text-xs font-mono bg-rose-50 text-rose-800 border border-rose-200';
            resultBox.textContent = '❌ ' + msg;
          }
        }
      };
    }

    // Migrasi Dry-Run & Delta-Sync
    document.getElementById('btn-mig-pindai').onclick = function () { runMigrasi(true); };
    document.getElementById('btn-mig-eksekusi').onclick = function () { runMigrasi(false); };

    // Kelola Loket Layanan PTSP (Tambah / Edit / Batal)
    const formLoket = document.getElementById('form-loket');
    if (formLoket) {
      formLoket.onsubmit = function (e) {
        e.preventDefault();
        const editIdx = Number(document.getElementById('lkt-edit-idx').value);
        const kode = document.getElementById('lkt-kode').value.trim();
        const nama = document.getElementById('lkt-nama').value.trim();
        const badge = document.getElementById('lkt-badge').value.trim();
        const deskripsi = document.getElementById('lkt-desk').value.trim();

        if (!kode || !nama) {
          toast('Kode singkat dan judul loket wajib diisi.', 'warning');
          return;
        }

        const list = getLoketList().slice();
        const dupIdx = list.findIndex(function (l, i) {
          return i !== editIdx && String(l.kode).toLowerCase() === kode.toLowerCase();
        });
        if (dupIdx > -1) {
          toast('Kode loket "' + kode + '" sudah digunakan.', 'warning');
          return;
        }

        const item = {
          kode: kode,
          nama: nama,
          badge: badge || ('LOKET ' + (editIdx > -1 ? editIdx + 1 : list.length + 1)),
          deskripsi: deskripsi
        };

        if (editIdx > -1 && editIdx < list.length) {
          list[editIdx] = item;
        } else {
          list.push(item);
        }

        resetLoketForm();
        saveLoketList(list);
      };
    }

    const btnCancelLkt = document.getElementById('btn-lkt-cancel');
    if (btnCancelLkt) btnCancelLkt.onclick = resetLoketForm;

    // Kelola Sebutan Pihak / Peran Persidangan (Tambah / Edit / Batal)
    const formPeran = document.getElementById('form-peran');
    if (formPeran) {
      formPeran.onsubmit = function (e) {
        e.preventDefault();
        const editIdx = Number(document.getElementById('prn-edit-idx').value);
        const nama = document.getElementById('prn-nama').value.trim();
        const keterangan = document.getElementById('prn-ket').value.trim();

        if (!nama) {
          toast('Sebutan pihak / peran wajib diisi.', 'warning');
          return;
        }

        const list = getPeranSidangList().slice();
        const dupIdx = list.findIndex(function (p, i) {
          return i !== editIdx && String(p.nama).toLowerCase() === nama.toLowerCase();
        });
        if (dupIdx > -1) {
          toast('Sebutan pihak "' + nama + '" sudah ada dalam daftar.', 'warning');
          return;
        }

        const item = { nama: nama, keterangan: keterangan };
        if (editIdx > -1 && editIdx < list.length) {
          list[editIdx] = item;
        } else {
          list.push(item);
        }

        resetPeranForm();
        savePeranList(list);
      };
    }

    const btnCancelPrn = document.getElementById('btn-prn-cancel');
    if (btnCancelPrn) btnCancelPrn.onclick = resetPeranForm;

    // Kelola Pilihan Ruang Sidang (Tambah / Edit / Batal)
    const formRuang = document.getElementById('form-ruang');
    if (formRuang) {
      formRuang.onsubmit = function (e) {
        e.preventDefault();
        const editIdx = Number(document.getElementById('rng-edit-idx').value);
        const nama = document.getElementById('rng-nama').value.trim();
        const keterangan = document.getElementById('rng-ket').value.trim();

        if (!nama) {
          toast('Nama ruang sidang wajib diisi.', 'warning');
          return;
        }

        const list = getRuangSidangList().slice();
        const dupIdx = list.findIndex(function (r, i) {
          return i !== editIdx && String(r.nama).toLowerCase() === nama.toLowerCase();
        });
        if (dupIdx > -1) {
          toast('Ruang sidang "' + nama + '" sudah ada dalam daftar.', 'warning');
          return;
        }

        const item = { nama: nama, keterangan: keterangan };
        if (editIdx > -1 && editIdx < list.length) {
          list[editIdx] = item;
        } else {
          list.push(item);
        }

        resetRuangForm();
        saveRuangList(list);
      };
    }

    const btnCancelRng = document.getElementById('btn-rng-cancel');
    if (btnCancelRng) btnCancelRng.onclick = resetRuangForm;

    // Pengaturan Logo Pengadilan (Upload file terkompresi / URL / Reset)
    const fileLogo = document.getElementById('cfg-logo-file');
    if (fileLogo) {
      fileLogo.onchange = function () {
        const f = fileLogo.files && fileLogo.files[0];
        if (!f) return;
        const lbl = document.getElementById('cfg-logo-file-label');
        if (lbl) lbl.textContent = f.name.slice(0, 18);

        const reader = new FileReader();
        reader.onload = function (ev) {
          const src = ev.target.result;
          if (f.type === 'image/svg+xml') {
            state.pendingLogoBase64 = src;
            applySatkerLogo(src);
            return;
          }
          const img = new Image();
          img.onload = function () {
            const maxDim = 256;
            const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(img.width * scale));
            canvas.height = Math.max(1, Math.round(img.height * scale));
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            const pngData = canvas.toDataURL('image/png');
            state.pendingLogoBase64 = pngData;
            applySatkerLogo(pngData);
          };
          img.src = src;
        };
        reader.readAsDataURL(f);
      };
    }

    const formLogo = document.getElementById('form-logo');
    if (formLogo) {
      formLogo.onsubmit = async function (e) {
        e.preventDefault();
        const urlVal = document.getElementById('cfg-logo-url').value.trim();
        const b64Val = state.pendingLogoBase64 || '';
        if (!b64Val && !urlVal) {
          toast('Pilih file gambar logo atau masukkan URL gambar terlebih dahulu.', 'warning');
          return;
        }
        const btn = document.getElementById('btn-logo-save');
        btn.disabled = true;
        btn.textContent = 'Menyimpan...';

        const prevUrl = (state.boot && state.boot.pengaturan && state.boot.pengaturan.LOGO_URL) || '';
        applySatkerLogo(b64Val || urlVal);

        const res = await window.ApiClient.call('logo.simpan', {
          logoBase64: b64Val,
          logoUrl: urlVal
        });

        btn.disabled = false;
        btn.textContent = 'Simpan Logo';

        if (res && res.success && res.data) {
          state.pendingLogoBase64 = '';
          if (fileLogo) fileLogo.value = '';
          const lbl = document.getElementById('cfg-logo-file-label');
          if (lbl) lbl.textContent = 'Pilih PNG / JPG';
          applySatkerLogo(res.data.LOGO_URL || '');
          toast(res.message || 'Logo berhasil diperbarui!', 'success');
          loadBootPublic(false);
        } else {
          applySatkerLogo(prevUrl);
          toast((res && res.message) || 'Gagal menyimpan logo.', 'error');
        }
      };
    }

    const btnResetLogo = document.getElementById('btn-logo-reset');
    if (btnResetLogo) {
      btnResetLogo.onclick = async function () {
        const prevUrl = (state.boot && state.boot.pengaturan && state.boot.pengaturan.LOGO_URL) || '';
        state.pendingLogoBase64 = '';
        if (fileLogo) fileLogo.value = '';
        const lbl = document.getElementById('cfg-logo-file-label');
        if (lbl) lbl.textContent = 'Pilih PNG / JPG';
        applySatkerLogo('');

        const res = await window.ApiClient.call('logo.simpan', { reset: true });
        if (res && res.success) {
          toast(res.message || 'Logo dikembalikan ke bawaan.', 'success');
          loadBootPublic(false);
        } else {
          applySatkerLogo(prevUrl);
          toast((res && res.message) || 'Gagal mereset logo.', 'error');
        }
      };
    }

    // Pengaturan Display Ruang Tunggu & Video Antrean dari Admin Dashboard
    const formDispAdmin = document.getElementById('form-display-admin');
    if (formDispAdmin) {
      formDispAdmin.onsubmit = function (e) {
        e.preventDefault();
        const rawYt = (document.getElementById('admin-disp-yt').value || '').trim();
        const rawMarq = (document.getElementById('admin-disp-marquee').value || '').trim();
        const audioOn = document.getElementById('admin-disp-audio-toggle').checked;
        const videoSoundEl = document.getElementById('admin-disp-videosound');
        const autoMuteEl = document.getElementById('admin-disp-automute');
        const videoSound = videoSoundEl ? videoSoundEl.checked : false;
        const autoMute = autoMuteEl ? autoMuteEl.checked : true;
        const ytId = extractYouTubeId(rawYt) || DEFAULT_DISPLAY_SETTINGS.ytId;

        const nextSettings = {
          ytId: ytId,
          marquee: rawMarq || DEFAULT_DISPLAY_SETTINGS.marquee,
          audioEnabled: audioOn,
          videoSound: videoSound,
          autoMuteOnCall: autoMute
        };
        saveDisplaySettings(nextSettings);
        applyYouTubePlayer(ytId);

        if (videoSound) {
          sendYouTubeCommand('unMute', []);
          sendYouTubeCommand('setVolume', [80]);
          sendYouTubeCommand('playVideo', []);
        } else {
          sendYouTubeCommand('mute', []);
        }

        const kMarq = document.getElementById('kiosk-marquee-content');
        if (kMarq) kMarq.textContent = nextSettings.marquee;
        const dMarq = document.getElementById('display-marquee-content');
        if (dMarq) dMarq.textContent = nextSettings.marquee;

        updateDisplayAudioButton(nextSettings);
        updateKioskAudioButton(nextSettings);
        toast('Pengaturan Display & Video Antrean berhasil disimpan!', 'success');
      };
    }

    // Preset Video Cepat di Admin Dashboard
    document.querySelectorAll('.btn-admin-preset').forEach(function (btn) {
      btn.onclick = function () {
        const yt = btn.getAttribute('data-admin-yt');
        const inp = document.getElementById('admin-disp-yt');
        if (inp && yt) {
          inp.value = yt;
          toast('Preset video dipilih: ' + btn.textContent.trim(), 'info');
        }
      };
    });

    // Reset teks running text pengumuman di Admin Dashboard
    const btnResetMarq = document.getElementById('btn-admin-disp-reset-marquee');
    if (btnResetMarq) {
      btnResetMarq.onclick = function () {
        const inp = document.getElementById('admin-disp-marquee');
        if (inp) {
          inp.value = DEFAULT_DISPLAY_SETTINGS.marquee;
          toast('Teks pengumuman dikembalikan ke bawaan.', 'info');
        }
      };
    }

    // Pratinjau YouTube di Admin Dashboard
    const btnTestYt = document.getElementById('btn-admin-disp-test-yt');
    if (btnTestYt) {
      btnTestYt.onclick = function () {
        const rawYt = (document.getElementById('admin-disp-yt').value || '').trim();
        const ytId = extractYouTubeId(rawYt) || DEFAULT_DISPLAY_SETTINGS.ytId;
        if (ytId) {
          window.open('https://www.youtube.com/watch?v=' + encodeURIComponent(ytId), '_blank');
        } else {
          toast('Masukkan URL atau ID YouTube yang valid.', 'error');
        }
      };
    }

    // Test Bunyi Bel & Panggilan di Admin Dashboard (lengkap dengan auto-mute)
    const btnTestAudio = document.getElementById('btn-admin-disp-test-audio');
    if (btnTestAudio) {
      btnTestAudio.onclick = function () {
        panggilSuaraDisplay('Nomor antrean P-001, silakan menuju Loket 1');
      };
    }
  }

  function resetRuangForm() {
    const f = document.getElementById('form-ruang');
    if (f) f.reset();
    const idxEl = document.getElementById('rng-edit-idx');
    if (idxEl) idxEl.value = '-1';
    const lbl = document.getElementById('btn-rng-label');
    if (lbl) lbl.textContent = 'Tambah';
    const cancel = document.getElementById('btn-rng-cancel');
    if (cancel) cancel.classList.add('hidden');
  }

  async function saveRuangList(nextList) {
    if (!nextList.length) {
      toast('Minimal harus tersisa 1 ruang sidang aktif.', 'warning');
      return;
    }
    const prevRaw = state.boot && state.boot.pengaturan ? state.boot.pengaturan.RUANG_SIDANG_JSON : '';
    if (!state.boot) state.boot = { pengaturan: {} };
    if (!state.boot.pengaturan) state.boot.pengaturan = {};
    state.boot.pengaturan.RUANG_SIDANG_JSON = JSON.stringify(nextList);
    renderAdminRuangList();
    renderRuangSidangSelects();

    const res = await window.ApiClient.call('ruang.simpan', { ruangList: nextList });
    if (res && res.success) {
      toast(res.message || 'Daftar ruang sidang diperbarui.', 'success');
      loadBootPublic(false);
    } else {
      state.boot.pengaturan.RUANG_SIDANG_JSON = prevRaw;
      renderAdminRuangList();
      renderRuangSidangSelects();
      toast((res && res.message) || 'Gagal menyimpan ruang sidang.', 'error');
    }
  }

  function renderAdminRuangList() {
    const box = document.getElementById('admin-ruang-list');
    const countEl = document.getElementById('admin-ruang-count');
    if (!box) return;
    const list = getRuangSidangList();
    if (countEl) countEl.textContent = list.length + ' Ruang Aktif';

    box.innerHTML = list.map(function (r, idx) {
      return '<div class="p-3.5 rounded-xl bg-white border border-outline-variant/50 flex flex-col justify-between gap-2.5 shadow-sm">' +
        '<div>' +
          '<div class="font-display font-bold text-sm text-on-surface">' + esc(r.nama) + '</div>' +
          '<div class="text-xs text-on-surface-variant mt-0.5">' + esc(r.keterangan || '-') + '</div>' +
        '</div>' +
        '<div class="pt-2 border-t border-outline-variant/30 flex items-center justify-between gap-2">' +
          '<div class="flex items-center gap-1">' +
            '<button type="button" data-rng-up="' + idx + '" ' + (idx === 0 ? 'disabled ' : '') + 'class="px-2 h-8 rounded-lg border border-outline-variant text-xs hover:bg-surface-container-low disabled:opacity-35" title="Geser Naik">↑</button>' +
            '<button type="button" data-rng-down="' + idx + '" ' + (idx === list.length - 1 ? 'disabled ' : '') + 'class="px-2 h-8 rounded-lg border border-outline-variant text-xs hover:bg-surface-container-low disabled:opacity-35" title="Geser Turun">↓</button>' +
          '</div>' +
          '<div class="flex items-center gap-1.5">' +
            '<button type="button" data-rng-edit="' + idx + '" class="px-3 h-8 rounded-lg border border-outline-variant hover:border-primary-container text-xs font-semibold">Edit</button>' +
            '<button type="button" data-rng-del="' + idx + '" ' + (list.length <= 1 ? 'disabled ' : '') + 'class="px-3 h-8 rounded-lg text-xs font-semibold text-error hover:bg-error-container/40 disabled:opacity-35">Hapus</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    box.querySelectorAll('[data-rng-edit]').forEach(function (b) {
      b.onclick = function () {
        const i = Number(b.getAttribute('data-rng-edit'));
        const item = list[i];
        if (!item) return;
        document.getElementById('rng-edit-idx').value = String(i);
        document.getElementById('rng-nama').value = item.nama || '';
        document.getElementById('rng-ket').value = item.keterangan || '';
        document.getElementById('btn-rng-label').textContent = 'Simpan';
        document.getElementById('btn-rng-cancel').classList.remove('hidden');
        document.getElementById('rng-nama').focus();
      };
    });

    box.querySelectorAll('[data-rng-del]').forEach(function (b) {
      b.onclick = function () {
        const i = Number(b.getAttribute('data-rng-del'));
        if (list.length <= 1) {
          toast('Minimal harus tersisa 1 ruang sidang aktif.', 'warning');
          return;
        }
        const next = list.filter(function (_, idx) { return idx !== i; });
        resetRuangForm();
        saveRuangList(next);
      };
    });

    box.querySelectorAll('[data-rng-up]').forEach(function (b) {
      b.onclick = function () {
        const i = Number(b.getAttribute('data-rng-up'));
        if (i <= 0) return;
        const next = list.slice();
        const tmp = next[i - 1]; next[i - 1] = next[i]; next[i] = tmp;
        saveRuangList(next);
      };
    });

    box.querySelectorAll('[data-rng-down]').forEach(function (b) {
      b.onclick = function () {
        const i = Number(b.getAttribute('data-rng-down'));
        if (i >= list.length - 1) return;
        const next = list.slice();
        const tmp = next[i + 1]; next[i + 1] = next[i]; next[i] = tmp;
        saveRuangList(next);
      };
    });
  }

  function resetPeranForm() {
    const f = document.getElementById('form-peran');
    if (f) f.reset();
    const idxEl = document.getElementById('prn-edit-idx');
    if (idxEl) idxEl.value = '-1';
    const lbl = document.getElementById('btn-prn-label');
    if (lbl) lbl.textContent = 'Tambah';
    const cancel = document.getElementById('btn-prn-cancel');
    if (cancel) cancel.classList.add('hidden');
  }

  async function savePeranList(nextList) {
    if (!nextList.length) {
      toast('Minimal harus tersisa 1 sebutan pihak persidangan aktif.', 'warning');
      return;
    }
    const prevRaw = state.boot && state.boot.pengaturan ? state.boot.pengaturan.PERAN_SIDANG_JSON : '';
    if (!state.boot) state.boot = { pengaturan: {} };
    if (!state.boot.pengaturan) state.boot.pengaturan = {};
    state.boot.pengaturan.PERAN_SIDANG_JSON = JSON.stringify(nextList);
    renderAdminPeranList();
    renderKioskPeranPills();
    renderSidangPeranGrid();

    const res = await window.ApiClient.call('peran.simpan', { peranList: nextList });
    if (res && res.success) {
      toast(res.message || 'Sebutan pihak persidangan diperbarui.', 'success');
      loadBootPublic(false);
    } else {
      state.boot.pengaturan.PERAN_SIDANG_JSON = prevRaw;
      renderAdminPeranList();
      renderKioskPeranPills();
      renderSidangPeranGrid();
      toast((res && res.message) || 'Gagal menyimpan sebutan pihak.', 'error');
    }
  }

  function renderAdminPeranList() {
    const box = document.getElementById('admin-peran-list');
    const countEl = document.getElementById('admin-peran-count');
    if (!box) return;
    const list = getPeranSidangList();
    if (countEl) countEl.textContent = list.length + ' Sebutan Aktif';

    box.innerHTML = list.map(function (p, idx) {
      return '<div class="p-3.5 rounded-xl bg-white border border-outline-variant/50 flex flex-col justify-between gap-2.5 shadow-sm">' +
        '<div>' +
          '<div class="font-display font-bold text-sm text-on-surface">' + esc(p.nama) + '</div>' +
          '<div class="text-xs text-on-surface-variant mt-0.5">' + esc(p.keterangan || '-') + '</div>' +
        '</div>' +
        '<div class="pt-2 border-t border-outline-variant/30 flex items-center justify-between gap-2">' +
          '<div class="flex items-center gap-1">' +
            '<button type="button" data-prn-up="' + idx + '" ' + (idx === 0 ? 'disabled ' : '') + 'class="px-2 h-8 rounded-lg border border-outline-variant text-xs hover:bg-surface-container-low disabled:opacity-35" title="Geser Naik">↑</button>' +
            '<button type="button" data-prn-down="' + idx + '" ' + (idx === list.length - 1 ? 'disabled ' : '') + 'class="px-2 h-8 rounded-lg border border-outline-variant text-xs hover:bg-surface-container-low disabled:opacity-35" title="Geser Turun">↓</button>' +
          '</div>' +
          '<div class="flex items-center gap-1.5">' +
            '<button type="button" data-prn-edit="' + idx + '" class="px-3 h-8 rounded-lg border border-outline-variant hover:border-primary-container text-xs font-semibold">Edit</button>' +
            '<button type="button" data-prn-del="' + idx + '" ' + (list.length <= 1 ? 'disabled ' : '') + 'class="px-3 h-8 rounded-lg text-xs font-semibold text-error hover:bg-error-container/40 disabled:opacity-35">Hapus</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    box.querySelectorAll('[data-prn-edit]').forEach(function (b) {
      b.onclick = function () {
        const i = Number(b.getAttribute('data-prn-edit'));
        const item = list[i];
        if (!item) return;
        document.getElementById('prn-edit-idx').value = String(i);
        document.getElementById('prn-nama').value = item.nama || '';
        document.getElementById('prn-ket').value = item.keterangan || '';
        document.getElementById('btn-prn-label').textContent = 'Simpan';
        document.getElementById('btn-prn-cancel').classList.remove('hidden');
        document.getElementById('prn-nama').focus();
      };
    });

    box.querySelectorAll('[data-prn-del]').forEach(function (b) {
      b.onclick = function () {
        const i = Number(b.getAttribute('data-prn-del'));
        if (list.length <= 1) {
          toast('Minimal harus tersisa 1 sebutan pihak persidangan.', 'warning');
          return;
        }
        const next = list.filter(function (_, idx) { return idx !== i; });
        resetPeranForm();
        savePeranList(next);
      };
    });

    box.querySelectorAll('[data-prn-up]').forEach(function (b) {
      b.onclick = function () {
        const i = Number(b.getAttribute('data-prn-up'));
        if (i <= 0) return;
        const next = list.slice();
        const tmp = next[i - 1]; next[i - 1] = next[i]; next[i] = tmp;
        savePeranList(next);
      };
    });

    box.querySelectorAll('[data-prn-down]').forEach(function (b) {
      b.onclick = function () {
        const i = Number(b.getAttribute('data-prn-down'));
        if (i >= list.length - 1) return;
        const next = list.slice();
        const tmp = next[i + 1]; next[i + 1] = next[i]; next[i] = tmp;
        savePeranList(next);
      };
    });
  }

  function resetLoketForm() {
    const f = document.getElementById('form-loket');
    if (f) f.reset();
    const idxEl = document.getElementById('lkt-edit-idx');
    if (idxEl) idxEl.value = '-1';
    const lbl = document.getElementById('btn-lkt-label');
    if (lbl) lbl.textContent = 'Tambah';
    const cancel = document.getElementById('btn-lkt-cancel');
    if (cancel) cancel.classList.add('hidden');
  }

  async function saveLoketList(nextList) {
    if (!nextList.length) {
      toast('Minimal harus tersisa 1 loket layanan PTSP aktif.', 'warning');
      return;
    }
    const prevRaw = state.boot && state.boot.pengaturan ? state.boot.pengaturan.LOKET_PTSP_JSON : '';
    // Optimistic UI (0ms langsung tampil di seluruh halaman)
    if (!state.boot) state.boot = { pengaturan: {} };
    if (!state.boot.pengaturan) state.boot.pengaturan = {};
    state.boot.pengaturan.LOKET_PTSP_JSON = JSON.stringify(nextList);
    renderAdminLoketList();
    renderKioskLoketPills();
    renderPtspLoketGrid();
    if (state.pantau) renderPantau();

    const res = await window.ApiClient.call('loket.simpan', { loketList: nextList });
    if (res && res.success) {
      toast(res.message || 'Daftar loket diperbarui.', 'success');
      loadBootPublic(false);
    } else {
      state.boot.pengaturan.LOKET_PTSP_JSON = prevRaw;
      renderAdminLoketList();
      renderKioskLoketPills();
      renderPtspLoketGrid();
      toast((res && res.message) || 'Gagal menyimpan daftar loket.', 'error');
    }
  }

  function renderAdminLoketList() {
    const box = document.getElementById('admin-loket-list');
    const countEl = document.getElementById('admin-loket-count');
    if (!box) return;
    const list = getLoketList();
    if (countEl) countEl.textContent = list.length + ' Loket Aktif';

    box.innerHTML = list.map(function (l, idx) {
      return '<div class="p-4 rounded-xl bg-white border border-outline-variant/50 flex flex-col justify-between gap-3 shadow-sm">' +
        '<div>' +
          '<div class="flex items-center justify-between gap-2 mb-1">' +
            '<span class="font-display font-bold text-sm text-on-surface">' + esc(l.nama) + '</span>' +
            '<span class="text-[10px] px-2 py-0.5 rounded bg-secondary-fixed text-on-secondary-fixed font-bold">' + esc(l.badge || ('LOKET ' + (idx + 1))) + '</span>' +
          '</div>' +
          '<div class="text-[11px] font-mono text-primary-container font-semibold mb-1">Kode: ' + esc(l.kode) + '</div>' +
          '<p class="text-xs text-on-surface-variant">' + esc(l.deskripsi || '-') + '</p>' +
        '</div>' +
        '<div class="pt-2 border-t border-outline-variant/30 flex items-center justify-between gap-2">' +
          '<div class="flex items-center gap-1">' +
            '<button type="button" data-lkt-up="' + idx + '" ' + (idx === 0 ? 'disabled ' : '') + 'class="px-2 h-8 rounded-lg border border-outline-variant text-xs hover:bg-surface-container-low disabled:opacity-35" title="Geser Naik">↑</button>' +
            '<button type="button" data-lkt-down="' + idx + '" ' + (idx === list.length - 1 ? 'disabled ' : '') + 'class="px-2 h-8 rounded-lg border border-outline-variant text-xs hover:bg-surface-container-low disabled:opacity-35" title="Geser Turun">↓</button>' +
          '</div>' +
          '<div class="flex items-center gap-1.5">' +
            '<button type="button" data-lkt-edit="' + idx + '" class="px-3 h-8 rounded-lg border border-outline-variant hover:border-primary-container text-xs font-semibold">Edit</button>' +
            '<button type="button" data-lkt-del="' + idx + '" ' + (list.length <= 1 ? 'disabled ' : '') + 'class="px-3 h-8 rounded-lg text-xs font-semibold text-error hover:bg-error-container/40 disabled:opacity-35">Hapus</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    box.querySelectorAll('[data-lkt-edit]').forEach(function (b) {
      b.onclick = function () {
        const i = Number(b.getAttribute('data-lkt-edit'));
        const item = list[i];
        if (!item) return;
        document.getElementById('lkt-edit-idx').value = String(i);
        document.getElementById('lkt-kode').value = item.kode || '';
        document.getElementById('lkt-nama').value = item.nama || '';
        document.getElementById('lkt-badge').value = item.badge || '';
        document.getElementById('lkt-desk').value = item.deskripsi || '';
        document.getElementById('btn-lkt-label').textContent = 'Simpan';
        document.getElementById('btn-lkt-cancel').classList.remove('hidden');
        document.getElementById('lkt-kode').focus();
      };
    });

    box.querySelectorAll('[data-lkt-del]').forEach(function (b) {
      b.onclick = function () {
        const i = Number(b.getAttribute('data-lkt-del'));
        if (list.length <= 1) {
          toast('Minimal harus tersisa 1 loket layanan PTSP.', 'warning');
          return;
        }
        const next = list.filter(function (_, idx) { return idx !== i; });
        resetLoketForm();
        saveLoketList(next);
      };
    });

    box.querySelectorAll('[data-lkt-up]').forEach(function (b) {
      b.onclick = function () {
        const i = Number(b.getAttribute('data-lkt-up'));
        if (i <= 0) return;
        const next = list.slice();
        const tmp = next[i - 1]; next[i - 1] = next[i]; next[i] = tmp;
        saveLoketList(next);
      };
    });

    box.querySelectorAll('[data-lkt-down]').forEach(function (b) {
      b.onclick = function () {
        const i = Number(b.getAttribute('data-lkt-down'));
        if (i >= list.length - 1) return;
        const next = list.slice();
        const tmp = next[i + 1]; next[i + 1] = next[i]; next[i] = tmp;
        saveLoketList(next);
      };
    });
  }

  async function loadAdminJadwal() {
    renderRuangSidangSelects();
    document.getElementById('jdw-tgl').value = document.getElementById('jdw-tgl').value || todayYmd();
    const res = await window.ApiClient.call('jadwal.list', {});
    const list = (res && res.success && res.data) ? res.data : [];
    const box = document.getElementById('admin-jadwal-list');
    box.innerHTML = list.map(function (j) {
      return '<div class="p-3 rounded-xl border border-outline-variant/50 flex flex-wrap items-center justify-between gap-2 text-sm">' +
        '<div><span class="font-bold text-primary-container">' + esc(j.Nomor_Perkara) + '</span> <span class="text-xs text-outline">(' + esc(String(j.Tanggal).slice(0, 10)) + ' • ' + esc(j.Ruang_Sidang) + ')</span><div class="text-xs text-on-surface-variant">' + esc(j.Agenda || '-') + '</div></div>' +
        '<button type="button" data-del-jdw="' + esc(j.ID_Jadwal) + '" class="px-3 py-1.5 rounded-lg text-xs font-semibold text-error hover:bg-error-container/40">Hapus</button>' +
      '</div>';
    }).join('') || '<div class="text-xs text-on-surface-variant">Belum ada jadwal sidang.</div>';

    box.querySelectorAll('[data-del-jdw]').forEach(function (b) {
      b.onclick = async function () {
        const r = await window.ApiClient.call('jadwal.hapus', { ID_Jadwal: b.getAttribute('data-del-jdw') });
        if (r && r.success) { toast(r.message, 'success'); loadAdminJadwal(); loadBootPublic(false); }
      };
    });
  }

  async function loadAdminUsers() {
    const res = await window.ApiClient.call('users.list', {});
    if (res && res.success) renderAdminUsers(res.data || []);
  }

  function renderAdminUsers(users) {
    const box = document.getElementById('admin-users-list');
    box.innerHTML = '<table class="w-full text-left text-sm"><thead><tr class="text-xs uppercase text-outline border-b"><th class="py-2">Username</th><th class="py-2">Nama</th><th class="py-2">Role</th><th class="py-2">Status</th><th class="py-2 text-right">Sesi</th></tr></thead><tbody class="divide-y">' +
      users.map(function (u) {
        return '<tr><td class="py-2.5 font-mono font-bold">' + esc(u.Username) + '</td><td class="py-2.5">' + esc(u.Nama_Petugas) + '</td><td class="py-2.5"><span class="px-2 py-0.5 rounded bg-surface-container text-xs font-bold">' + esc(u.Role) + '</span></td><td class="py-2.5">' + esc(u.Status_Aktif) + '</td><td class="py-2.5 text-right"><button type="button" data-rev="' + esc(u.Username) + '" class="px-2.5 py-1 rounded border border-outline-variant text-xs font-semibold hover:bg-error-container/40">Cabut Sesi</button></td></tr>';
      }).join('') + '</tbody></table>';
    box.querySelectorAll('[data-rev]').forEach(function (b) {
      b.onclick = async function () {
        const r = await window.ApiClient.call('users.cabutSesi', { username: b.getAttribute('data-rev') });
        if (r && r.success) toast(r.message, 'success');
      };
    });
  }

  async function loadAdminPengaturan() {
    const res = await window.ApiClient.call('pengaturan.get', {});
    if (!res || !res.success || !res.data) return;
    const p = res.data.pengaturan || {};
    document.getElementById('cfg-nama').value = p.NAMA_SATKER || '';
    document.getElementById('cfg-alamat').value = p.ALAMAT_SATKER || '';
    document.getElementById('cfg-jam').value = p.JAM_LAYANAN || '';
    document.getElementById('cfg-kaki').value = p.CATATAN_KAKI_STRUK || '';
    if (p.NAMA_SATKER) applySatkerName(p.NAMA_SATKER);
    applySatkerLogo(p.LOGO_URL || '');
    if (p.LOKET_PTSP_JSON) {
      if (!state.boot) state.boot = { pengaturan: {} };
      if (!state.boot.pengaturan) state.boot.pengaturan = {};
      state.boot.pengaturan.LOKET_PTSP_JSON = p.LOKET_PTSP_JSON;
    }
    if (p.PERAN_SIDANG_JSON) {
      if (!state.boot) state.boot = { pengaturan: {} };
      if (!state.boot.pengaturan) state.boot.pengaturan = {};
      state.boot.pengaturan.PERAN_SIDANG_JSON = p.PERAN_SIDANG_JSON;
    }
    if (p.RUANG_SIDANG_JSON) {
      if (!state.boot) state.boot = { pengaturan: {} };
      if (!state.boot.pengaturan) state.boot.pengaturan = {};
      state.boot.pengaturan.RUANG_SIDANG_JSON = p.RUANG_SIDANG_JSON;
    }
    renderAdminLoketList();
    renderAdminPeranList();
    renderAdminRuangList();
    renderRuangSidangSelects();

    // Muat Pengaturan Display & Video Antrean
    loadAdminDisplayTab();

    applyMaskedSecrets(res.data.rahasia || {});
    loadWaStatus();

    window.StrukUI.renderEditor(
      document.getElementById('admin-template-editor'),
      res.data.templates || [],
      res.data.printer || {},
      function (newTpls, msg) {
        toast(msg || 'Template diperbarui.', 'success');
        loadBootPublic(false);
        loadAdminPengaturan();
      },
      p
    );
  }

  function applyMaskedSecrets(rah) {
    Object.keys(rah).forEach(function (k) {
      const el = document.getElementById('mask-' + k);
      if (el) el.textContent = rah[k].ada ? ('[' + rah[k].samar + ']') : '[Belum diatur]';
    });
    if (rah && rah.WA_GATEWAY_TOKEN) {
      const cardMask = document.getElementById('wa-card-mask-status');
      if (cardMask) {
        cardMask.textContent = rah.WA_GATEWAY_TOKEN.ada ? ('[' + rah.WA_GATEWAY_TOKEN.samar + ']') : '[Belum diatur]';
        cardMask.className = rah.WA_GATEWAY_TOKEN.ada ? 'text-[11px] font-mono text-emerald-700 font-semibold' : 'text-[11px] font-mono text-amber-700';
      }
    }
  }

  async function loadWaStatus() {
    const badge = document.getElementById('wa-status-badge');
    const deviceEl = document.getElementById('wa-device-num');
    const quotaEl = document.getElementById('wa-quota-info');
    const expEl = document.getElementById('wa-expired-info');
    const diagEl = document.getElementById('wa-diag-info');
    if (!badge) return;

    badge.className = 'px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-600 border border-slate-200 animate-pulse cursor-pointer';
    badge.textContent = 'Memeriksa...';
    if (diagEl) diagEl.textContent = 'Menghubungi Fonnte Gateway...';

    const res = await window.ApiClient.call('wa.cekStatus', {});
    badge.classList.remove('animate-pulse');
    if (res && res.success && res.data) {
      const d = res.data;
      if (!d.configured) {
        badge.className = 'px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200 cursor-pointer hover:bg-amber-100';
        badge.textContent = 'Token Belum Diatur';
        if (deviceEl) deviceEl.textContent = 'Belum diisi di Script Properties';
        if (quotaEl) quotaEl.textContent = '-';
        if (expEl) expEl.textContent = '-';
        if (diagEl) diagEl.textContent = 'Silakan klik tombol "Atur Token Fonnte" untuk memasukkan token.';
      } else if (d.connected || d.device_status === 'connect') {
        badge.className = 'px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-pointer hover:bg-emerald-100';
        badge.textContent = 'Terhubung';
        if (deviceEl) deviceEl.textContent = d.device || '-';
        if (quotaEl) quotaEl.textContent = (d.messages !== undefined ? d.messages : '-') + ' pesan' + (d.quota ? ' / kuota ' + d.quota : '');
        if (expEl) expEl.textContent = d.expired || '-';
        if (diagEl) diagEl.textContent = 'Perangkat aktif & siap mengirim notifikasi/siaran.';
      } else {
        badge.className = 'px-2.5 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200 cursor-pointer hover:bg-rose-100';
        badge.textContent = d.device_status === 'disconnect' ? 'Terputus (QR Expired)' : 'Koneksi Gagal';
        if (deviceEl) deviceEl.textContent = d.device || '-';
        if (quotaEl) quotaEl.textContent = d.messages !== undefined ? String(d.messages) : '-';
        if (expEl) expEl.textContent = d.expired || '-';
        if (diagEl) diagEl.textContent = d.message || d.reason || 'Koneksi Fonnte ditolak. Cek token atau scan QR di fonnte.com.';
      }
    } else {
      badge.className = 'px-2.5 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200 cursor-pointer';
      badge.textContent = 'Koneksi Gagal';
      const errMsg = (res && res.message) || 'Tidak dapat terhubung';
      if (diagEl) diagEl.textContent = errMsg.indexOf('tidak dikenali') > -1
        ? 'Backend GAS belum di-deploy versi baru. Buka Google Apps Script > Deploy > New version.'
        : errMsg;
    }
  }

  // ==========================================================================
  // MODUL GAS-NOTIFIKASI-WA-CRM (WhatsApp Gateway, CRM Kontak & Blast WA)
  // ==========================================================================
  async function loadNotifCrmTab() {
    await loadWaStatus();
    await loadNotifConfig();
    loadCrmKontakList();
  }

  async function loadNotifConfig() {
    const res = await window.ApiClient.call('notif.config.get', {});
    if (!res || !res.success || !res.data) return;
    const d = res.data;
    const chkGlobal = document.getElementById('notif-global-toggle');
    if (chkGlobal) chkGlobal.checked = d.waAktif !== false;

    if (Array.isArray(d.events)) {
      d.events.forEach(function (ev) {
        const chk = document.getElementById('m-aktif-' + ev.key);
        if (chk) chk.checked = ev.aktif !== false;
        const txt = document.getElementById('m-pesan-' + ev.key);
        if (txt) txt.value = ev.pesan || '';
      });
    }
  }

  async function simpanNotifConfig() {
    const btn = document.getElementById('btn-simpan-matriks');
    const chkGlobal = document.getElementById('notif-global-toggle');
    const events = [];
    const eventKeys = ['PENDAFTARAN_PTSP', 'PENDAFTARAN_SIDANG', 'PANGGILAN_PTSP', 'PANGGILAN_SIDANG'];

    eventKeys.forEach(function (k) {
      const chk = document.getElementById('m-aktif-' + k);
      const txt = document.getElementById('m-pesan-' + k);
      events.push({
        key: k,
        aktif: chk ? chk.checked : true,
        pesan: txt ? txt.value.trim() : ''
      });
    });

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="material-symbols-outlined text-sm animate-spin">refresh</span><span>Menyimpan...</span>';
    }

    const res = await window.ApiClient.call('notif.config.simpan', {
      NOTIF_WA_AKTIF: (chkGlobal && chkGlobal.checked) ? 'YA' : 'TIDAK',
      events: events
    });

    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-symbols-outlined text-sm">save</span><span>Simpan Perubahan Matriks &amp; Template</span>';
    }

    if (res && res.success) {
      toast(res.message || 'Konfigurasi matriks notifikasi berhasil disimpan!', 'success');
    } else {
      toast((res && res.message) || 'Gagal menyimpan konfigurasi notifikasi.', 'error');
    }
  }

  async function loadCrmKontakList() {
    const tbody = document.getElementById('crm-kontak-tbody');
    if (tbody && (!state.crmKontakList || !state.crmKontakList.length)) {
      tbody.innerHTML = '<tr><td colspan="8" class="p-6 text-center text-on-surface-variant">Memuat data kontak...</td></tr>';
    }
    const res = await window.ApiClient.call('crm.list', {});
    if (res && res.success && Array.isArray(res.data)) {
      state.crmKontakList = res.data;
      renderCrmKontakTable();
    } else {
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="8" class="p-6 text-center text-rose-600">Gagal memuat kontak: ' + esc((res && res.message) || 'Koneksi error') + '</td></tr>';
      }
    }
  }

  function renderCrmKontakTable() {
    const tbody = document.getElementById('crm-kontak-tbody');
    if (!tbody) return;
    const list = state.crmKontakList || [];
    const q = (document.getElementById('crm-search-kontak')?.value || '').trim().toLowerCase();
    const seg = document.getElementById('crm-filter-segmen')?.value || '';

    const filtered = list.filter(function (c) {
      const matchQ = !q || (String(c.Nama || '').toLowerCase().includes(q) || String(c.NoWA || '').includes(q) || String(c.Catatan || '').toLowerCase().includes(q));
      const matchSeg = !seg || String(c.Segmen || '').toUpperCase() === seg.toUpperCase();
      return matchQ && matchSeg;
    });

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="p-6 text-center text-on-surface-variant">Tidak ada kontak yang cocok dengan filter.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(function (c) {
      const segBadge = c.Segmen === 'Sidang'
        ? '<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-purple-50 text-purple-700 border border-purple-200">Sidang</span>'
        : '<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200">PTSP</span>';

      const isRegistered = c.StatusWA === 'Terdaftar' || c.StatusWA === 'Aktif';
      const isUnregistered = c.StatusWA === 'Tidak Terdaftar';
      const waStatusBadge = isRegistered
        ? '<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Terdaftar</span>'
        : (isUnregistered
            ? '<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">Bukan WA</span>'
            : '<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200">Belum Validasi</span>');

      const hpClean = String(c.NoWA || '').replace(/[^\d]/g, '');
      const waHp = hpClean.indexOf('0') === 0 ? '62' + hpClean.slice(1) : hpClean;
      const tglHadir = c.TerakhirDihubungi ? c.TerakhirDihubungi.split('T')[0] : '-';

      return '<tr class="border-b border-outline-variant/30 hover:bg-surface-container-low/40">' +
        '<td class="p-3 font-mono font-bold text-slate-600">' + esc(c.KontakID || '-') + '</td>' +
        '<td class="p-3"><div class="font-bold text-on-surface">' + esc(c.Nama || '-') + '</div><div class="text-[11px] text-on-surface-variant">' + esc(c.Catatan || '-') + '</div></td>' +
        '<td class="p-3 font-mono">' + esc(c.NoWA || '-') + '</td>' +
        '<td class="p-3">' + segBadge + '</td>' +
        '<td class="p-3">' + waStatusBadge + '</td>' +
        '<td class="p-3 font-mono text-center">' + esc(c.JumlahPesan || 1) + 'x</td>' +
        '<td class="p-3 text-on-surface-variant">' + esc(tglHadir) + '</td>' +
        '<td class="p-3 text-right">' +
          '<a href="https://wa.me/' + waHp + '?text=' + encodeURIComponent('Halo Bapak/Ibu ' + (c.Nama || '') + ', ') + '" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs">' +
            '<span class="material-symbols-outlined text-xs">chat</span><span>Chat</span>' +
          '</a>' +
        '</td>' +
      '</tr>';
    }).join('');
  }

  async function loadBlastList() {
    const tbody = document.getElementById('blast-riwayat-tbody');
    const res = await window.ApiClient.call('blast.list', {});
    if (!tbody) return;
    if (res && res.success && Array.isArray(res.data) && res.data.length) {
      tbody.innerHTML = res.data.map(function (b) {
        const statusBadge = b.Status === 'Selesai'
          ? '<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Selesai</span>'
          : '<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">Proses</span>';

        return '<tr class="border-b border-outline-variant/30 hover:bg-surface-container-low/40">' +
          '<td class="p-3 font-mono font-bold text-slate-600">' + esc(b.BlastID || '-') + '</td>' +
          '<td class="p-3 font-semibold text-on-surface">' + esc(b.Judul || '-') + '</td>' +
          '<td class="p-3"><span class="px-2 py-0.5 rounded text-[11px] bg-slate-100 font-mono">' + esc(b.Sasaran || 'SEMUA') + '</span></td>' +
          '<td class="p-3 font-mono">' + esc(b.Terkirim || 0) + ' / ' + esc(b.Total || 0) + (b.Gagal ? ' <span class="text-rose-600">(' + b.Gagal + ' gagal)</span>' : '') + '</td>' +
          '<td class="p-3">' + statusBadge + '</td>' +
          '<td class="p-3 text-on-surface-variant font-mono">' + esc(b.Tanggal || '-') + '</td>' +
        '</tr>';
      }).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-on-surface-variant">Belum ada riwayat siaran broadcast.</td></tr>';
    }
  }

  async function kirimBlastWa() {
    const btn = document.getElementById('btn-blast-kirim');
    const sasaran = document.getElementById('blast-sasaran').value;
    const judul = (document.getElementById('blast-judul').value || '').trim();
    const pesan = (document.getElementById('blast-pesan').value || '').trim();
    const batch = Number(document.getElementById('blast-batch').value) || 10;
    const jeda = Number(document.getElementById('blast-jeda').value) || 2;

    if (!judul || !pesan) {
      toast('Judul dan isi pesan siaran wajib diisi.', 'warning');
      return;
    }

    if (!confirm('Kirim siaran WhatsApp massal ini ke target "' + sasaran + '"?')) return;

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="material-symbols-outlined text-sm animate-spin">refresh</span><span>Mengirim Siaran...</span>';
    }

    const res = await window.ApiClient.call('blast.kirim', {
      sasaran: sasaran,
      judul: judul,
      pesan: pesan,
      batchSize: batch,
      delaySec: jeda
    });

    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-symbols-outlined text-sm">send</span><span>Kirim Siaran WhatsApp</span>';
    }

    if (res && res.success) {
      toast(res.message || 'Siaran broadcast berhasil dikirim!', 'success');
      document.getElementById('blast-judul').value = '';
      document.getElementById('blast-pesan').value = '';
      loadBlastList();
    } else {
      toast((res && res.message) || 'Gagal mengirim siaran broadcast.', 'error');
    }
  }

  async function loadAntrianList() {
    const tbody = document.getElementById('notif-antrian-tbody');
    const res = await window.ApiClient.call('notif.antrian.list', {});
    if (!tbody) return;
    if (res && res.success && Array.isArray(res.data) && res.data.length) {
      tbody.innerHTML = res.data.map(function (a) {
        const isSukses = a.Status === 'Terkirim';
        const isGagal = a.Status === 'Gagal';
        const statusBadge = isSukses
          ? '<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Terkirim</span>'
          : (isGagal
              ? '<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">Gagal</span>'
              : '<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">Antre</span>');

        const waktu = a.DibuatPada ? a.DibuatPada.replace('T', ' ').slice(0, 19) : '-';

        return '<tr class="border-b border-outline-variant/30 hover:bg-surface-container-low/40">' +
          '<td class="p-3 font-mono font-bold text-slate-600">' + esc(a.AntrianID || '-') + '</td>' +
          '<td class="p-3 font-mono text-[11px] text-on-surface-variant">' + esc(waktu) + '</td>' +
          '<td class="p-3 font-semibold text-on-surface">' + esc(a.NamaPenerima || '-') + '</td>' +
          '<td class="p-3 font-mono text-xs">' + esc(a.Tujuan || '-') + '</td>' +
          '<td class="p-3"><span class="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-100">' + esc(a.Event || '-') + '</span></td>' +
          '<td class="p-3">' + statusBadge + '</td>' +
          '<td class="p-3 font-mono text-[11px] text-on-surface-variant max-w-xs truncate" title="' + esc(a.Respon || '-') + '">' + esc(a.Respon || '-') + '</td>' +
        '</tr>';
      }).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-on-surface-variant">Belum ada antrean notifikasi tersimpan.</td></tr>';
    }
  }

  async function prosesAntrianSekarang() {
    const btn = document.getElementById('btn-antrian-proses');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="material-symbols-outlined text-sm animate-spin">refresh</span><span>Memproses...</span>';
    }
    const res = await window.ApiClient.call('notif.antrian.proses', {});
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-symbols-outlined text-sm">forward_to_inbox</span><span>Proses / Kuras Antrean Sekarang</span>';
    }
    if (res && res.success) {
      toast(res.message || 'Antrean notifikasi diproses.', 'success');
      loadAntrianList();
    } else {
      toast((res && res.message) || 'Gagal memproses antrean.', 'error');
    }
  }

  function initCrmEvents() {
    // Sub-nav tab switcher
    document.querySelectorAll('.crm-sub-btn').forEach(function (btn) {
      btn.onclick = function () {
        const sub = btn.getAttribute('data-csub');
        document.querySelectorAll('.crm-sub-btn').forEach(function (b) {
          const act = b.getAttribute('data-csub') === sub;
          b.className = act
            ? 'crm-sub-btn px-3.5 py-1.5 rounded-lg text-xs font-bold bg-primary-container text-white flex items-center gap-1.5 whitespace-nowrap shadow-sm'
            : 'crm-sub-btn px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-surface-container-low text-on-surface-variant hover:text-on-surface flex items-center gap-1.5 whitespace-nowrap';
        });
        document.querySelectorAll('.crm-sub-pane').forEach(function (p) {
          p.classList.toggle('hidden', p.id !== 'csub-' + sub);
        });

        if (sub === 'kontak') loadCrmKontakList();
        if (sub === 'blast') loadBlastList();
        if (sub === 'antrian') loadAntrianList();
        if (sub === 'gateway') { loadWaStatus(); loadNotifConfig(); }
      };
    });

    // Simpan Matriks Notifikasi & Template
    const btnSimpanMatriks = document.getElementById('btn-simpan-matriks');
    if (btnSimpanMatriks) btnSimpanMatriks.onclick = simpanNotifConfig;

    // Filter & Cari Kontak CRM
    const inpSearchKontak = document.getElementById('crm-search-kontak');
    if (inpSearchKontak) inpSearchKontak.oninput = renderCrmKontakTable;
    const selFilterSegmen = document.getElementById('crm-filter-segmen');
    if (selFilterSegmen) selFilterSegmen.onchange = renderCrmKontakTable;

    // Sinkronisasi Kontak dari Buku Tamu
    const btnSyncCrm = document.getElementById('btn-crm-sync');
    if (btnSyncCrm) {
      btnSyncCrm.onclick = async function () {
        btnSyncCrm.disabled = true;
        btnSyncCrm.innerHTML = '<span class="material-symbols-outlined text-sm animate-spin">refresh</span><span>Menyinkronkan...</span>';
        const res = await window.ApiClient.call('crm.sync', {});
        btnSyncCrm.disabled = false;
        btnSyncCrm.innerHTML = '<span class="material-symbols-outlined text-sm">sync</span><span>Sinkronisasi dari Buku Tamu</span>';
        if (res && res.success) {
          toast(res.message || 'Sinkronisasi kontak berhasil!', 'success');
          loadCrmKontakList();
        } else {
          toast((res && res.message) || 'Gagal sinkronisasi kontak.', 'error');
        }
      };
    }

    // Validasi Nomor WA Fonnte
    const btnValidateCrm = document.getElementById('btn-crm-validate');
    if (btnValidateCrm) {
      btnValidateCrm.onclick = async function () {
        const list = state.crmKontakList || [];
        const phones = list.map(function (c) { return c.NoWA; }).filter(Boolean);
        if (!phones.length) {
          toast('Belum ada nomor telepon kontak untuk divalidasi.', 'warning');
          return;
        }
        btnValidateCrm.disabled = true;
        btnValidateCrm.innerHTML = '<span class="material-symbols-outlined text-sm animate-spin">refresh</span><span>Memvalidasi...</span>';
        const res = await window.ApiClient.call('crm.validate', { nomorList: phones.slice(0, 50) });
        btnValidateCrm.disabled = false;
        btnValidateCrm.innerHTML = '<span class="material-symbols-outlined text-sm">verified</span><span>Validasi Nomor WA (Fonnte)</span>';
        if (res && res.success) {
          toast(res.message || 'Validasi nomor WhatsApp berhasil!', 'success');
          loadCrmKontakList();
        } else {
          toast((res && res.message) || 'Gagal memvalidasi nomor WhatsApp.', 'error');
        }
      };
    }

    // Kirim Blast WA
    const btnBlastKirim = document.getElementById('btn-blast-kirim');
    if (btnBlastKirim) btnBlastKirim.onclick = kirimBlastWa;

    // Kuras Antrean Notifikasi
    const btnAntrianProses = document.getElementById('btn-antrian-proses');
    if (btnAntrianProses) btnAntrianProses.onclick = prosesAntrianSekarang;
  }

  async function runMigrasi(dryRun) {
    const src = document.getElementById('mig-source-id').value.trim();
    if (!src) {
      toast('Masukkan URL atau ID Spreadsheet sumber terlebih dahulu.', 'warning');
      return;
    }
    const res = await window.ApiClient.call(dryRun ? 'migrasi.pindai' : 'migrasi.eksekusi', { sourceId: src });
    const box = document.getElementById('mig-result-box');
    box.classList.remove('hidden');
    if (res && res.success) {
      box.textContent = JSON.stringify(res.data, null, 2);
      toast(res.message, 'success');
      if (!dryRun) loadDashboardData();
    } else {
      box.textContent = 'Error: ' + ((res && res.message) || 'Gagal');
      toast((res && res.message) || 'Gagal menjalankan migrasi.', 'error');
    }
  }

  // ==========================================================================
  // VIEW 7: DISPLAY RUANG TUNGGU PUBLIK / DASHBOARD ANTREAN TV ENGINE
  // ==========================================================================
  const DEFAULT_DISPLAY_SETTINGS = {
    ytId: 'r72fG0644_k',
    marquee: 'Selamat Datang di Pengadilan Tata Usaha Negara Palembang • Pelayanan Terpadu Satu Pintu (PTSP) melayani dengan Tulus, Cepat, Akuntabel, dan Transparan • Seluruh layanan peradilan bebas dari pungutan liar, gratifikasi, dan korupsi.',
    audioEnabled: true,       // Suara Bel & Panggilan Antrean
    videoSound: false,        // Suara Video YouTube (default mute agar autoplay diizinkan browser)
    autoMuteOnCall: true      // Mute suara video otomatis saat pemanggilan nomor antrean
  };

  function getDisplaySettings() {
    try {
      const raw = localStorage.getItem('ETAMU_DISPLAY_SETTINGS');
      if (raw) {
        const parsed = JSON.parse(raw);
        return Object.assign({}, DEFAULT_DISPLAY_SETTINGS, parsed);
      }
    } catch (e) {}
    return Object.assign({}, DEFAULT_DISPLAY_SETTINGS);
  }

  function saveDisplaySettings(settings) {
    try {
      localStorage.setItem('ETAMU_DISPLAY_SETTINGS', JSON.stringify(settings));
    } catch (e) {}
  }

  function extractYouTubeId(urlOrId) {
    if (!urlOrId) return '';
    const str = String(urlOrId).trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(str)) return str;
    const regExp = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=|shorts\/)|youtu\.be\/)([^"&?\/\s]{11})/i;
    const match = str.match(regExp);
    return match ? match[1] : '';
  }

  // Dapatkan elemen iframe video yang saat ini aktif ditampilkan
  function getActiveVideoIframe() {
    if (state.view === 'display') {
      return document.getElementById('display-yt-iframe');
    }
    return document.getElementById('kiosk-yt-iframe');
  }

  // Kirim perintah langsung ke YouTube IFrame API via window.postMessage (HANYA iframe aktif)
  function sendYouTubeCommand(funcName, args) {
    const safeArgs = Array.isArray(args) ? args : (args !== undefined ? [args] : []);
    const payload = JSON.stringify({
      event: 'command',
      func: funcName,
      args: safeArgs
    });

    const activeIframe = getActiveVideoIframe();
    if (activeIframe && activeIframe.contentWindow) {
      try {
        activeIframe.contentWindow.postMessage(payload, '*');
      } catch (err) {}
    }

    // Pastikan iframe pasif selalu dimatikan suaranya agar tidak timbul suara ganda / dobel
    const inactiveId = (state.view === 'display') ? 'kiosk-yt-iframe' : 'display-yt-iframe';
    const inactiveIframe = document.getElementById(inactiveId);
    if (inactiveIframe && inactiveIframe.contentWindow) {
      try {
        inactiveIframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), '*');
        inactiveIframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'mute', args: [] }), '*');
      } catch (e) {}
    }
  }

  function applyYouTubePlayer(videoId) {
    const st = getDisplaySettings();
    const vid = videoId || st.ytId || DEFAULT_DISPLAY_SETTINGS.ytId;
    const targetSrc = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(vid) +
      '?autoplay=1&mute=1&loop=1&playlist=' + encodeURIComponent(vid) +
      '&controls=1&rel=0&modestbranding=1&playsinline=1&enablejsapi=1';

    const activeId = (state.view === 'display') ? 'display-yt-iframe' : 'kiosk-yt-iframe';
    const inactiveId = (activeId === 'display-yt-iframe') ? 'kiosk-yt-iframe' : 'display-yt-iframe';

    const activeIframe = document.getElementById(activeId);
    const inactiveIframe = document.getElementById(inactiveId);

    // 1. Matikan dan kosongkan iframe pasif agar TIDAK ADA suara dobel / tabrakan
    if (inactiveIframe) {
      try {
        if (inactiveIframe.contentWindow) {
          inactiveIframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), '*');
          inactiveIframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'mute', args: [] }), '*');
        }
      } catch (e) {}
      inactiveIframe.src = '';
    }

    // 2. Pasang video HANYA pada iframe aktif
    if (activeIframe) {
      const currentSrc = activeIframe.getAttribute('src') || '';
      if (currentSrc.indexOf(vid) === -1 || currentSrc.indexOf('enablejsapi=1') === -1) {
        activeIframe.src = targetSrc;
      }
      if (st.videoSound === true) {
        setTimeout(function () {
          sendYouTubeCommand('unMute', []);
          sendYouTubeCommand('setVolume', [80]);
          sendYouTubeCommand('playVideo', []);
        }, 1200);
      }
    }
  }

  function playQueueChime() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;

      // Nada 1: 523.25 Hz (C5)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(523.25, now);
      gain1.gain.setValueAtTime(0.22, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.45);

      // Nada 2: 659.25 Hz (E5)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(659.25, now + 0.22);
      gain2.gain.setValueAtTime(0.26, now + 0.22);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.85);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.22);
      osc2.stop(now + 0.85);
    } catch (e) {}
  }

  let isCallAudioActive = false;

  function panggilSuaraDisplay(teks) {
    const st = getDisplaySettings();
    if (st.audioEnabled === false) return;

    // Saat pemanggilan nomor antrean: suara video YouTube tidak aktif (Mute otomatis)
    const shouldMuteVideo = (st.autoMuteOnCall !== false) && (st.videoSound === true);
    if (shouldMuteVideo) {
      isCallAudioActive = true;
      sendYouTubeCommand('mute');
    }

    // Bunyikan nada bel chime (Ding-dong)
    playQueueChime();

    // Panggil suara Text-to-Speech setelah nada bel selesai (450ms)
    setTimeout(function () {
      panggilSuara(teks, function onSpeechEnd() {
        // Saat suara panggilan selesai, pulihkan suara video jika sebelumnya bersuara
        if (shouldMuteVideo && isCallAudioActive) {
          isCallAudioActive = false;
          setTimeout(function () {
            const curSt = getDisplaySettings();
            if (curSt.videoSound === true) {
              sendYouTubeCommand('unMute');
              sendYouTubeCommand('setVolume', [80]);
            }
          }, 600);
        }
      });
    }, 450);
  }

  function toggleDisplayAudio() {
    const st = getDisplaySettings();
    const nextSound = !(st.videoSound === true);
    st.videoSound = nextSound;
    if (nextSound) {
      st.audioEnabled = true;
    }
    saveDisplaySettings(st);

    if (nextSound) {
      sendYouTubeCommand('unMute', []);
      sendYouTubeCommand('setVolume', [80]);
      sendYouTubeCommand('playVideo', []);
      toast('Suara TV diaktifkan', 'success');
    } else {
      sendYouTubeCommand('mute', []);
      toast('Suara TV dimatikan (Mute)', 'info');
    }

    updateDisplayAudioButton(st);
    updateKioskAudioButton(st);
  }

  function getLiveQueueState() {
    try {
      const raw = localStorage.getItem('ETAMU_LIVE_QUEUE');
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    const ring = (state.boot && state.boot.ringkasan) ? state.boot.ringkasan : {};
    return {
      nomor: ring.ptspBerjalan || 'P-001',
      loket: 'LOKET 1 - KEPANITERAAN PERKARA',
      nama: 'Pengunjung PTSP',
      jalur: 'PTSP',
      status: 'Sedang Dilayani',
      waktu: 'Pukul 08.30 WIB'
    };
  }

  function getQueueHistory() {
    try {
      const raw = localStorage.getItem('ETAMU_QUEUE_HISTORY');
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length) return arr;
      }
    } catch (e) {}
    return [
      { nomor: 'P-001', loket: 'Loket 1 - PTSP', waktu: '08:30 WIB', status: 'Dilayani' },
      { nomor: 'S-001', loket: 'Ruang Sidang Utama', waktu: '08:15 WIB', status: 'Masuk Sidang' },
      { nomor: 'P-000', loket: 'Loket 2 - Informasi', waktu: '08:00 WIB', status: 'Selesai' }
    ];
  }

  function updateLiveDisplayQueue(data, triggerSpeech) {
    const current = getLiveQueueState();
    const d = new Date();
    const jam = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    data.waktu = 'Pukul ' + jam + ' WIB';

    // Masukkan antrean sebelumnya ke riwayat (maksimal 4 riwayat)
    if (current && current.nomor && current.nomor !== data.nomor) {
      const hist = getQueueHistory().filter(function (h) { return h.nomor !== current.nomor; });
      hist.unshift({
        nomor: current.nomor,
        loket: current.loket,
        waktu: current.waktu ? current.waktu.replace('Pukul ', '') : (jam + ' WIB'),
        status: current.status || 'Dilayani'
      });
      try {
        localStorage.setItem('ETAMU_QUEUE_HISTORY', JSON.stringify(hist.slice(0, 4)));
      } catch (e) {}
    }

    try {
      localStorage.setItem('ETAMU_LIVE_QUEUE', JSON.stringify(data));
    } catch (e) {}

    const shouldSpeak = (triggerSpeech !== false);
    renderDisplayQueue(shouldSpeak);
  }

  function renderDisplayQueue(isNewCall) {
    const data = getLiveQueueState();
    const ring = (state.boot && state.boot.ringkasan) ? state.boot.ringkasan : {};

    // 1. Current Queue Card (Sinkronkan ke Kiosk Publik & Display TV)
    const targets = [
      {
        nomor: document.getElementById('kiosk-curr-nomor'),
        loket: document.getElementById('kiosk-curr-loket'),
        tamu: document.getElementById('kiosk-curr-tamu'),
        time: document.getElementById('kiosk-curr-time'),
        badge: document.getElementById('kiosk-curr-status-badge'),
        card: document.getElementById('kiosk-current-card')
      },
      {
        nomor: document.getElementById('display-curr-nomor'),
        loket: document.getElementById('display-curr-loket'),
        tamu: document.getElementById('display-curr-tamu'),
        time: document.getElementById('display-curr-time'),
        badge: document.getElementById('display-curr-status-badge'),
        card: document.getElementById('display-current-card')
      }
    ];

    targets.forEach(function (t) {
      if (t.nomor) t.nomor.textContent = data.nomor || 'P-001';
      if (t.loket) t.loket.textContent = data.loket || 'LOKET 1 - KEPANITERAAN PERKARA';
      if (t.tamu) t.tamu.textContent = data.nama || 'Pengunjung Pengadilan';
      if (t.time) t.time.textContent = data.waktu || 'Pukul --:-- WIB';
      if (t.badge) t.badge.textContent = data.status ? data.status.toUpperCase() : 'SEDANG DIPANGGIL';

      // Highlight / Pulse Animasi Halus saat nomor antrean berganti
      if (isNewCall) {
        if (t.card) {
          t.card.classList.remove('queue-pulse-active');
          void t.card.offsetWidth; // Trigger reflow
          t.card.classList.add('queue-pulse-active');
        }
        if (t.nomor) {
          t.nomor.classList.remove('anim-flash-number');
          void t.nomor.offsetWidth;
          t.nomor.classList.add('anim-flash-number');
        }
      }
    });

    if (isNewCall) {
      const teksPanggil = (data.jalur === 'SIDANG')
        ? ('Para pihak ' + (data.nama || '') + ', dipersilakan memasuki ' + (data.loket || 'Ruang Sidang'))
        : ('Nomor antrean ' + (data.nomor || '') + ', silakan menuju ' + (data.loket || ''));
      panggilSuaraDisplay(teksPanggil);
    }

    // 2. Next Queue Panel (Both Kiosk & Display)
    const nextPtsp = ring.ptspBerikutnya || 'P-002';
    const nextSidang = ring.sidangBerikutnya || 'S-001';
    ['kiosk-next-ptsp', 'display-next-ptsp'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.textContent = nextPtsp;
    });
    ['kiosk-next-sidang', 'display-next-sidang'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.textContent = nextSidang;
    });

    // 3. Riwayat 3-4 Nomor Antrean Terakhir
    const history = getQueueHistory().slice(0, 4);
    const htmlRecent = history.map(function (item) {
      return '<div class="p-2 rounded-xl bg-surface-container-low/60 border border-outline-variant/30 flex items-center justify-between text-xs">' +
        '<div class="flex items-center gap-2">' +
          '<span class="font-display font-bold text-xs sm:text-sm text-primary-container">' + esc(item.nomor) + '</span>' +
          '<span class="text-on-surface font-medium truncate max-w-[130px] sm:max-w-[170px]">' + esc(item.loket) + '</span>' +
        '</div>' +
        '<div class="flex items-center gap-1.5">' +
          '<span class="text-outline text-[10px]">' + esc(item.waktu) + '</span>' +
          '<span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-white text-on-surface-variant border border-outline-variant/40">' + esc(item.status || 'Dilayani') + '</span>' +
        '</div>' +
      '</div>';
    }).join('') || '<div class="text-xs text-outline text-center py-2">Belum ada riwayat panggilan.</div>';

    ['kiosk-recent-list', 'display-recent-list'].forEach(function (id) {
      const recBox = document.getElementById(id);
      if (recBox) recBox.innerHTML = htmlRecent;
    });

    // 4. Stats Summary di Bawah Video
    const elStatTot = document.getElementById('display-stat-total');
    const elStatPtsp = document.getElementById('display-stat-ptsp');
    const elStatSid = document.getElementById('display-stat-sidang');
    const elStatSel = document.getElementById('display-stat-selesai');
    if (elStatTot) elStatTot.textContent = (ring.totalHariIni || 0) + ' Tamu';
    if (elStatPtsp) elStatPtsp.textContent = (ring.ptspTotal || 0) + ' Orang';
    if (elStatSid) elStatSid.textContent = (ring.sidangTotal || 0) + ' Perkara';
    if (elStatSel) elStatSel.textContent = (ring.totalSelesai || 0) + ' Selesai';
  }

  function initDisplayView() {
    const st = getDisplaySettings();
    applyYouTubePlayer(st.ytId);

    const kMarq = document.getElementById('kiosk-marquee-content');
    if (kMarq) kMarq.textContent = st.marquee || DEFAULT_DISPLAY_SETTINGS.marquee;
    const dMarq = document.getElementById('display-marquee-content');
    if (dMarq) dMarq.textContent = st.marquee || DEFAULT_DISPLAY_SETTINGS.marquee;

    updateKioskAudioButton(st);
    updateDisplayAudioButton(st);
  }

  function updateKioskAudioButton(settings) {
    const st = settings || getDisplaySettings();
    const isSoundOn = (st.videoSound === true);
    const btn = document.getElementById('btn-kiosk-toggle-audio');
    const icon = document.getElementById('kiosk-audio-icon');
    const label = document.getElementById('kiosk-audio-label');
    if (icon) icon.textContent = isSoundOn ? 'volume_up' : 'volume_off';
    if (label) label.textContent = isSoundOn ? 'Suara: Aktif' : 'Suara: Mute';
    if (btn) {
      btn.className = isSoundOn
        ? 'h-9 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 border border-emerald-400 shadow-sm transition-all'
        : 'h-9 px-3 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center gap-1.5 border border-white/15 transition-all';
    }
  }

  function updateDisplayAudioButton(settings) {
    const st = settings || getDisplaySettings();
    const isSoundOn = (st.videoSound === true);
    const btn = document.getElementById('btn-display-toggle-audio');
    const icon = document.getElementById('display-audio-icon');
    const label = document.getElementById('display-audio-label');
    if (icon) icon.textContent = isSoundOn ? 'volume_up' : 'volume_off';
    if (label) label.textContent = isSoundOn ? 'Suara TV: Aktif' : 'Suara TV: Mute';
    if (btn) {
      btn.className = isSoundOn
        ? 'h-10 px-3 sm:px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 border border-emerald-400 shadow-md transition-all'
        : 'h-10 px-3 sm:px-3.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center gap-1.5 border border-white/15 transition-all';
    }
  }

  function openDisplaySettingsModal() {
    goView('dashboard');
    openAdminTab('display');
  }

  function closeDisplaySettingsModal() {}

  function toggleTvFullscreen() {
    const doc = document.documentElement;
    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement);
    if (!isFs) {
      if (doc.requestFullscreen) doc.requestFullscreen().catch(function () {});
      else if (doc.webkitRequestFullscreen) doc.webkitRequestFullscreen();
      else if (doc.mozRequestFullScreen) doc.mozRequestFullScreen();
      document.body.classList.add('is-tv-fullscreen');
    } else {
      if (document.exitFullscreen) document.exitFullscreen().catch(function () {});
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      else if (document.mozCancelFullScreen) document.mozCancelFullScreen();
      document.body.classList.remove('is-tv-fullscreen');
    }
  }

  // ==========================================================================
  // LOGIN / LOGOUT, BANTUAN & VERIFIKASI QR
  // ==========================================================================
  function openLoginModal() {
    document.getElementById('login-err').classList.add('hidden');
    document.getElementById('modal-login').classList.remove('hidden');
    document.getElementById('login-username').focus();
  }

  function closeLoginModal() {
    document.getElementById('modal-login').classList.add('hidden');
    state.pendingRedirectView = null;
  }

  function openProfilModal() {
    const u = window.ApiClient.getUser();
    if (!u) return openLoginModal();
    document.getElementById('form-profil').reset();
    document.getElementById('profil-err').classList.add('hidden');
    document.getElementById('profil-sub-info').textContent = '@' + u.username + ' • ' + u.role + (u.darurat ? ' (Akses Darurat)' : '');
    const namaWrap = document.getElementById('profil-nama-wrap');
    const namaInp = document.getElementById('profil-nama');
    if (namaWrap && namaInp) {
      namaWrap.classList.toggle('hidden', !!u.darurat);
      namaInp.value = u.nama || '';
    }
    ['profil-pin-lama', 'profil-pin-baru', 'profil-pin-konf'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.type = 'password';
    });
    document.getElementById('modal-profil').classList.remove('hidden');
    document.getElementById('profil-pin-lama').focus();
  }

  function closeUserDropdown() {
    const dd = document.getElementById('user-dropdown-menu');
    if (dd) dd.classList.add('hidden');
  }

  function toggleUserDropdown() {
    const dd = document.getElementById('user-dropdown-menu');
    if (dd) dd.classList.toggle('hidden');
  }

  function closeProfilModal() {
    document.getElementById('modal-profil').classList.add('hidden');
  }

  async function performLogout() {
    closeUserDropdown();
    closeProfilModal();
    await window.ApiClient.call('auth.logout', {});
    window.ApiClient.setSession('', null);
    updateAuthChip();
    toast('Berhasil keluar dari sesi petugas.', 'info');
    if (state.view === 'pantau' || state.view === 'dashboard') goView('kiosk');
  }

  function initModals() {
    document.getElementById('btn-auth-chip').onclick = function (e) {
      e.stopPropagation();
      const u = window.ApiClient.getUser();
      if (u) {
        toggleUserDropdown();
      } else {
        openLoginModal();
      }
    };

    document.getElementById('btn-menu-edit-pw').onclick = function () {
      closeUserDropdown();
      openProfilModal();
    };

    document.getElementById('btn-menu-logout').onclick = performLogout;

    // Tutup dropdown saat klik di luar
    document.addEventListener('click', function (e) {
      const wrap = document.getElementById('user-menu-wrap');
      if (wrap && !wrap.contains(e.target)) closeUserDropdown();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeUserDropdown();
      }
    });

    document.getElementById('btn-close-profil').onclick = closeProfilModal;
    const btnBatalProfil = document.getElementById('btn-batal-profil');
    if (btnBatalProfil) btnBatalProfil.onclick = closeProfilModal;

    const showPwCb = document.getElementById('profil-show-pw');
    if (showPwCb) {
      showPwCb.onchange = function () {
        const t = showPwCb.checked ? 'text' : 'password';
        ['profil-pin-lama', 'profil-pin-baru', 'profil-pin-konf'].forEach(function (id) {
          const el = document.getElementById(id);
          if (el) el.type = t;
        });
      };
    }

    document.getElementById('form-profil').onsubmit = async function (e) {
      e.preventDefault();
      const errEl = document.getElementById('profil-err');
      errEl.classList.add('hidden');

      const namaBaru = document.getElementById('profil-nama').value.trim();
      const pinLama = document.getElementById('profil-pin-lama').value.trim();
      const pinBaru = document.getElementById('profil-pin-baru').value.trim();
      const konf = document.getElementById('profil-pin-konf').value.trim();
      const u = window.ApiClient.getUser();
      const minLen = (u && u.darurat) ? 8 : 4;

      if (pinBaru.length < minLen) {
        errEl.textContent = 'Password / PIN baru minimal ' + minLen + ' karakter.';
        errEl.classList.remove('hidden');
        return;
      }
      if (pinBaru !== konf) {
        errEl.textContent = 'Konfirmasi Password / PIN baru tidak cocok.';
        errEl.classList.remove('hidden');
        return;
      }

      const btn = document.getElementById('btn-profil-save');
      btn.disabled = true;
      btn.textContent = 'Menyimpan...';

      const res = await window.ApiClient.call('auth.gantiSandi', {
        namaBaru: namaBaru,
        pinLama: pinLama,
        pinBaru: pinBaru,
        konfirmasiPin: konf
      });

      btn.disabled = false;
      btn.textContent = 'Simpan Password Baru';

      if (!res || !res.success) {
        errEl.textContent = (res && res.message) || 'Gagal memperbarui password.';
        errEl.classList.remove('hidden');
        return;
      }

      if (res.data && res.data.token && res.data.user) {
        window.ApiClient.setSession(res.data.token, res.data.user);
        updateAuthChip();
      }
      closeProfilModal();
      toast(res.message || 'Password berhasil diperbarui!', 'success');
    };

    document.getElementById('btn-close-login').onclick = closeLoginModal;
    document.getElementById('form-login').onsubmit = async function (e) {
      e.preventDefault();
      const username = document.getElementById('login-username').value.trim();
      const pin = document.getElementById('login-pin').value.trim();
      const errEl = document.getElementById('login-err');
      errEl.classList.add('hidden');

      const res = await window.ApiClient.call('auth.login', { username: username, pin: pin });
      if (!res || !res.success) {
        errEl.textContent = (res && res.message) || 'Login gagal.';
        errEl.classList.remove('hidden');
        return;
      }

      window.ApiClient.setSession(res.data.token, res.data.user);
      updateAuthChip();
      const redirect = state.pendingRedirectView;
      closeLoginModal();
      document.getElementById('form-login').reset();
      toast('Selamat datang, ' + res.data.user.nama + '!', 'success');

      if (redirect) goView(redirect);
      else if (res.data.user.role === 'Admin') goView('dashboard');
      else goView('pantau');
    };

    document.getElementById('btn-close-info').onclick = function () {
      document.getElementById('modal-info').classList.add('hidden');
    };

    // Modal Panggil Sidang & Penetapan Ruang Sidang
    const btnClosePanggil = document.getElementById('btn-close-modal-panggil-sidang');
    if (btnClosePanggil) btnClosePanggil.onclick = closeModalPanggilSidang;
    const btnBatalPanggil = document.getElementById('btn-batal-panggil-sidang');
    if (btnBatalPanggil) btnBatalPanggil.onclick = closeModalPanggilSidang;
    const btnSubmitPanggil = document.getElementById('btn-submit-panggil-sidang');
    if (btnSubmitPanggil) btnSubmitPanggil.onclick = submitPanggilSidangModal;

    const modalPanggil = document.getElementById('modal-panggil-sidang');
    if (modalPanggil) {
      modalPanggil.onclick = function (e) {
        if (e.target === modalPanggil) closeModalPanggilSidang();
      };
    }
    const mpsSel = document.getElementById('mps-select-ruang');
    if (mpsSel) {
      mpsSel.onkeydown = function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          submitPanggilSidangModal();
        }
      };
    }

    document.getElementById('btn-panduan').onclick = function () {
      document.getElementById('modal-info-title').textContent = 'Panduan Penggunaan Kiosk SI-BUKU TAMU';
      document.getElementById('modal-info-body').innerHTML = [
        '<ol class="list-decimal pl-5 space-y-2 text-on-surface-variant">',
        '<li><strong>Pilih Jalur Layanan:</strong> Pilih <em>Tamu Pelayanan PTSP</em> untuk urusan administrasi/informasi/e-Court, atau <em>Tamu Persidangan</em> jika menghadiri sidang perkara.</li>',
        '<li><strong>Isi Data Singkat:</strong> Masukkan nama lengkap dan tujuan (tidak perlu input NIK/KTP).</li>',
        '<li><strong>Simpan atau Cetak Tiket:</strong> Setelah selesai, simpan nomor antrean atau cetak struk thermal dari tombol cetak.</li>',
        '<li><strong>Check-out:</strong> Saat meninggalkan pengadilan, tunjukkan QR Code tiket ke petugas pos jaga.</li>',
        '</ol>'
      ].join('');
      document.getElementById('modal-info').classList.remove('hidden');
    };

    document.getElementById('btn-panggil-petugas').onclick = async function () {
      const res = await window.ApiClient.call('panggilBantuan', { lokasi: 'Kiosk Lobi Utama' });
      toast((res && res.message) || 'Petugas resepsionis dipanggil!', 'success');
    };

    document.getElementById('btn-cek-qr-manual').onclick = function () {
      document.getElementById('modal-info-title').textContent = 'Verifikasi Tiket Tamu';
      document.getElementById('modal-info-body').innerHTML = [
        '<div class="flex flex-col gap-3">',
        '  <p class="text-xs text-on-surface-variant">Masukkan Kode Tiket (contoh: <code>PTSP-20261112-001</code>) untuk mengecek keaslian dan status terkini.</p>',
        '  <input id="inp-verif-id" type="text" placeholder="PTSP-..." class="w-full h-10 px-3 rounded-lg border border-outline-variant text-sm" />',
        '  <button type="button" id="btn-run-verif" class="h-10 rounded-lg bg-primary-container text-white text-xs font-bold">Cek Status Tiket</button>',
        '  <div id="verif-res-box" class="hidden p-3 rounded-xl bg-surface-container-low text-xs"></div>',
        '</div>'
      ].join('');
      document.getElementById('modal-info').classList.remove('hidden');
      document.getElementById('btn-run-verif').onclick = async function () {
        const id = document.getElementById('inp-verif-id').value.trim();
        if (!id) return;
        await showVerificationResult(id, '');
      };
    };

    // Kiosk Display Controls (Halaman Publik)
    const btnKioskFs = document.getElementById('btn-kiosk-fullscreen');
    if (btnKioskFs) btnKioskFs.onclick = toggleTvFullscreen;

    const btnKioskAudio = document.getElementById('btn-kiosk-toggle-audio');
    if (btnKioskAudio) {
      btnKioskAudio.onclick = toggleDisplayAudio;
    }

    const btnKioskReplay = document.getElementById('btn-kiosk-replay-call');
    if (btnKioskReplay) {
      btnKioskReplay.onclick = function () {
        const data = getLiveQueueState();
        panggilSuaraDisplay('Nomor antrean ' + (data.nomor || '') + ', silakan menuju ' + (data.loket || ''));
      };
    }

    // Toggle Audio TV Display (Nyalakan / Matikan Suara Video & Panggilan)
    const btnToggleAudio = document.getElementById('btn-display-toggle-audio');
    if (btnToggleAudio) {
      btnToggleAudio.onclick = toggleDisplayAudio;
    }

    // Tombol Pengaturan Lengkap dari Navigasi Petugas di Sidebar
    const navBtnPengaturanLengkapModal = document.getElementById('nav-btn-pengaturan-lengkap');
    if (navBtnPengaturanLengkapModal) {
      navBtnPengaturanLengkapModal.onclick = function () {
        closeSidebarMobile();
        goView('dashboard');
        openAdminTab('pengaturan');
        const tabBtn = document.querySelector('.atab-btn[data-atab="pengaturan"]');
        if (tabBtn) tabBtn.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
    }

    // Tombol Pengaturan Display TV dari Navigasi Petugas
    const navBtnDisp = document.getElementById('nav-btn-pengaturan-display');
    if (navBtnDisp) {
      navBtnDisp.onclick = function () {
        closeSidebarMobile();
        goView('dashboard');
        openAdminTab('display');
      };
    }

    // Reload Video YouTube Cepat
    const btnVidQuickReload = document.getElementById('btn-video-quick-reload');
    if (btnVidQuickReload) {
      btnVidQuickReload.onclick = function () {
        applyYouTubePlayer();
        toast('Memuat ulang tayangan video YouTube...', 'info');
      };
    }

    // Layar Penuh TV (Fullscreen)
    const btnFullscreen = document.getElementById('btn-display-fullscreen');
    if (btnFullscreen) btnFullscreen.onclick = toggleTvFullscreen;

    document.addEventListener('fullscreenchange', function () {
      const isFs = !!document.fullscreenElement;
      document.body.classList.toggle('is-tv-fullscreen', isFs);
      const fsIcon = document.getElementById('display-fs-icon');
      const fsLabel = document.getElementById('display-fs-label');
      if (fsIcon) fsIcon.textContent = isFs ? 'fullscreen_exit' : 'fullscreen';
      if (fsLabel) fsLabel.textContent = isFs ? 'Keluar Layar Penuh' : 'Layar Penuh TV';
    });

    // Replay call on display card
    const btnReplay = document.getElementById('btn-display-replay-call');
    if (btnReplay) {
      btnReplay.onclick = function () {
        const data = getLiveQueueState();
        panggilSuaraDisplay('Nomor antrean ' + (data.nomor || '') + ', silakan menuju ' + (data.loket || ''));
      };
    }

    // Cross-tab Synchronization via Storage Event (0ms live TV monitor update)
    window.addEventListener('storage', function (e) {
      if (e.key === 'ETAMU_LIVE_QUEUE') {
        renderDisplayQueue(true);
      }
      if (e.key === 'ETAMU_DISPLAY_SETTINGS') {
        initDisplayView();
      }
      if (e.key === 'ETAMU_QUEUE_HISTORY') {
        renderDisplayQueue(false);
      }
    });
  }

  async function showVerificationResult(id, sig) {
    const res = await window.ApiClient.call('verifikasi', { id: id, sig: sig });
    const modal = document.getElementById('modal-info');
    document.getElementById('modal-info-title').textContent = 'Hasil Verifikasi Tiket';
    const body = document.getElementById('modal-info-body');
    if (res && res.success && res.data) {
      const d = res.data;
      body.innerHTML = [
        '<div class="p-4 rounded-xl bg-primary-fixed/40 border border-primary-fixed-dim text-on-primary-fixed mb-3">',
        '  <div class="font-bold">' + (d.valid ? '✅ Tiket Resmi Terverifikasi HMAC' : 'ℹ️ Tiket Terdaftar di Sistem') + '</div>',
        '  <div class="text-xs mt-1">Kode: <strong>' + esc(d.ID_Tiket) + '</strong> (' + esc(d.Nomor_Antrean) + ')</div>',
        '</div>',
        '<div class="space-y-1.5 text-xs">',
        '  <div><span class="text-outline">Nama:</span> <strong>' + esc(d.Nama_Lengkap) + '</strong></div>',
        '  <div><span class="text-outline">Tujuan:</span> <strong>' + esc(d.Tujuan) + '</strong></div>',
        '  <div><span class="text-outline">Status:</span> <strong>' + esc(d.Status) + '</strong></div>',
        '  <div><span class="text-outline">Masuk:</span> ' + fmtTglJam(d.Waktu_Masuk) + '</div>',
        (d.Waktu_Keluar ? '  <div><span class="text-outline">Keluar:</span> ' + fmtTglJam(d.Waktu_Keluar) + '</div>' : ''),
        '</div>'
      ].join('');
    } else {
      body.innerHTML = '<div class="p-4 rounded-xl bg-error-container text-on-error-container text-xs font-semibold">' + esc((res && res.message) || 'Tiket tidak ditemukan.') + '</div>';
    }
    modal.classList.remove('hidden');
  }

  // ==========================================================================
  // ADAPTIVE VISIBILITY-AWARE POLLING (gas-scale-turbo)
  // ==========================================================================
  function startAdaptivePolling() {
    ['pointerdown', 'keydown', 'scroll'].forEach(function (ev) {
      window.addEventListener(ev, function () { state.lastActivity = Date.now(); }, { passive: true });
    });

    const schedule = function () {
      const idleMs = Date.now() - state.lastActivity;
      const delay = idleMs > 60000 ? 60000 : 15000;
      state.pollTimer = setTimeout(async function () {
        if (document.visibilityState === 'visible') {
          if (state.view === 'kiosk' || state.view === 'display') await loadBootPublic(false);
          else if (state.view === 'pantau') await loadPantauData(false);
        }
        schedule();
      }, delay);
    };
    schedule();
  }

  function initSidebar() {
    const btnToggle = document.getElementById('btn-toggle-sidebar');
    const btnClose = document.getElementById('btn-close-sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const sidebar = document.getElementById('app-sidebar');

    if (btnToggle) {
      btnToggle.onclick = function () {
        if (window.innerWidth >= 1024) {
          document.body.classList.toggle('sidebar-collapsed');
        } else {
          if (sidebar) sidebar.classList.remove('-translate-x-full');
          if (overlay) overlay.classList.remove('hidden');
        }
      };
    }

    if (btnClose) {
      btnClose.onclick = closeSidebarMobile;
    }
    if (overlay) {
      overlay.onclick = closeSidebarMobile;
    }
  }

  function closeSidebarMobile() {
    const sidebar = document.getElementById('app-sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar && window.innerWidth < 1024) {
      sidebar.classList.add('-translate-x-full');
    }
    if (overlay) {
      overlay.classList.add('hidden');
    }
  }

  // ==========================================================================
  // INIT
  // ==========================================================================
  function init() {
    if (window.ApiClient.isDemoMode()) {
      const b = document.getElementById('demo-banner');
      if (b) b.classList.remove('hidden');
    }

    startClock();
    updateAuthChip();
    initSidebar();
    initForms();
    initAdminTabs();
    initModals();
    initDisplayView();
    renderDisplayQueue(false);

    // Navigation click listeners
    document.querySelectorAll('[data-nav]').forEach(function (el) {
      el.onclick = function () { goView(el.getAttribute('data-nav')); };
    });

    // Pantau mode tabs & search
    document.querySelectorAll('.pview-tab').forEach(function (b) {
      b.onclick = function () {
        state.pantauMode = b.getAttribute('data-pview');
        state.pantauFilter = 'ALL';
        renderPantau();
      };
    });
    document.getElementById('pantau-search').oninput = function (e) {
      state.pantauSearch = e.target.value;
      renderPantau();
    };
    document.getElementById('btn-pantau-refresh').onclick = function () { loadPantauData(true); };

    window.addEventListener('etamu:unauthorized', function () {
      updateAuthChip();
      toast('Sesi Anda telah berakhir. Silakan login kembali.', 'warning');
      goView('kiosk');
    });

    // Cek hash QR verifikasi saat halaman dibuka
    if (window.location.hash && window.location.hash.indexOf('#verifikasi=') === 0) {
      const params = new URLSearchParams(window.location.hash.slice(1));
      const vid = params.get('verifikasi');
      const vsig = params.get('sig') || '';
      if (vid) showVerificationResult(vid, vsig);
    }

    // Direct route ke Display TV jika hash #display
    if (window.location.hash === '#display') {
      goView('display');
    } else {
      goView('kiosk');
    }
    loadBootPublic(true);
    startAdaptivePolling();
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    toast: toast,
    goView: goView
  };
})();
