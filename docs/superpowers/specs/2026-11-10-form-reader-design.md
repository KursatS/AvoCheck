# AI Form Okuyucu (OCR & Müşteri Formu Ayrıştırıcı) — Tasarım Dokümanı

**Tarih:** 2026-11-10  
**Durum:** Onaylandı  
**Boyut:** Küçük-Orta Ölçekli Özellik (Mevcut Electron mimarisine modüler ekleme)

## 1. Amaç ve Neden (Intent & Why)
Müşterilerden gelen el yazısı veya bilgisayar çıktısı servis formlarını (tek veya çok sayfalı) telefon kamerasıyla ya da doğrudan bilgisayardan okuyup, kullanıcının tarayıcıdaki **Tampermonkey** script'inin beklediği birebir şablona dönüştürerek bilgisayar panosuna (clipboard) otomatik kopyalamak. Böylece harici Python script'i (`ocr_photo.py`) çalıştırma ve el yazısını ayrı bir uygulamaya atma ihtiyacını ortadan kaldırmak.

## 2. Hedefler ve Kısıtlar (Goals, Non-Goals & Constraints)
- **Hedefler:**
  - `ocr_photo.py` içindeki web arayüzünü (`GET /`), fotoğraf yükleme ucunu (`POST /upload`) ve metin ucunu (`POST /clip`) `:5055` portunda birebir aynı şablon ve kurallarla çalıştırmak.
  - Tampermonkey uyumluluğu için çıktı formatını (`Müşteri Adı Soyadı:`, `Telefon:`, `Adres:`, `Fatura Tarihi:`, `Şikayet / Arıza:`) ve telgraf üslubu kurallarını birebir korumak.
  - Bilgisayar başındayken telefon kullanmadan da fotoğraf (sürükle-bırak, dosya seçimi veya `Ctrl+V` ile WhatsApp Web'den yapıştırma) ya da uzun metin gönderip ayrıştırabilmek.
  - İşlem bittiğinde metni panoya kopyalamak, sesli/görsel bildirim vermek ve ekranda yerel IP + QR kod göstermek.
  - Gelen fotoğrafları ve ayrıştırılan `form.txt` çıktısını `Belgeler/AvoCheck/Kayitlar/YYYY-AA-GG_SS-DD-SN/` klasörüne yedeklemek.
- **Kısıtlar & Anti-Hedefler:**
  - **Otomatik başlamama kuralı:** AvoCheck'i diğer personeller de kullandığı için sekme varsayılan olarak **gizli** (`formReaderTabEnabled: false`) olacak; sadece Ayarlar'dan açan kullanıcıda görünecek.
  - Sekme görünür olsa bile AvoCheck açıldığında `:5055` sunucusu **kapalı** başlayacak; kullanıcı sekme içindeki **"▶️ Servisi Başlat"** butonuyla manuel açacak.
  - Panoya kopyalanan form metni AvoCheck'in seri numarası izleyicisini (`ClipboardMonitor`) tetiklememeli.

## 3. Değerlendirilen Yaklaşımlar (Approaches)
1. **Üst Menüde Herkese Açık 4. Sekme:** Tek tıkla erişilir ama özelliği kullanmayan diğer personellerin ekranında da görünür.
2. **Ayarlar'dan Açılan Gizli Sekme + Manuel Başlatma *(Seçilen)*:** Varsayılan olarak gizlidir. Ayarlar'dan *"Form Okuyucu Sekmesini Göster"* açıldığında üst menüye `📄 Form Okuyucu` sekmesi gelir; sunucu yine sekme içinden manuel başlatılır.
3. **Tepsi İkonundan Ayrı Pencere:** Ana pencereden bağımsızdır ancak ikinci bir pencere yönetimi gerektirir.

## 4. Mimari ve Bileşenler
- **`src/formReaderServer.ts` (Yeni Modül - Main Process):**
  - Node.js yerleşik `http` sunucusu (`0.0.0.0:5055`).
  - `GET /`: `ocr_photo.py` içindeki mobil uyumlu HTML/JS arayüzü (istemci tarafında `MAX_DIM = 2200`, JPEG `0.85` küçültme, çoklu sayfa desteği).
  - `POST /upload`: Multipart form verisini ayrıştırır, fotoğrafları `Belgeler/AvoCheck/Kayitlar/` altına kaydeder, Gemini API'ye (`gemini-3.6-flash`, `thinkingLevel: "minimal"`, `temperature: 0.1`, 25 sn zaman aşımı, 5 tekrar) gönderir, sonucu `form.txt` olarak kaydeder ve PC panosuna yazar.
  - `POST /clip`: Ham metni Gemini'ye gönderip şablona döker ve panoya yazar.
  - Doğrudan IPC üzerinden bilgisayardan bırakılan fotoğraf veya metinleri de aynı `callGemini` fonksiyonuyla işler.
  - Yerel ağ IPv4 adresini (`192.168.x.x`) tespit eder ve çevrimdışı SVG QR kod üretir.
- **`src/settingsManager.ts`:**
  - `AppSettings` içine `formReaderTabEnabled?: boolean` (varsayılan `false`) ve `formReaderApiKey?: string` (varsayılan `""`) eklenir.
  - Böylece özelliği kullanmak isteyen her personele farklı bir Gemini API anahtarı verilebilir; girilen anahtar kullanıcının kendi `Belgeler/AvoCheck/settings.json` dosyasında kalıcı olarak saklanır.
- **`src/main.ts` & `src/preload.ts`:**
  - IPC kanalları: `form-reader:start`, `form-reader:stop`, `form-reader:status`, `form-reader:process-pc` (PC'den foto/metin), `form-reader:open-folder`, ve yeni form geldiğinde arayüze gönderilen `form-reader:result` olayı.
- **`src/index.html` & `src/index-renderer.ts`:**
  - Üst menüye `id="tab-form-reader"` (`style="display:none"` varsayılan) ve `id="view-form-reader"` görünümü eklenir.
  - Ayarlar sekmesine *"📄 Form Okuyucu Sekmesini Göster"* anahtarı ve **Gemini API Anahtarı** giriş alanı eklenir (ayrıca `📄 Form Okuyucu` sekmesinin içinden de API anahtarı doğrudan girilip kaydedilebilir).
  - Sekme içinde:
    1. **Durum, API Anahtarı & Bağlantı Kartı:** API anahtarı girişi (göster/gizle ve kaydet), Başlat/Durdur butonu, `http://<ip>:5055` adresi, QR kod ve `📂 Kayıtlar Klasörü` butonu.
    2. **Bilgisayardan Hızlı Gönderim Kartı:** Fotoğraf sürükle-bırak / `Ctrl+V` yapıştırma / dosya seçme alanı + ham metin kutusu ve *"⚡ Ayrıştır & Panoya Kopyala"* butonu.
    3. **Son Okunan Form Kartı:** Ayrıştırılan şablon metni, *"📋 Panoya Kopyala"* butonu ve işlem durumu bildirimi.
