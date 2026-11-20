/**
 * Konfigurasi Endpoint Backend Google Apps Script (GAS) & Display Global.
 * Sesuai aturan R11 (gas-rahasia-script-properties), file ini HANYA menyimpan GAS_URL dan default publik.
 * Nilai di bawah ini dapat diakses secara global oleh seluruh perangkat (PC, HP, Smart TV).
 */
window.APP_CONFIG = {
  GAS_URL: 'https://script.google.com/macros/s/AKfycbyVppk0J1cLbVfVib39hJm1qnGqqqWPqd2Smd2iwNQ_3oQDXUC1D-7wK4fKUah40Vjo/exec',
  // Video YouTube default untuk Kiosk & Display TV di seluruh perangkat & HP (Alur Perkara PTUN Palembang)
  DEFAULT_YT_ID: '8dup11sZtq8',
  // Teks pengumuman berjalan bawaan (Marquee / Running Text)
  DEFAULT_MARQUEE: 'Selamat Datang di Pengadilan Tata Usaha Negara Palembang • Pelayanan Terpadu Satu Pintu (PTSP) melayani dengan Tulus, Cepat, Akuntabel, dan Transparan • Seluruh layanan peradilan bebas dari pungutan liar, gratifikasi, dan korupsi.'
};
