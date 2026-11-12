/**
 * ============================================================================
 * SI-BUKU TAMU (E-Tamu PTUN) — ANTARMUKA STRUK & EDITOR TEMPLATE (struk-ui.js)
 * ============================================================================
 */
window.StrukUI = (function () {
  function renderQrSlots(root) {
    if (!root || typeof window.qrcode !== 'function') return;
    const slots = root.querySelectorAll('.thermal-qr-slot');
    slots.forEach(function (el) {
      const val = el.getAttribute('data-qr') || 'PTUN';
      try {
        const qr = window.qrcode(0, 'M');
        qr.addData(val);
        qr.make();
        el.innerHTML = qr.createSvgTag({ cellSize: 3, margin: 1 });
      } catch (e) {
        el.textContent = val;
      }
    });
  }

  function ensureModalRoot() {
    let modal = document.getElementById('struk-modal-root');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'struk-modal-root';
      document.body.appendChild(modal);
    }
    return modal;
  }

  function closeModal() {
    const modal = document.getElementById('struk-modal-root');
    if (modal) modal.innerHTML = '';
  }

  function downloadThermalPng(lines, filename) {
    const canvas = document.createElement('canvas');
    const width = 420;
    const lineH = 22;
    let height = 40;
    lines.forEach(function (it) {
      if (it.type === 'qr') height += 140;
      else if (it.type === 'feed') height += 16;
      else if (it.dbl) height += 36;
      else height += lineH;
    });

    canvas.width = width;
    canvas.height = Math.max(240, height + 20);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#111827';
    ctx.textBaseline = 'top';

    let y = 20;
    lines.forEach(function (it) {
      if (it.type === 'hr') {
        ctx.font = '13px Courier New, monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#6b7280';
        ctx.fillText(it.char.repeat(34), width / 2, y);
        ctx.fillStyle = '#111827';
        y += lineH;
      } else if (it.type === 'feed') {
        y += 16;
      } else if (it.type === 'cut') {
        y += 10;
      } else if (it.type === 'lr') {
        ctx.font = (it.bold ? 'bold ' : '') + '13px Courier New, monospace';
        ctx.textAlign = 'left';
        ctx.fillText(it.left, 20, y);
        ctx.textAlign = 'right';
        ctx.fillText(it.right, width - 20, y);
        y += lineH;
      } else if (it.type === 'qr') {
        if (typeof window.qrcode === 'function') {
          const qr = window.qrcode(0, 'M');
          qr.addData(it.value);
          qr.make();
          const count = qr.getModuleCount();
          const size = 120;
          const cell = size / count;
          const ox = (width - size) / 2;
          for (let r = 0; r < count; r++) {
            for (let c = 0; c < count; c++) {
              if (qr.isDark(r, c)) {
                ctx.fillRect(ox + c * cell, y + r * cell, Math.ceil(cell), Math.ceil(cell));
              }
            }
          }
        }
        y += 136;
      } else if (it.type === 'text') {
        const fontSize = it.dbl ? 30 : 14;
        ctx.font = (it.bold || it.dbl ? 'bold ' : '') + fontSize + 'px Courier New, monospace';
        const x = it.align === 'C' ? width / 2 : (it.align === 'R' ? width - 20 : 20);
        ctx.textAlign = it.align === 'C' ? 'center' : (it.align === 'R' ? 'right' : 'left');
        if (it.box) {
          const tw = ctx.measureText(it.text).width + 20;
          ctx.fillStyle = '#111827';
          ctx.fillRect(x - tw / 2, y - 2, tw, fontSize + 8);
          ctx.fillStyle = '#ffffff';
          ctx.fillText(it.text, x, y + 2);
          ctx.fillStyle = '#111827';
        } else {
          ctx.fillText(it.text, x, y);
        }
        y += it.dbl ? 36 : lineH;
      }
    });

    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = (filename || 'tiket-ptun') + '.png';
    a.click();
  }

  function pratinjau(opts) {
    opts = opts || {};
    const jenis = String(opts.jenis || 'PTSP').toUpperCase();
    const tpl = window.StrukPrinter.getTemplateByJenis(jenis);
    const tplText = (tpl && tpl.Isi_Direktif) || '[C][B]{{SATKER_NAMA}}\n[C][2]{{NOMOR_ANTREAN}}\n[LR]Nama||{{NAMA}}';
    const dict = opts.data || {};
    let cfg = window.StrukPrinter.getConfig();

    const root = ensureModalRoot();

    function renderModal() {
      const lines = window.StrukEngine.parseLines(tplText, dict, cfg.lebarMm);
      const previewHtml = window.StrukEngine.renderHtml(lines, cfg);

      root.innerHTML = [
        '<div class="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">',
        '  <div class="bg-white rounded-2xl shadow-2xl border border-outline-variant/40 w-full max-w-2xl overflow-hidden my-auto">',
        '    <div class="bg-primary-container text-white px-5 py-4 flex items-center justify-between">',
        '      <div class="flex items-center gap-2.5">',
        '        <span class="material-symbols-outlined text-secondary-fixed">print</span>',
        '        <div>',
        '          <h3 class="font-headline-sm text-base font-bold leading-tight">Pratinjau & Cetak Struk Thermal</h3>',
        '          <p class="text-xs text-primary-fixed-dim">Skala 1:1 untuk Printer Kasir/Thermal 58mm & 80mm</p>',
        '        </div>',
        '      </div>',
        '      <button id="btn-close-struk" class="p-1.5 rounded-lg hover:bg-white/10 text-white"><span class="material-symbols-outlined">close</span></button>',
        '    </div>',
        '    <div class="p-5 grid grid-cols-1 md:grid-cols-12 gap-5 items-start">',
        '      <div class="md:col-span-7 bg-surface-container-low rounded-xl p-4 flex justify-center overflow-auto max-h-[65vh]" id="struk-preview-wrap">',
        previewHtml,
        '      </div>',
        '      <div class="md:col-span-5 flex flex-col gap-3.5">',
        '        <div>',
        '          <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">Ukuran Kertas Thermal</label>',
        '          <div class="grid grid-cols-2 gap-2">',
        '            <button type="button" data-mm="58" class="btn-mm py-2 rounded-lg text-sm font-semibold border ' + (Number(cfg.lebarMm) !== 80 ? 'bg-primary-container text-white border-primary-container' : 'bg-white text-on-surface border-outline-variant') + '">58 mm (32 Kol)</button>',
        '            <button type="button" data-mm="80" class="btn-mm py-2 rounded-lg text-sm font-semibold border ' + (Number(cfg.lebarMm) === 80 ? 'bg-primary-container text-white border-primary-container' : 'bg-white text-on-surface border-outline-variant') + '">80 mm (48 Kol)</button>',
        '          </div>',
        '        </div>',
        '        <div>',
        '          <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">Metode Cetak</label>',
        '          <select id="sel-metode-cetak" class="w-full h-10 px-3 rounded-lg border border-outline-variant text-sm bg-white">',
        '            <option value="browser"' + (cfg.metode === 'browser' ? ' selected' : '') + '>Dialog Cetak Browser (USB/LAN/PDF)</option>',
        '            <option value="bluetooth"' + (cfg.metode === 'bluetooth' ? ' selected' : '') + '>Web Bluetooth ESC/POS (Langsung)</option>',
        '            <option value="rawbt"' + (cfg.metode === 'rawbt' ? ' selected' : '') + '>RawBT Android (Bluetooth SPP)</option>',
        '          </select>',
        '        </div>',
        '        <div>',
        '          <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">Rangkap Cetak</label>',
        '          <select id="sel-rangkap" class="w-full h-10 px-3 rounded-lg border border-outline-variant text-sm bg-white">',
        '            <option value="1"' + (Number(cfg.rangkap) === 1 ? ' selected' : '') + '>1 Rangkap</option>',
        '            <option value="2"' + (Number(cfg.rangkap) === 2 ? ' selected' : '') + '>2 Rangkap</option>',
        '            <option value="3"' + (Number(cfg.rangkap) === 3 ? ' selected' : '') + '>3 Rangkap</option>',
        '          </select>',
        '        </div>',
        '        <div class="pt-2 flex flex-col gap-2">',
        '          <button id="btn-exec-print" class="w-full h-11 rounded-lg bg-primary-container hover:bg-primary text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-sm transition-all">',
        '            <span class="material-symbols-outlined text-[18px]">print</span> Cetak Sekarang',
        '          </button>',
        '          <button id="btn-dl-png" class="w-full h-10 rounded-lg border border-primary-container text-primary-container hover:bg-surface-container-low font-semibold text-sm flex items-center justify-center gap-2">',
        '            <span class="material-symbols-outlined text-[18px]">download</span> Unduh Gambar (PNG)',
        '          </button>',
        '          <button id="btn-share-wa" class="w-full h-10 rounded-lg border border-emerald-600 text-emerald-700 hover:bg-emerald-50 font-semibold text-sm flex items-center justify-center gap-2">',
        '            <span class="material-symbols-outlined text-[18px]">chat</span> Kirim Teks ke WhatsApp',
        '          </button>',
        '        </div>',
        '      </div>',
        '    </div>',
        '  </div>',
        '</div>'
      ].join('');

      renderQrSlots(root);

      root.querySelector('#btn-close-struk').onclick = closeModal;
      root.querySelectorAll('.btn-mm').forEach(function (b) {
        b.onclick = function () {
          cfg = window.StrukPrinter.saveLocalConfig({ lebarMm: Number(b.getAttribute('data-mm')) });
          renderModal();
        };
      });
      root.querySelector('#sel-metode-cetak').onchange = function (e) {
        cfg = window.StrukPrinter.saveLocalConfig({ metode: e.target.value });
      };
      root.querySelector('#sel-rangkap').onchange = function (e) {
        cfg = window.StrukPrinter.saveLocalConfig({ rangkap: Number(e.target.value) });
      };
      root.querySelector('#btn-exec-print').onclick = async function () {
        const res = await window.StrukPrinter.cetak(lines, cfg);
        if (res.error && window.AppUI) {
          window.AppUI.toast('Bluetooth tidak terhubung (' + res.error + '), beralih ke dialog cetak browser.', 'warning');
        }
      };
      root.querySelector('#btn-dl-png').onclick = function () {
        downloadThermalPng(lines, dict.ID_TIKET || 'tiket-ptun');
      };
      root.querySelector('#btn-share-wa').onclick = function () {
        const msg = window.StrukEngine.renderWaText(lines);
        const hp = String(opts.waNomor || dict.NO_HP || '').replace(/[^\d]/g, '');
        const waHp = hp.indexOf('0') === 0 ? '62' + hp.slice(1) : hp;
        const url = waHp
          ? 'https://wa.me/' + waHp + '?text=' + encodeURIComponent(msg)
          : 'https://wa.me/?text=' + encodeURIComponent(msg);
        window.open(url, '_blank');
      };
    }

    renderModal();
  }

  /**
   * Editor Template Struk untuk Admin di tab Pengaturan
   */
  function renderEditor(container, templates, printerCfg, onSaved, satkerCfg) {
    if (!container) return;
    let activeTpl = templates[0] || { ID_Template: 'TIKET_PTSP', Nama_Template: 'Tiket PTSP', Jenis: 'PTSP', Isi_Direktif: '', Versi: 1, Riwayat_JSON: '[]' };
    let textVal = activeTpl.Isi_Direktif || '';
    const cfg = satkerCfg || {};
    const sampleDict = {
      SATKER_NAMA: cfg.NAMA_SATKER || 'PENGADILAN TATA USAHA NEGARA',
      SATKER_ALAMAT: cfg.ALAMAT_SATKER || 'Jl. Kolonel H. Barlian No. 45',
      KODE_UNIT: cfg.KODE_UNIT || 'W2.TUN.01 • PTSP & SIDANG',
      CATATAN_KAKI: cfg.CATATAN_KAKI_STRUK || 'Simpan struk ini selama berada di pengadilan.',
      ID_TIKET: 'PTSP-20261112-001',
      NOMOR_ANTREAN: 'P-015',
      NAMA: 'Dr. Hendra Wijaya, S.H.',
      INSTANSI: 'Hendra & Partners',
      LOKET: 'LOKET E-COURT',
      KEPERLUAN: 'Pendaftaran gugatan elektronik',
      PERAN: 'KUASA HUKUM',
      NOMOR_PERKARA: '24/G/2026/PTUN.PLG',
      RUANG_SIDANG: 'Ruang Sidang Utama',
      TANGGAL: '12 Nov 2026',
      JAM: '09:15',
      STATUS: 'Menunggu',
      URL_VERIFIKASI: window.location.origin + '#verifikasi=PTSP-20261112-001'
    };

    function draw() {
      const lines = window.StrukEngine.parseLines(textVal, sampleDict, printerCfg.lebarMm || 58);
      let hist = [];
      try { hist = JSON.parse(activeTpl.Riwayat_JSON || '[]'); } catch (e) {}

      container.innerHTML = [
        '<div class="grid grid-cols-1 lg:grid-cols-12 gap-5">',
        '  <div class="lg:col-span-7 flex flex-col gap-3">',
        '    <div class="flex flex-wrap items-center justify-between gap-2">',
        '      <select id="ed-tpl-select" class="h-10 px-3 rounded-lg border border-outline-variant text-sm font-semibold bg-white">',
        templates.map(function (t) {
          return '<option value="' + t.ID_Template + '"' + (t.ID_Template === activeTpl.ID_Template ? ' selected' : '') + '>' + t.Nama_Template + ' (v' + (t.Versi || 1) + ')</option>';
        }).join(''),
        '      </select>',
        '      <div class="flex gap-2">',
        '        <button type="button" id="ed-btn-reset" class="px-3 h-9 rounded-lg border border-outline-variant text-xs font-semibold hover:bg-surface-container-low">Reset Default</button>',
        '        <button type="button" id="ed-btn-save" class="px-4 h-9 rounded-lg bg-primary-container text-white text-xs font-semibold hover:bg-primary">Simpan Template</button>',
        '      </div>',
        '    </div>',
        '    <textarea id="ed-tpl-text" rows="15" class="w-full p-3 rounded-xl border border-outline-variant font-mono text-xs bg-slate-50 focus:bg-white">' + textVal.replace(/</g, '&lt;') + '</textarea>',
        '    <div class="p-3 rounded-xl bg-surface-container-low text-[11px] text-on-surface-variant leading-relaxed">',
        '      <strong>Direktif:</strong> <code>[C]</code> Tengah, <code>[B]</code> Tebal, <code>[2]</code> 2x Besar, <code>[BOX]</code> Sorot Hitam, <code>[LR]Kiri||Kanan</code>, <code>[-]</code> / <code>[=]</code> Garis, <code>[QR]</code> QR Code, <code>[FEED][CUT]</code>.<br/>',
        '      <strong>Variabel:</strong> <code>{{SATKER_NAMA}}</code>, <code>{{NOMOR_ANTREAN}}</code>, <code>{{NAMA}}</code>, <code>{{INSTANSI}}</code>, <code>{{LOKET}}</code>, <code>{{PERAN}}</code>, <code>{{NOMOR_PERKARA}}</code>, <code>{{RUANG_SIDANG}}</code>, <code>{{JAM}}</code>.',
        '    </div>',
        hist.length ? (
          '<div class="flex items-center gap-2 flex-wrap text-xs"><span class="font-semibold text-on-surface-variant">Riwayat Versi:</span>' +
          hist.slice(0, 5).map(function (h) {
            return '<button type="button" data-ver="' + h.versi + '" class="ed-restore px-2 py-1 rounded bg-white border border-outline-variant hover:border-primary">Pulihkan v' + h.versi + '</button>';
          }).join('') + '</div>'
        ) : '',
        '  </div>',
        '  <div class="lg:col-span-5 bg-surface-container-low rounded-xl p-4 flex flex-col items-center">',
        '    <span class="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-3">Pratinjau Langsung (1:1)</span>',
        '    <div id="ed-live-preview" class="w-full flex justify-center">' + window.StrukEngine.renderHtml(lines, printerCfg) + '</div>',
        '  </div>',
        '</div>'
      ].join('');

      renderQrSlots(container);

      container.querySelector('#ed-tpl-select').onchange = function (e) {
        const f = templates.find(function (x) { return x.ID_Template === e.target.value; });
        if (f) {
          activeTpl = f;
          textVal = f.Isi_Direktif || '';
          draw();
        }
      };

      const ta = container.querySelector('#ed-tpl-text');
      ta.oninput = function (e) {
        textVal = e.target.value;
        const l2 = window.StrukEngine.parseLines(textVal, sampleDict, printerCfg.lebarMm || 58);
        const prev = container.querySelector('#ed-live-preview');
        prev.innerHTML = window.StrukEngine.renderHtml(l2, printerCfg);
        renderQrSlots(prev);
      };

      container.querySelector('#ed-btn-save').onclick = async function () {
        const res = await window.ApiClient.call('struk.simpan', {
          ID_Template: activeTpl.ID_Template,
          Nama_Template: activeTpl.Nama_Template,
          Isi_Direktif: textVal
        });
        if (res.success && onSaved) onSaved(res.data, res.message);
      };

      container.querySelector('#ed-btn-reset').onclick = async function () {
        const res = await window.ApiClient.call('struk.reset', { ID_Template: activeTpl.ID_Template });
        if (res.success && onSaved) onSaved(res.data, res.message);
      };

      container.querySelectorAll('.ed-restore').forEach(function (b) {
        b.onclick = async function () {
          const res = await window.ApiClient.call('struk.pulihkan', {
            ID_Template: activeTpl.ID_Template,
            versi: Number(b.getAttribute('data-ver'))
          });
          if (res.success && onSaved) onSaved(res.data, res.message);
        };
      });
    }

    draw();
  }

  return {
    renderQrSlots: renderQrSlots,
    pratinjau: pratinjau,
    closeModal: closeModal,
    renderEditor: renderEditor
  };
})();
