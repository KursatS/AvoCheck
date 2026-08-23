# 🚀 RecciTek WCheck

[![Version](https://img.shields.io/badge/version-2.6.1-blue.svg)](https://github.com/KursatS/RecciTek-WCheck)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/electron-34.0.0-purple.svg)](https://electronjs.org)
[![Vite](https://img.shields.io/badge/vite-6.4.1-646CFF.svg)](https://vitejs.dev)
[![TypeScript](https://img.shields.io/badge/typescript-5.7.3-3178C6.svg)](https://www.typescriptlang.org)

**RecciTek WCheck** — Gelişmiş Garanti Takip, Cihaz Çağrı ve Servis Analiz Sistemi. Panodan kopyalanan seri numaralarını anında algılar, Recci & KVK servis sunucularından garanti durumunu sorgular, canlı öncelikli cihaz takibi sağlar ve detaylı Z Raporu analizleri sunar.

---

## 🖼️ Ekran Görüntüleri

### Ana Panel & Açılış
| Ana Sayfa | Açılış Ekranı (Splash) |
| :---: | :---: |
| ![Ana Panel](assets/screenshots/home.png) | ![Açılış Ekranı](assets/screenshots/splash.png) |

### Akıllı Durum Bildirimleri (Popups)
| Garanti Kapsamında | Garanti Dışı / Fatura Kontrol | Bağlantı Sorunu |
| :---: | :---: | :---: |
| ![RECCI/KVK](assets/screenshots/inwarrantypopup.png) | ![Dışında](assets/screenshots/outofwarrantypopup.png) | ![Hata](assets/screenshots/connectionproblempopup.png) |

---

## ✨ Güncel Özellikler (v2.6.1)

- ⚡ **Akıllı Panodan Garanti Sorgulama**: Seri numaralarını panodan kopyaladığınız anda anında algılar. Özel sıfır tahsisli Regex HTML parser ile Recci ve KVK servis verilerini milisaniyeler içinde ekrana getirir.
- 📋 **Hassas Model-Renk Kopyalama & Özelleştirilebilir Kısayol**: Popup üzerindeki kopyalama butonu veya kısayol (`Ctrl+Shift+C`) ile doğrudan `MODEL - RENK` (KVK için `GÜVENCE BİTİŞ TARİHİ : ...`) formatında temiz panoya alma. Kısayol tuşu **Ayarlar > Kısayol Yöneticisi** üzerinden dinamik olarak değiştirilebilir.
- 🏷️ **Recci İthalat & Fatura Kontrol Rozeti**: Türkiye garantili olup sistemde süresi dolmuş görünen cihazlar için canlı yeşil `✓ RECCI GARANTİLİ` ve turuncu `(SÜRESİ DOLMUŞ - FATURA KONTROL)` akıllı rozet gösterimi.
- 🔠 **AHK Tarzı "Büyük Harf Yapıştır" (Ctrl+Shift+V)**: Panodaki metinleri Türkçe karakter uyumlu olarak otomatik büyük harfe dönüştürüp hızlıca yapıştırma imkanı.
- 📢 **Canlı Cihaz Çağrı (Cihaz Sor) Sistemi**: Kargo kabul ve servis personeli arasında anlık cihaz sorgulama, canlı yanıt takibi ve Web Audio API tabanlı pürüzsüz bildirim sesleri (`Chime / Pop`).
- ⚠️ **Öncelikli Cihaz Takip Sistemi**: Acil takibe alınan cihazları Firestore veritabanı üzerinden tarih/saat damgasıyla canlı senkronize etme ve masaüstü popup bildirimleri fırlatma.
- 📝 **Excel Z Raporu Analizi**: Servis kayıt dosyalarını sürükle-bırak yöntemiyle inceleme; en son 5 güne ait toplam servis kayıt sayılarını, model dağılımlarını ve personel (Kaydı Açan) bazlı adetleri grafiksel görselleştirme.
- 🛡️ **GPU Donma / Siyah Ekran Koruması**: Dahili Intel HD Graphics ve ofis bilgisayarlarında Chromium swapchain kilitlenmelerini engelleyen otomatik kurtarma ve donanım hızlandırma optimize parametreleri.

---

## 🛠️ Kurulum & Derleme

### Gereksinimler
- Node.js 18+
- npm

### Geliştirici Adımları
```bash
# Bağımlılıkları yükleyin
npm install

# Geliştirici modunda çalıştırın (Dev Mode)
npm run dev

# Projeyi derleyin (Build)
npm run build
```

### Setup / Windows Kurulum (.exe) Dosyası Oluşturma
Uygulamanın Windows kurulum (NSIS `.exe`) paketini oluşturmak için:
```bash
npm run dist
```
Oluşturulan kurulum dosyası `release/` klasörü altına kaydedilecektir.

---

## 🎯 Kullanım

1. **Seri Numarası Kopyalayın**: Panoya seri numarasını kopyaladığınız an sistem otomatik olarak garanti durumunu sorgular.
2. **Popup'ı İnceleyin**: Ekranın sağ alt köşesinde beliren renk kodlu (Yeşil: RECCI, Mavi: KVK, Gri/Turuncu: Fatura Kontrol) masaüstü popup'ı ile durumu anında görün.
3. **Kısayolla Kopyalayın**: `Ctrl+Shift+C` (veya belirlediğiniz kısayol) ya da Popup'taki `Kopyala` butonuna basarak doğrudan `MODEL - RENK` formatını panoya alın.
4. **Cihaz Çağrısı Atın**: Kargo kabul personelinden "Cihaz Sor" sekmesiyle anlık cihaz bulunma çağrısı yapın.
5. **Z Raporu Yükleyin**: Servis Excel dosyanızı sürükleyip bırakarak günlük personel ve model istatistiklerini raporlayın.

---

## 📁 Dosya Yapısı

```
RecciTek-WCheck/
├── assets/                 # Logolar, ikonlar ve ekran görüntüleri
├── src/                    # Kaynak kodları (TypeScript)
│   ├── main.ts            # Ana Electron süreci & IPC İşleyicileri
│   ├── windowManager.ts   # Pencere, Popup & Tray Yönetimi
│   ├── settingsManager.ts # Ayar & Persistence Yönetimi
│   ├── warrantyChecker.ts # Recci & KVK Garanti Scraper
│   ├── cacheManager.ts    # SQLite Veritabanı (better-sqlite3)
│   ├── ticketService.ts   # Firestore Entegrasyonu & Öncelikli Cihazlar
│   ├── bonusCalculator.ts # Z Raporu Excel Parser
│   ├── utils/             # Modüler UI ve İş Mantığı (Z-Report, Settings, Admin, Toast)
│   └── *.html             # Modern Glassmorphic Arayüz Dosyaları
├── release/               # Derlenen kurulum (.exe) dosyaları
├── package.json           # Proje paketleri, bağımlılıklar ve versiyon
└── README.md              # Kullanım ve Teknik Dokümantasyon
```

---

## 👨‍💻 Geliştirici

**Kürşat Sinan**
- GitHub: [@KursatS](https://github.com/KursatS)
- Proje: [RecciTek-WCheck](https://github.com/KursatS/RecciTek-WCheck)

---

⭐ Eğer bu proje işinizi kolaylaştırdıysa, GitHub üzerinden yıldız vermeyi unutmayın!
