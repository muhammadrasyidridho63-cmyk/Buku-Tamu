/**
 * ============================================================================
 * SI-BUKU TAMU (E-Tamu PTUN) — DRIVER PRINTER THERMAL (struk-printer.js)
 * ============================================================================
 * Mendukung 3 metode cetak + Fallback otomatis:
 * 1. Web Bluetooth (ESC/POS langsung dari Chrome/Edge)
 * 2. RawBT Android (Intent rawbt:base64,...)
 * 3. Dialog Cetak Browser (@page terformat 58mm / 80mm)
 * ============================================================================
 */
window.StrukPrinter = (function () {
  const LOCAL_PREF_KEY = 'etamu_printer_pref';
  let _serverCfg = { lebarMm: 58, metode: 'browser', autoCut: true, beep: false, rangkap: 1, hematKertas: false };
  let _templates = [];
  let _btDevice = null;
  let _btChar = null;

  function pasang(opts) {
    opts = opts || {};
    if (Array.isArray(opts.templates)) _templates = opts.templates;
    if (opts.server) _serverCfg = Object.assign({}, _serverCfg, opts.server);
  }

  function getTemplates() {
    return _templates;
  }

  function getTemplateByJenis(jenis) {
    const j = String(jenis || 'PTSP').toUpperCase();
    return _templates.find(function (t) { return String(t.Jenis).toUpperCase() === j && t.Aktif === 'YA'; })
      || _templates[0]
      || null;
  }

  function getConfig() {
    let local = {};
    try {
      const raw = localStorage.getItem(LOCAL_PREF_KEY);
      if (raw) local = JSON.parse(raw);
    } catch (e) {}
    return Object.assign({}, _serverCfg, local);
  }

  function saveLocalConfig(patch) {
    const next = Object.assign({}, getConfig(), patch);
    try { localStorage.setItem(LOCAL_PREF_KEY, JSON.stringify(next)); } catch (e) {}
    return next;
  }

  async function connectBluetooth() {
    if (!navigator.bluetooth) {
      throw new Error('Browser ini tidak mendukung Web Bluetooth. Gunakan Chrome/Edge atau metode Cetak Browser / RawBT.');
    }
    if (_btDevice && _btDevice.gatt && _btDevice.gatt.connected && _btChar) {
      return _btChar;
    }
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [
        '000018f0-0000-1000-8000-00805f9b34fb',
        'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
        '49535343-fe7d-4ae5-8fa9-9fafd205e455'
      ]
    });
    const server = await device.gatt.connect();
    const services = await server.getPrimaryServices();
    for (let i = 0; i < services.length; i++) {
      const chars = await services[i].getCharacteristics();
      for (let j = 0; j < chars.length; j++) {
        if (chars[j].properties.write || chars[j].properties.writeWithoutResponse) {
          _btDevice = device;
          _btChar = chars[j];
          return _btChar;
        }
      }
    }
    throw new Error('Karakteristik tulis ESC/POS tidak ditemukan pada printer Bluetooth.');
  }

  async function printBluetooth(escBytes) {
    const ch = await connectBluetooth();
    const chunkSize = 100;
    for (let i = 0; i < escBytes.length; i += chunkSize) {
      const slice = escBytes.slice(i, i + chunkSize);
      if (ch.properties.writeWithoutResponse) {
        await ch.writeValueWithoutResponse(slice);
      } else {
        await ch.writeValue(slice);
      }
    }
  }

  function printRawBT(escBytes) {
    let bin = '';
    for (let i = 0; i < escBytes.length; i++) {
      bin += String.fromCharCode(escBytes[i]);
    }
    const b64 = btoa(bin);
    window.location.href = 'rawbt:base64,' + b64;
  }

  function printBrowser() {
    document.body.classList.remove('printing-report');
    document.body.classList.add('printing-thermal');
    setTimeout(function () {
      window.print();
      setTimeout(function () {
        document.body.classList.remove('printing-thermal');
      }, 500);
    }, 100);
  }

  async function cetak(lines, cfgOverride) {
    const cfg = Object.assign({}, getConfig(), cfgOverride || {});
    const rangkap = Math.max(1, Math.min(3, Number(cfg.rangkap) || 1));

    if (cfg.metode === 'bluetooth') {
      try {
        const bytes = window.StrukEngine.renderEscPos(lines, cfg);
        for (let r = 0; r < rangkap; r++) {
          await printBluetooth(bytes);
        }
        return { metode: 'bluetooth', ok: true };
      } catch (e) {
        printBrowser();
        return { metode: 'browser-fallback', ok: true, error: e.message };
      }
    }

    if (cfg.metode === 'rawbt') {
      try {
        const bytes = window.StrukEngine.renderEscPos(lines, cfg);
        printRawBT(bytes);
        return { metode: 'rawbt', ok: true };
      } catch (e) {
        printBrowser();
        return { metode: 'browser-fallback', ok: true, error: e.message };
      }
    }

    printBrowser();
    return { metode: 'browser', ok: true };
  }

  return {
    pasang: pasang,
    getTemplates: getTemplates,
    getTemplateByJenis: getTemplateByJenis,
    getConfig: getConfig,
    saveLocalConfig: saveLocalConfig,
    cetak: cetak,
    printBrowser: printBrowser
  };
})();
