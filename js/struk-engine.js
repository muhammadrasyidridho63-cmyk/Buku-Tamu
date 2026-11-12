/**
 * ============================================================================
 * SI-BUKU TAMU (E-Tamu PTUN) — MESIN TEMPLATE STRUK THERMAL (struk-engine.js)
 * ============================================================================
 * Prinsip Portabilitas (gas-struk-resi-printer):
 * - Render 100% di browser klien (0 beban kuota GAS)
 * - Satu sumber render untuk: Pratinjau HTML, Byte ESC/POS, Ekspor PNG, & Teks WA
 * - Mendukung direktif: [C], [L], [R], [B], [2], [H], [LR], [-], [=], [BOX], [QR], [BAR], [FEED], [CUT], //
 * ============================================================================
 */
window.StrukEngine = (function () {
  const BULAN_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

  function formatTglId(val) {
    if (!val) return '-';
    const d = new Date(val);
    if (isNaN(d.getTime())) return String(val);
    return d.getDate() + ' ' + BULAN_ID[d.getMonth()] + ' ' + d.getFullYear();
  }

  function formatJamWib(val) {
    if (!val) return '-';
    const d = new Date(val);
    if (isNaN(d.getTime())) return String(val);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  /**
   * Kamus data datar tiket PTSP / Sidang -> Variabel Template
   */
  function dataTiketStruk(tiket, pengaturan, appUrl) {
    const isPtsp = (tiket.jalur === 'PTSP') || String(tiket.ID_Tiket || '').indexOf('PTSP-') === 0;
    const baseUrl = appUrl || (window.location.origin + window.location.pathname);
    const verifUrl = baseUrl + '#verifikasi=' + encodeURIComponent(tiket.ID_Tiket || '') + '&sig=' + encodeURIComponent(tiket.Sig || '');

    return {
      SATKER_NAMA: (pengaturan && pengaturan.NAMA_SATKER) || 'PENGADILAN TATA USAHA NEGARA',
      SATKER_ALAMAT: (pengaturan && pengaturan.ALAMAT_SATKER) || '',
      KODE_UNIT: (pengaturan && pengaturan.KODE_UNIT) || 'PTSP & PERSIDANGAN',
      CATATAN_KAKI: (pengaturan && pengaturan.CATATAN_KAKI_STRUK) || 'Simpan struk ini selama berada di lingkungan pengadilan.',
      JALUR: isPtsp ? 'PTSP' : 'PERSIDANGAN',
      ID_TIKET: tiket.ID_Tiket || '-',
      NOMOR_ANTREAN: tiket.Nomor_Antrean || '-',
      NAMA: tiket.Nama_Lengkap || '-',
      INSTANSI: tiket.Asal_Instansi || '-',
      NO_HP: tiket.No_HP || '-',
      LOKET: isPtsp ? ('LOKET ' + (tiket.Loket_Tujuan || 'UMUM')).toUpperCase() : '',
      KEPERLUAN: tiket.Keperluan || '',
      PERAN: !isPtsp ? String(tiket.Peran_Sidang || 'PIHAK').toUpperCase() : '',
      NOMOR_PERKARA: tiket.Nomor_Perkara || '-',
      RUANG_SIDANG: tiket.Ruang_Sidang || '-',
      TANGGAL: formatTglId(tiket.Waktu_Masuk),
      JAM: formatJamWib(tiket.Waktu_Masuk),
      STATUS: isPtsp ? (tiket.Status_Layanan || 'Menunggu') : (tiket.Status_Kehadiran || 'Hadir'),
      URL_VERIFIKASI: verifUrl
    };
  }

  function applyModifiers(val, mods) {
    let out = (val === undefined || val === null) ? '' : String(val);
    mods.forEach(function (m) {
      if (m === 'kapital') out = out.toUpperCase();
      else if (m === 'kecil') out = out.toLowerCase();
      else if (m === 'tgl') out = formatTglId(out);
      else if (m === 'angka') {
        const n = Number(out);
        if (!isNaN(n)) out = n.toLocaleString('id-ID');
      } else if (m === 'rp') {
        const n = Number(out);
        if (!isNaN(n)) out = 'Rp ' + n.toLocaleString('id-ID');
      } else if (m === 'kosong0') {
        if (Number(out) === 0) out = '';
      }
    });
    return out;
  }

  function expandTemplate(rawText, dict) {
    let text = String(rawText || '');

    // Blok kondisional {{?KUNCI}}...{{/KUNCI}}
    text = text.replace(/\{\{\?([A-Z0-9_]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, function (_, key, inner) {
      const val = dict[key];
      return (val !== undefined && val !== null && String(val).trim() !== '') ? inner : '';
    });

    // Blok perulangan {{#ITEM}}...{{/ITEM}} jika ada
    text = text.replace(/\{\{#([A-Z0-9_]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, function (_, key, inner) {
      const arr = dict[key];
      if (!Array.isArray(arr)) return '';
      return arr.map(function (item) {
        return expandTemplate(inner, Object.assign({}, dict, item));
      }).join('\n');
    });

    // Variabel & modifier {{KUNCI|mod1|mod2}}
    text = text.replace(/\{\{([A-Z0-9_]+)(?:\|([^}]+))?\}\}/g, function (_, key, modStr) {
      const val = dict[key] !== undefined ? dict[key] : '';
      const mods = modStr ? modStr.split('|') : [];
      return applyModifiers(val, mods);
    });

    return text;
  }

  function wrapWords(str, maxCols) {
    const text = String(str || '').trim();
    if (!text) return [''];
    if (text.length <= maxCols) return [text];
    const words = text.split(/\s+/);
    const lines = [];
    let cur = '';
    words.forEach(function (w) {
      if (!cur) {
        cur = w;
      } else if (cur.length + 1 + w.length <= maxCols) {
        cur += ' ' + w;
      } else {
        lines.push(cur);
        cur = w;
      }
    });
    if (cur) lines.push(cur);
    return lines;
  }

  /**
   * Parse direktif teks menjadi model baris terstruktur (Single Source of Truth)
   */
  function parseLines(templateText, dict, lebarMm) {
    const cols = Number(lebarMm) === 80 ? 48 : 32;
    const expanded = expandTemplate(templateText, dict);
    const rawLines = expanded.split(/\r?\n/);
    const parsed = [];

    rawLines.forEach(function (raw) {
      const line = raw.trim();
      if (!line || line.indexOf('//') === 0) return;

      if (line === '[-]') {
        parsed.push({ type: 'hr', char: '-', cols: cols });
        return;
      }
      if (line === '[=]') {
        parsed.push({ type: 'hr', char: '=', cols: cols });
        return;
      }
      if (line === '[FEED]') {
        parsed.push({ type: 'feed', count: 1 });
        return;
      }
      if (line === '[CUT]') {
        parsed.push({ type: 'cut' });
        return;
      }
      if (line.indexOf('[FEED][CUT]') > -1) {
        parsed.push({ type: 'feed', count: 2 });
        parsed.push({ type: 'cut' });
        return;
      }

      let align = 'L';
      let bold = false;
      let dbl = false;
      let dblH = false;
      let box = false;
      let rest = line;

      // Ekstrak tag awalan berurutan
      let matched = true;
      while (matched) {
        matched = false;
        const m = rest.match(/^\[(C|L|R|B|2|H|LR|BOX|QR|BAR|LOGO)\]/);
        if (m) {
          matched = true;
          const tag = m[1];
          rest = rest.slice(m[0].length);
          if (tag === 'C' || tag === 'L' || tag === 'R') align = tag;
          else if (tag === 'B') bold = true;
          else if (tag === '2') dbl = true;
          else if (tag === 'H') dblH = true;
          else if (tag === 'BOX') box = true;
          else if (tag === 'QR') {
            parsed.push({ type: 'qr', value: rest.trim() || dict.URL_VERIFIKASI || dict.ID_TIKET });
            rest = '';
            return;
          } else if (tag === 'BAR') {
            parsed.push({ type: 'bar', value: rest.trim() || dict.ID_TIKET });
            rest = '';
            return;
          } else if (tag === 'LOGO') {
            parsed.push({ type: 'logo' });
            rest = '';
            return;
          } else if (tag === 'LR') {
            const parts = rest.split('||');
            const left = (parts[0] || '').trim();
            const right = (parts[1] || '').trim();
            parsed.push({ type: 'lr', left: left, right: right, bold: bold, cols: cols });
            rest = '';
            return;
          }
        }
      }

      if (rest !== '') {
        const effCols = dbl ? Math.floor(cols / 2) : cols;
        const wrapped = wrapWords(rest, effCols);
        wrapped.forEach(function (w) {
          parsed.push({
            type: 'text',
            text: w,
            align: align,
            bold: bold,
            dbl: dbl,
            dblH: dblH,
            box: box,
            cols: effCols
          });
        });
      }
    });

    return parsed;
  }

  /**
   * Render baris terstruktur ke HTML Preview (skala 1:1)
   */
  function renderHtml(lines, opts) {
    opts = opts || {};
    const lebarMm = Number(opts.lebarMm) === 80 ? 80 : 58;
    const cols = lebarMm === 80 ? 48 : 32;
    let html = '<div id="thermal-print-area" class="thermal-paper-preview ' + (lebarMm === 80 ? 'thermal-paper-80' : 'thermal-paper-58') + ' mx-auto p-4 rounded-lg border border-outline-variant/40">';

    lines.forEach(function (it, idx) {
      if (it.type === 'hr') {
        html += '<div class="my-1 text-center overflow-hidden whitespace-nowrap text-slate-400 select-none">' + it.char.repeat(cols) + '</div>';
      } else if (it.type === 'feed') {
        html += '<div style="height:' + (it.count * 10) + 'px"></div>';
      } else if (it.type === 'cut') {
        html += '<div class="my-2 border-t border-dashed border-slate-300 text-[9px] text-center text-slate-400 pt-0.5">✂ POTONG KERTAS</div>';
      } else if (it.type === 'lr') {
        html += '<div class="flex justify-between gap-2 items-start ' + (it.bold ? 'font-bold' : '') + '">';
        html += '<span class="text-slate-600 shrink-0">' + escapeHtml(it.left) + '</span>';
        html += '<span class="text-right font-semibold break-all">' + escapeHtml(it.right) + '</span>';
        html += '</div>';
      } else if (it.type === 'qr') {
        html += '<div class="my-2 flex justify-center"><div class="thermal-qr-slot p-1.5 bg-white border border-slate-200 rounded" data-qr="' + escapeAttr(it.value) + '"></div></div>';
      } else if (it.type === 'bar') {
        html += '<div class="my-2 text-center font-mono text-[10px] tracking-widest border-y border-slate-200 py-1">*' + escapeHtml(it.value) + '*</div>';
      } else if (it.type === 'text') {
        const cls = [
          it.align === 'C' ? 'text-center' : (it.align === 'R' ? 'text-right' : 'text-left'),
          it.bold ? 'font-bold' : '',
          it.dbl ? 'text-2xl tracking-tight my-1 leading-tight' : (it.dblH ? 'text-base leading-tight' : '')
        ].join(' ');
        const inner = it.box
          ? '<span class="thermal-box-highlight">' + escapeHtml(it.text) + '</span>'
          : escapeHtml(it.text);
        html += '<div class="' + cls + '">' + inner + '</div>';
      }
    });

    html += '</div>';
    return html;
  }

  /**
   * Render baris terstruktur ke Teks WhatsApp rapi
   */
  function renderWaText(lines) {
    const out = [];
    lines.forEach(function (it) {
      if (it.type === 'hr') out.push(it.char === '=' ? '====================' : '--------------------');
      else if (it.type === 'lr') out.push('*' + it.left + ':* ' + it.right);
      else if (it.type === 'text') out.push(it.bold || it.dbl ? '*' + it.text + '*' : it.text);
      else if (it.type === 'qr') out.push('Verifikasi Tiket: ' + it.value);
    });
    return out.join('\n');
  }

  /**
   * Render baris terstruktur menjadi byte ESC/POS standar untuk Printer Thermal Bluetooth
   */
  function renderEscPos(lines, opts) {
    opts = opts || {};
    const bytes = [];
    const push = function () {
      for (let i = 0; i < arguments.length; i++) bytes.push(arguments[i]);
    };
    const pushText = function (str) {
      const ascii = String(str || '').replace(/[^\x20-\x7E]/g, ' ');
      for (let i = 0; i < ascii.length; i++) bytes.push(ascii.charCodeAt(i));
    };

    // ESC @ (Init printer)
    push(0x1B, 0x40);
    if (opts.beep) push(0x1B, 0x42, 0x02, 0x02);

    lines.forEach(function (it) {
      if (it.type === 'hr') {
        push(0x1B, 0x61, 0x00); // Align Left
        pushText(it.char.repeat(it.cols));
        push(0x0A);
      } else if (it.type === 'feed') {
        for (let f = 0; f < (it.count || 1); f++) push(0x0A);
      } else if (it.type === 'cut') {
        push(0x0A, 0x0A, 0x0A);
        if (opts.autoCut !== false) push(0x1D, 0x56, 0x42, 0x00);
      } else if (it.type === 'lr') {
        push(0x1B, 0x61, 0x00);
        push(0x1B, 0x45, it.bold ? 1 : 0);
        const space = Math.max(1, it.cols - it.left.length - it.right.length);
        const row = it.left + ' '.repeat(space) + it.right;
        pushText(row.slice(0, it.cols));
        push(0x0A);
        push(0x1B, 0x45, 0);
      } else if (it.type === 'qr') {
        // ESC/POS Native QR Code (Model 2)
        const val = String(it.value || '');
        const len = val.length + 3;
        const pL = len & 0xff;
        const pH = (len >> 8) & 0xff;
        push(0x1B, 0x61, 0x01); // Center
        push(0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00); // Model 2
        push(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 0x05); // Size 5
        push(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x30); // Error corr L
        push(0x1D, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30);
        pushText(val);
        push(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30);
        push(0x0A);
      } else if (it.type === 'text') {
        push(0x1B, 0x61, it.align === 'C' ? 1 : (it.align === 'R' ? 2 : 0));
        push(0x1B, 0x45, it.bold ? 1 : 0);
        push(0x1D, 0x21, it.dbl ? 0x11 : (it.dblH ? 0x01 : 0x00));
        pushText(it.box ? ('[ ' + it.text + ' ]') : it.text);
        push(0x0A);
        push(0x1D, 0x21, 0x00);
        push(0x1B, 0x45, 0);
      }
    });

    return new Uint8Array(bytes);
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;');
  }

  return {
    dataTiketStruk: dataTiketStruk,
    parseLines: parseLines,
    renderHtml: renderHtml,
    renderWaText: renderWaText,
    renderEscPos: renderEscPos,
    formatTglId: formatTglId,
    formatJamWib: formatJamWib
  };
})();
