/**
 * ============================================================================
 * SI-BUKU TAMU (E-Tamu PTUN) — API CLIENT & TURBO CACHE ENGINE
 * ============================================================================
 * Menggabungkan pola gas-pro-api + gas-scale-turbo:
 * - POST wajib menggunakan Content-Type: text/plain;charset=utf-8 (Anti-CORS)
 * - SWR Cache di localStorage (tampil 0ms, refresh latar belakang)
 * - Deduplikasi request in-flight + writeEpoch invalidation
 * - Batcher otomatis dalam satu tick event-loop
 * - Mode Pratinjau Lokal otomatis aktif HANYA jika GAS_URL masih placeholder
 * ============================================================================
 */
window.ApiClient = (function () {
  const SWR_PREFIX = 'etamu_swr_v2_';
  const TOKEN_KEY = 'etamu_session_token';
  const USER_KEY = 'etamu_session_user';
  const DEMO_DB_KEY = 'etamu_demo_db_v2';

  const _inflight = {};
  let _writeEpoch = 0;
  let _batchPending = [];
  let _batchTimer = null;

  function getGasUrl() {
    return (window.APP_CONFIG && window.APP_CONFIG.GAS_URL) ? String(window.APP_CONFIG.GAS_URL).trim() : '';
  }

  function isDemoMode() {
    const u = getGasUrl();
    return !u || u.indexOf('YOUR_GAS_WEB_APP_ID') > -1 || u.indexOf('/exec') === -1;
  }

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }

  function setSession(token, user) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
      if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
      else localStorage.removeItem(USER_KEY);
    } catch (e) {}
  }

  function getUser() {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function swrGet(key, maxAgeMs) {
    try {
      const raw = localStorage.getItem(SWR_PREFIX + key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (maxAgeMs && (Date.now() - parsed.ts > maxAgeMs)) return null;
      return parsed.val;
    } catch (e) {
      return null;
    }
  }

  function swrSet(key, val) {
    try {
      localStorage.setItem(SWR_PREFIX + key, JSON.stringify({ ts: Date.now(), val: val }));
    } catch (e) {}
  }

  function swrClearPrefix(prefix) {
    try {
      const full = SWR_PREFIX + (prefix || '');
      Object.keys(localStorage).forEach(function (k) {
        if (k.indexOf(full) === 0) localStorage.removeItem(k);
      });
    } catch (e) {}
  }

  function isReadAction(action) {
    return /^(boot|pantau\.boot|admin\.|jadwal\.list|users\.list|pengaturan\.get|struk\.list|struk\.semua|struk\.detail|printer\.get|verifikasi|auth\.me)/i.test(action);
  }

  async function rawPost(action, data) {
    if (isDemoMode()) {
      return DemoBackend.handle(action, data, getToken());
    }
    const url = getGasUrl();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // WAJIB anti-CORS preflight
      body: JSON.stringify({
        action: action,
        data: data || {},
        token: getToken()
      })
    });
    const json = await res.json();
    if (json && json.nq > 0) {
      setTimeout(function () {
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'drainQueue', data: {} })
        }).catch(function () {});
      }, 250);
    }
    return json;
  }

  /**
   * Pemanggilan API teroptimasi dengan deduplikasi in-flight & writeEpoch
   */
  async function call(action, data, opts) {
    opts = opts || {};
    const read = isReadAction(action);

    if (!read) {
      _writeEpoch++;
      swrClearPrefix(''); // Segarkan cache SWR setelah mutasi data
      const res = await rawPost(action, data);
      if (res && res.code === 'UNAUTHORIZED') {
        setSession('', null);
        window.dispatchEvent(new CustomEvent('etamu:unauthorized'));
      }
      return res;
    }

    const reqKey = _writeEpoch + '|' + action + '|' + JSON.stringify(data || {});
    if (_inflight[reqKey]) {
      return _inflight[reqKey];
    }

    const promise = rawPost(action, data).then(function (res) {
      if (res && res.success && opts.swrKey) {
        swrSet(opts.swrKey, res.data);
      }
      if (res && res.code === 'UNAUTHORIZED') {
        setSession('', null);
        window.dispatchEvent(new CustomEvent('etamu:unauthorized'));
      }
      return res;
    }).finally(function () {
      delete _inflight[reqKey];
    });

    _inflight[reqKey] = promise;
    return promise;
  }

  /**
   * Batcher otomatis: menggabungkan beberapa request read dalam satu tick
   */
  function callBatched(action, data) {
    return new Promise(function (resolve, reject) {
      _batchPending.push({ action: action, data: data || {}, resolve: resolve, reject: reject });
      if (!_batchTimer) {
        _batchTimer = setTimeout(async function () {
          const batch = _batchPending.slice();
          _batchPending = [];
          _batchTimer = null;
          if (batch.length === 1) {
            try {
              batch[0].resolve(await call(batch[0].action, batch[0].data));
            } catch (e) {
              batch[0].reject(e);
            }
            return;
          }
          try {
            const res = await rawPost('batch', {
              calls: batch.map(function (b) { return { action: b.action, data: b.data }; })
            });
            if (res && res.success && Array.isArray(res.data)) {
              batch.forEach(function (b, idx) { b.resolve(res.data[idx]); });
            } else {
              batch.forEach(function (b) { b.resolve(res); });
            }
          } catch (err) {
            batch.forEach(function (b) { b.reject(err); });
          }
        }, 0);
      }
    });
  }

  // ==========================================================================
  // SIMULATOR LOKAL (Hanya aktif jika GAS_URL belum dikonfigurasi)
  // ==========================================================================
  const DemoBackend = (function () {
    function todayYmd() {
      const d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function todayCompact() {
      return todayYmd().replace(/-/g, '');
    }

    function initDb() {
      const saved = localStorage.getItem(DEMO_DB_KEY);
      if (saved) {
        try { return JSON.parse(saved); } catch (e) {}
      }
      const now = Date.now();
      const ymd = todayYmd();
      const cmp = todayCompact();
      const db = {
        pengaturan: {
          NAMA_SATKER: 'PENGADILAN TATA USAHA NEGARA',
          ALAMAT_SATKER: 'Jl. Kolonel H. Barlian No. 45, Palembang',
          KODE_UNIT: 'W2.TUN.01 • PTSP & PERSIDANGAN',
          JAM_LAYANAN: '08.00 - 15.00 WIB',
          PREFIX_PTSP: 'P-',
          PREFIX_SIDANG: 'S-',
          CATATAN_KAKI_STRUK: 'Simpan struk ini selama berada di lingkungan pengadilan.',
          AUTO_RESET_DETIK: '30'
        },
        jadwal: [
          { ID_Jadwal: 'JDW-01', Tanggal: ymd, Nomor_Perkara: '24/G/2026/PTUN.PLG', Ruang_Sidang: 'Ruang Sidang Utama (Kartika)', Agenda: 'Pembuktian Surat & Saksi Penggugat', Status_Jadwal: 'Aktif' },
          { ID_Jadwal: 'JDW-02', Tanggal: ymd, Nomor_Perkara: '18/G/TF/2026/PTUN.PLG', Ruang_Sidang: 'Ruang Sidang Tirta', Agenda: 'Pemeriksaan Persiapan & Perbaikan Gugatan', Status_Jadwal: 'Aktif' },
          { ID_Jadwal: 'JDW-03', Tanggal: ymd, Nomor_Perkara: '05/G/2026/PTUN.PLG', Ruang_Sidang: 'Ruang Sidang Utama (Kartika)', Agenda: 'Pembacaan Putusan Akhir', Status_Jadwal: 'Aktif' }
        ],
        ptsp: [
          {
            ID_Tiket: 'PTSP-' + cmp + '-001',
            Waktu_Masuk: new Date(now - 52 * 60000).toISOString(),
            Waktu_Keluar: new Date(now - 38 * 60000).toISOString(),
            Nomor_Antrean: 'P-001',
            Nama_Lengkap: 'Bambang Wijaya, S.H.',
            Asal_Instansi: 'Kantor Hukum Wijaya & Partners',
            No_HP: '081234567890',
            Loket_Tujuan: 'e-Court',
            Keperluan: 'Pendaftaran gugatan elektronik dan aktivasi akun',
            Status_Layanan: 'Selesai',
            Link_Foto: '',
            Petugas_Input: 'Mandiri'
          },
          {
            ID_Tiket: 'PTSP-' + cmp + '-002',
            Waktu_Masuk: new Date(now - 24 * 60000).toISOString(),
            Waktu_Keluar: '',
            Nomor_Antrean: 'P-002',
            Nama_Lengkap: 'Siti Rahmawati, S.E.',
            Asal_Instansi: 'PT Bumi Hijau Mandiri',
            No_HP: '081398765432',
            Loket_Tujuan: 'e-Court',
            Keperluan: 'Verifikasi akun pengguna terdaftar badan hukum',
            Status_Layanan: 'Dilayani',
            Link_Foto: '',
            Petugas_Input: 'Mandiri'
          },
          {
            ID_Tiket: 'PTSP-' + cmp + '-003',
            Waktu_Masuk: new Date(now - 11 * 60000).toISOString(),
            Waktu_Keluar: '',
            Nomor_Antrean: 'P-003',
            Nama_Lengkap: 'Dr. Hendra Wijaya, S.H.',
            Asal_Instansi: 'Hendra & Partners Law Office',
            No_HP: '081122334455',
            Loket_Tujuan: 'Hukum',
            Keperluan: 'Legalisasi surat kuasa & salinan putusan resmi',
            Status_Layanan: 'Menunggu',
            Link_Foto: '',
            Petugas_Input: 'Mandiri'
          },
          {
            ID_Tiket: 'PTSP-' + cmp + '-004',
            Waktu_Masuk: new Date(now - 5 * 60000).toISOString(),
            Waktu_Keluar: '',
            Nomor_Antrean: 'P-004',
            Nama_Lengkap: 'Nurul Hidayati',
            Asal_Instansi: 'Pribadi / Masyarakat Umum',
            No_HP: '085266778899',
            Loket_Tujuan: 'Informasi',
            Keperluan: 'Permohonan informasi PPID & syarat prodeo',
            Status_Layanan: 'Menunggu',
            Link_Foto: '',
            Petugas_Input: 'Petugas Keamanan Lobi'
          }
        ],
        sidang: [
          {
            ID_Tiket: 'SDG-' + cmp + '-001',
            Waktu_Masuk: new Date(now - 45 * 60000).toISOString(),
            Waktu_Keluar: new Date(now - 15 * 60000).toISOString(),
            Nomor_Antrean: 'S-001',
            Nama_Lengkap: 'Bambang Soediro',
            No_HP: '081277889900',
            Peran_Sidang: 'Saksi',
            Nomor_Perkara: '18/G/TF/2026/PTUN.PLG',
            Ruang_Sidang: 'Ruang Sidang Tirta',
            Status_Kehadiran: 'Selesai',
            Link_Foto: '',
            Petugas_Input: 'Mandiri'
          },
          {
            ID_Tiket: 'SDG-' + cmp + '-002',
            Waktu_Masuk: new Date(now - 18 * 60000).toISOString(),
            Waktu_Keluar: '',
            Nomor_Antrean: 'S-002',
            Nama_Lengkap: 'Ahmad Fauzi, S.H.',
            No_HP: '081198765432',
            Peran_Sidang: 'Kuasa Hukum',
            Nomor_Perkara: '24/G/2026/PTUN.PLG',
            Ruang_Sidang: 'Ruang Sidang Utama (Kartika)',
            Status_Kehadiran: 'Hadir di Ruang Tunggu',
            Link_Foto: '',
            Petugas_Input: 'Mandiri'
          },
          {
            ID_Tiket: 'SDG-' + cmp + '-003',
            Waktu_Masuk: new Date(now - 9 * 60000).toISOString(),
            Waktu_Keluar: '',
            Nomor_Antrean: 'S-003',
            Nama_Lengkap: 'Ir. Kusuma Wardhani',
            No_HP: '081344556677',
            Peran_Sidang: 'Tergugat',
            Nomor_Perkara: '24/G/2026/PTUN.PLG',
            Ruang_Sidang: 'Ruang Sidang Utama (Kartika)',
            Status_Kehadiran: 'Masuk Ruang Sidang',
            Link_Foto: '',
            Petugas_Input: 'Mandiri'
          }
        ],
        users: [
          { Username: 'admin', Nama_Petugas: 'Administrator PTUN', Role: 'Admin', Status_Aktif: 'Aktif' },
          { Username: 'ptsp', Nama_Petugas: 'Sri Mulyani (PTSP)', Role: 'PTSP', Status_Aktif: 'Aktif' },
          { Username: 'panitera', Nama_Petugas: 'Irwan Santoso, S.H. (PP)', Role: 'Panitera', Status_Aktif: 'Aktif' },
          { Username: 'satpam', Nama_Petugas: 'Dedi Kurniawan (Satpam)', Role: 'Satpam', Status_Aktif: 'Aktif' }
        ],
        templates: [
          {
            ID_Template: 'TIKET_PTSP',
            Nama_Template: 'Tiket Antrean PTSP Standar',
            Jenis: 'PTSP',
            Aktif: 'YA',
            Versi: 1,
            Isi_Direktif: [
              '[C][B]{{SATKER_NAMA}}',
              '[C]{{SATKER_ALAMAT}}',
              '[C]{{KODE_UNIT}}',
              '[=]',
              '[C]NOMOR ANTREAN PTSP',
              '[C][2][B]{{NOMOR_ANTREAN}}',
              '[C][BOX]{{LOKET}}',
              '[-]',
              '[LR]Kode Tiket||{{ID_TIKET}}',
              '[LR]Nama||{{NAMA}}',
              '[LR]Instansi||{{INSTANSI}}',
              '[LR]Tanggal||{{TANGGAL}}',
              '[LR]Jam Masuk||{{JAM}} WIB',
              '[LR]Status||{{STATUS}}',
              '{{?KEPERLUAN}}[-]',
              '[L]Keperluan: {{KEPERLUAN}}{{/KEPERLUAN}}',
              '[-]',
              '[C][QR]{{URL_VERIFIKASI}}',
              '[C]Pindai QR untuk cek status / check-out',
              '[C]{{CATATAN_KAKI}}',
              '[FEED][CUT]'
            ].join('\n'),
            Riwayat_JSON: '[]',
            Updated_At: new Date().toISOString()
          },
          {
            ID_Template: 'TIKET_SIDANG',
            Nama_Template: 'Tiket Kehadiran Sidang Standar',
            Jenis: 'SIDANG',
            Aktif: 'YA',
            Versi: 1,
            Isi_Direktif: [
              '[C][B]{{SATKER_NAMA}}',
              '[C]{{SATKER_ALAMAT}}',
              '[C]{{KODE_UNIT}}',
              '[=]',
              '[C]ANTREAN PERSIDANGAN',
              '[C][2][B]{{NOMOR_ANTREAN}}',
              '[C][BOX]{{PERAN}}',
              '[-]',
              '[LR]Kode Tiket||{{ID_TIKET}}',
              '[LR]Nama||{{NAMA}}',
              '[LR]No. Perkara||{{NOMOR_PERKARA}}',
              '[LR]Ruang Sidang||{{RUANG_SIDANG}}',
              '[LR]Jam Hadir||{{JAM}} WIB',
              '[LR]Status||{{STATUS}}',
              '[-]',
              '[C][QR]{{URL_VERIFIKASI}}',
              '[C]Tunjukkan kepada Petugas Sidang / Satpam',
              '[C]{{CATATAN_KAKI}}',
              '[FEED][CUT]'
            ].join('\n'),
            Riwayat_JSON: '[]',
            Updated_At: new Date().toISOString()
          }
        ],
        printer: { lebarMm: 58, metode: 'browser', autoCut: true, beep: false, rangkap: 1, hematKertas: false }
      };
      localStorage.setItem(DEMO_DB_KEY, JSON.stringify(db));
      return db;
    }

    function saveDb(db) {
      localStorage.setItem(DEMO_DB_KEY, JSON.stringify(db));
    }

    function handle(action, data, token) {
      const db = initDb();
      const ymd = todayYmd();
      const cmp = todayCompact();

      if (action === 'batch') {
        return {
          success: true,
          data: (data.calls || []).map(function (c) { return handle(c.action, c.data || {}, token); })
        };
      }

      if (action === 'bootPublic') {
        const ptspToday = db.ptsp.filter(function (r) { return r.Waktu_Masuk.slice(0, 10) === ymd; });
        const sidangToday = db.sidang.filter(function (r) { return r.Waktu_Masuk.slice(0, 10) === ymd; });
        const dilayani = ptspToday.filter(function (r) { return r.Status_Layanan === 'Dilayani'; });
        return {
          success: true,
          demo: true,
          data: {
            pengaturan: db.pengaturan,
            jadwalHariIni: db.jadwal.filter(function (j) { return j.Tanggal === ymd && j.Status_Jadwal !== 'Dihapus'; }),
            ringkasan: {
              tanggal: ymd,
              ptspTotal: ptspToday.length,
              ptspMenunggu: ptspToday.filter(function (r) { return r.Status_Layanan === 'Menunggu'; }).length,
              ptspBerjalan: dilayani.length ? dilayani[dilayani.length - 1].Nomor_Antrean : (ptspToday.length ? ptspToday[ptspToday.length - 1].Nomor_Antrean : 'P-000'),
              ptspBerikutnya: db.pengaturan.PREFIX_PTSP + String(ptspToday.length + 1).padStart(3, '0'),
              sidangTotal: sidangToday.length,
              sidangMenunggu: sidangToday.filter(function (r) { return r.Status_Kehadiran === 'Hadir di Ruang Tunggu'; }).length,
              sidangBerikutnya: db.pengaturan.PREFIX_SIDANG + String(sidangToday.length + 1).padStart(3, '0'),
              totalHariIni: ptspToday.length + sidangToday.length,
              totalSelesai: ptspToday.filter(function (r) { return r.Status_Layanan === 'Selesai'; }).length + sidangToday.filter(function (r) { return r.Status_Kehadiran === 'Selesai'; }).length
            },
            struk: { templates: db.templates, printer: db.printer },
            serverWib: new Date().toISOString()
          }
        };
      }

      if (action === 'daftarPtsp' || action === 'ptsp.daftarPetugas') {
        if (!data.nama || !data.instansi) return { success: false, message: 'Nama dan Instansi wajib diisi.' };
        const todayCount = db.ptsp.filter(function (r) { return r.Waktu_Masuk.slice(0, 10) === ymd; }).length;
        const seq = todayCount + 1;
        const pad = String(seq).padStart(3, '0');
        const noAntrean = (db.pengaturan.PREFIX_PTSP || 'P-') + pad;
        const idTiket = 'PTSP-' + cmp + '-' + pad;
        const item = {
          jalur: 'PTSP',
          ID_Tiket: idTiket,
          Waktu_Masuk: new Date().toISOString(),
          Waktu_Keluar: '',
          Nomor_Antrean: noAntrean,
          Nama_Lengkap: data.nama.trim(),
          Asal_Instansi: data.instansi.trim(),
          No_HP: data.noHp || '',
          Loket_Tujuan: data.loket || 'e-Court',
          Keperluan: data.keperluan || '',
          Status_Layanan: 'Menunggu',
          Link_Foto: data.fotoBase64 || '',
          Petugas_Input: action === 'ptsp.daftarPetugas' ? 'Petugas' : 'Mandiri',
          Antrean_Depan: db.ptsp.filter(function (r) { return r.Waktu_Masuk.slice(0, 10) === ymd && r.Status_Layanan === 'Menunggu'; }).length,
          Estimasi_Menit: 6,
          Sig: 'DEMO' + pad
        };
        db.ptsp.push(item);
        saveDb(db);
        return { success: true, data: item, message: 'Registrasi Tamu PTSP berhasil!' };
      }

      if (action === 'daftarSidang' || action === 'sidang.daftarPetugas') {
        if (!data.nama || !data.nomorPerkara) return { success: false, message: 'Nama dan Nomor Perkara wajib diisi.' };
        const todayCount = db.sidang.filter(function (r) { return r.Waktu_Masuk.slice(0, 10) === ymd; }).length;
        const seq = todayCount + 1;
        const pad = String(seq).padStart(3, '0');
        const noAntrean = (db.pengaturan.PREFIX_SIDANG || 'S-') + pad;
        const idTiket = 'SDG-' + cmp + '-' + pad;
        const item = {
          jalur: 'SIDANG',
          ID_Tiket: idTiket,
          Waktu_Masuk: new Date().toISOString(),
          Waktu_Keluar: '',
          Nomor_Antrean: noAntrean,
          Nama_Lengkap: data.nama.trim(),
          No_HP: data.noHp || '',
          Peran_Sidang: data.peran || 'Penggugat',
          Nomor_Perkara: data.nomorPerkara.trim(),
          Ruang_Sidang: data.ruangSidang || 'Ruang Sidang Utama',
          Status_Kehadiran: 'Hadir di Ruang Tunggu',
          Link_Foto: data.fotoBase64 || '',
          Petugas_Input: action === 'sidang.daftarPetugas' ? 'Petugas' : 'Mandiri',
          Sig: 'DEMO' + pad
        };
        db.sidang.push(item);
        saveDb(db);
        return { success: true, data: item, message: 'Kehadiran Sidang berhasil dikonfirmasi!' };
      }

      if (action === 'auth.login') {
        const u = String(data.username || '').trim().toLowerCase();
        const found = db.users.find(function (x) { return x.Username === u && x.Status_Aktif === 'Aktif'; });
        if (!found || !data.pin) {
          return { success: false, message: 'Username tidak ditemukan atau PIN kosong (Mode Pratinjau: gunakan username admin / ptsp / panitera / satpam dengan PIN apa saja).' };
        }
        return {
          success: true,
          data: {
            token: 'DEMO_TOKEN_' + found.Username,
            user: { username: found.Username, role: found.Role, nama: found.Nama_Petugas, darurat: false }
          }
        };
      }

      if (action === 'auth.logout') return { success: true, data: null };
      if (action === 'panggilBantuan') return { success: true, data: { timestamp: new Date().toISOString() }, message: 'Petugas dipanggil (Simulasi).' };

      if (action === 'verifikasi') {
        const all = db.ptsp.concat(db.sidang);
        const f = all.find(function (x) { return x.ID_Tiket === data.id; });
        if (!f) return { success: false, message: 'Tiket tidak ditemukan.' };
        const isPtsp = f.ID_Tiket.indexOf('PTSP-') === 0;
        return {
          success: true,
          data: {
            valid: true,
            ID_Tiket: f.ID_Tiket,
            Nomor_Antrean: f.Nomor_Antrean,
            Nama_Lengkap: f.Nama_Lengkap,
            Jalur: isPtsp ? 'PTSP' : 'SIDANG',
            Tujuan: isPtsp ? ('Loket ' + f.Loket_Tujuan) : (f.Nomor_Perkara + ' (' + f.Ruang_Sidang + ')'),
            Status: isPtsp ? f.Status_Layanan : f.Status_Kehadiran,
            Waktu_Masuk: f.Waktu_Masuk,
            Waktu_Keluar: f.Waktu_Keluar || ''
          }
        };
      }

      if (action === 'pantau.boot') {
        return {
          success: true,
          data: {
            tanggal: ymd,
            ptsp: db.ptsp.filter(function (r) { return r.Waktu_Masuk.slice(0, 10) === ymd; }).map(function (r) { return Object.assign({ jalur: 'PTSP' }, r); }),
            sidang: db.sidang.filter(function (r) { return r.Waktu_Masuk.slice(0, 10) === ymd; }).map(function (r) { return Object.assign({ jalur: 'SIDANG' }, r); }),
            jadwal: db.jadwal.filter(function (j) { return j.Tanggal === ymd && j.Status_Jadwal !== 'Dihapus'; }),
            serverWib: new Date().toISOString()
          }
        };
      }

      if (action === 'tamu.ubahStatus') {
        const list = data.jalur === 'PTSP' ? db.ptsp : db.sidang;
        const item = list.find(function (r) { return r.ID_Tiket === data.idTiket; });
        if (!item) return { success: false, message: 'Tiket tidak ditemukan.' };
        if (data.jalur === 'PTSP') item.Status_Layanan = data.status;
        else item.Status_Kehadiran = data.status;
        if (data.status === 'Selesai' && data.autoCheckout) item.Waktu_Keluar = new Date().toISOString();
        saveDb(db);
        return { success: true, data: item, message: 'Status diperbarui.' };
      }

      if (action === 'tamu.checkout') {
        const list = (data.jalur === 'PTSP' || String(data.idTiket).indexOf('PTSP-') === 0) ? db.ptsp : db.sidang;
        const item = list.find(function (r) { return r.ID_Tiket === data.idTiket; });
        if (!item) return { success: false, message: 'Tiket tidak ditemukan.' };
        item.Waktu_Keluar = new Date().toISOString();
        if (item.Status_Layanan !== undefined) item.Status_Layanan = 'Selesai';
        if (item.Status_Kehadiran !== undefined) item.Status_Kehadiran = 'Selesai';
        saveDb(db);
        return { success: true, data: item, message: 'Check-out berhasil.' };
      }

      if (action === 'admin.dashboard') {
        const ptsp = (data.jalur === 'SIDANG') ? [] : db.ptsp;
        const sidang = (data.jalur === 'PTSP') ? [] : db.sidang;
        const dailyMap = {};
        ptsp.forEach(function (r) {
          const d = r.Waktu_Masuk.slice(0, 10);
          if (!dailyMap[d]) dailyMap[d] = { tanggal: d, ptsp: 0, sidang: 0 };
          dailyMap[d].ptsp++;
        });
        sidang.forEach(function (r) {
          const d = r.Waktu_Masuk.slice(0, 10);
          if (!dailyMap[d]) dailyMap[d] = { tanggal: d, ptsp: 0, sidang: 0 };
          dailyMap[d].sidang++;
        });
        const loketDist = { 'e-Court': 0, 'Informasi': 0, 'Hukum': 0, 'Umum': 0 };
        ptsp.forEach(function (r) { loketDist[r.Loket_Tujuan] = (loketDist[r.Loket_Tujuan] || 0) + 1; });
        const peranDist = {};
        sidang.forEach(function (r) { peranDist[r.Peran_Sidang] = (peranDist[r.Peran_Sidang] || 0) + 1; });
        const combined = ptsp.map(function (r) { return Object.assign({ jalur: 'PTSP' }, r); })
          .concat(sidang.map(function (r) { return Object.assign({ jalur: 'SIDANG' }, r); }))
          .sort(function (a, b) { return new Date(b.Waktu_Masuk) - new Date(a.Waktu_Masuk); });
        return {
          success: true,
          data: {
            kpi: { totalPengunjung: ptsp.length + sidang.length, totalPtsp: ptsp.length, totalSidang: sidang.length, rataDurasiMenit: 11.4 },
            trenHarian: Object.keys(dailyMap).sort().map(function (k) { return dailyMap[k]; }),
            loketDist: loketDist,
            peranDist: peranDist,
            riwayat: combined
          }
        };
      }

      if (action === 'jadwal.list') return { success: true, data: db.jadwal.filter(function (j) { return j.Status_Jadwal !== 'Dihapus'; }) };
      if (action === 'jadwal.simpan') {
        const id = data.ID_Jadwal || ('JDW-' + String(Date.now()).slice(-4));
        const idx = db.jadwal.findIndex(function (j) { return j.ID_Jadwal === id; });
        const obj = { ID_Jadwal: id, Tanggal: data.Tanggal || ymd, Nomor_Perkara: data.Nomor_Perkara, Ruang_Sidang: data.Ruang_Sidang, Agenda: data.Agenda || '', Status_Jadwal: data.Status_Jadwal || 'Aktif' };
        if (idx > -1) db.jadwal[idx] = obj;
        else db.jadwal.push(obj);
        saveDb(db);
        return { success: true, data: obj, message: 'Jadwal disimpan.' };
      }
      if (action === 'jadwal.hapus') {
        db.jadwal = db.jadwal.filter(function (j) { return j.ID_Jadwal !== data.ID_Jadwal; });
        saveDb(db);
        return { success: true, data: null, message: 'Jadwal dihapus.' };
      }

      if (action === 'users.list') return { success: true, data: db.users };
      if (action === 'users.simpan') {
        const u = String(data.Username || '').toLowerCase();
        const idx = db.users.findIndex(function (x) { return x.Username === u; });
        const obj = { Username: u, Nama_Petugas: data.Nama_Petugas, Role: data.Role, Status_Aktif: data.Status_Aktif || 'Aktif' };
        if (idx > -1) db.users[idx] = obj;
        else db.users.push(obj);
        saveDb(db);
        return { success: true, data: db.users, message: 'Pengguna disimpan.' };
      }
      if (action === 'users.cabutSesi') return { success: true, message: 'Sesi pengguna ' + data.username + ' dicabut (Simulasi).' };

      if (action === 'pengaturan.get') {
        return {
          success: true,
          data: {
            pengaturan: db.pengaturan,
            rahasia: { WA_GATEWAY_TOKEN: { ada: false, samar: '' }, WA_GATEWAY_URL: { ada: false, samar: '' }, SIPP_SYNC_KEY: { ada: false, samar: '' } },
            printer: db.printer,
            templates: db.templates
          }
        };
      }
      if (action === 'pengaturan.simpan') {
        Object.assign(db.pengaturan, data);
        saveDb(db);
        return { success: true, data: db.pengaturan, message: 'Pengaturan disimpan.' };
      }
      if (action === 'rahasia.simpan') return { success: true, data: { WA_GATEWAY_TOKEN: { ada: true, samar: 'DEMO••••••XYZ' } }, message: 'Rahasia disimpan (Simulasi).' };
      if (action === 'printer.simpan') { db.printer = data; saveDb(db); return { success: true, data: db.printer, message: 'Printer disimpan.' }; }
      if (action === 'struk.simpan') {
        const t = db.templates.find(function (x) { return x.ID_Template === data.ID_Template; });
        if (t) {
          let hist = [];
          try { hist = JSON.parse(t.Riwayat_JSON || '[]'); } catch (e) {}
          hist.unshift({ versi: t.Versi, waktu: t.Updated_At, isi: t.Isi_Direktif });
          t.Riwayat_JSON = JSON.stringify(hist.slice(0, 10));
          t.Isi_Direktif = data.Isi_Direktif;
          t.Versi = Number(t.Versi || 1) + 1;
          t.Updated_At = new Date().toISOString();
          saveDb(db);
        }
        return { success: true, data: db.templates, message: 'Template disimpan.' };
      }
      if (action === 'struk.reset' || action === 'struk.pulihkan') return { success: true, data: db.templates, message: 'Template dipulihkan.' };
      if (action === 'migrasi.pindai') return { success: true, data: { dryRun: true, sourceTitle: 'Database Lama (Simulasi)', results: [{ sheet: 'Tamu_PTSP', inserted: 12, updated: 0, skipped: 2 }, { sheet: 'Tamu_Sidang', inserted: 8, updated: 1, skipped: 0 }] }, message: 'Simulasi Dry-Run selesai.' };
      if (action === 'migrasi.eksekusi') return { success: true, data: { dryRun: false, sourceTitle: 'Database Lama (Simulasi)', results: [{ sheet: 'Tamu_PTSP', inserted: 12, updated: 0, skipped: 2 }, { sheet: 'Tamu_Sidang', inserted: 8, updated: 1, skipped: 0 }] }, message: 'Simulasi Delta-Sync selesai.' };

      return { success: false, message: 'Action demo tidak tersedia: ' + action };
    }

    return { handle: handle };
  })();

  return {
    isDemoMode: isDemoMode,
    getGasUrl: getGasUrl,
    getToken: getToken,
    getUser: getUser,
    setSession: setSession,
    swrGet: swrGet,
    swrSet: swrSet,
    swrClearPrefix: swrClearPrefix,
    call: call,
    callBatched: callBatched
  };
})();
