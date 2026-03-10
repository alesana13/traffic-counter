# 🚦 Traffic Counter — Telegram Approval Gate

Aplikasi penghitung kendaraan Mudik/Balik dengan persetujuan via **Telegram Bot**.

---

## 📋 Alur Kerja

```
Pengunjung buka app → Isi nama → Klik "Minta Akses"
       ↓
Notifikasi Telegram masuk ke HP ANDA:
  🚦 PERMINTAAN AKSES
  👤 Nama : Budi
  ✅ IZINKAN: https://app.railway.app/approve/TOKEN
  ❌ TOLAK:   https://app.railway.app/reject/TOKEN
       ↓
Anda klik IZINKAN → App terbuka otomatis di HP pengunjung ✅
```

---

## 🤖 TUTORIAL SETUP TELEGRAM BOT (10 menit)

### LANGKAH 1 — Buat Bot via BotFather

1. Buka Telegram → cari **@BotFather** (ada centang biru)
2. Ketik: `/newbot`
3. Isi nama bot (bebas): `Traffic Counter Bot`
4. Isi username bot (harus akhiran "bot"): `trafficcounter_saya_bot`
5. BotFather balas dengan TOKEN seperti ini:
   ```
   1234567890:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
6. **Simpan TOKEN ini** → untuk `TELEGRAM_BOT_TOKEN`

---

### LANGKAH 2 — Dapatkan Chat ID Anda

1. Di Telegram, cari **@userinfobot**
2. Ketik `/start`
3. Bot balas dengan: `Id: 123456789`
4. **Simpan angka Id tersebut** → untuk `TELEGRAM_CHAT_ID`

> Cara alternatif: Kirim `/start` ke bot Anda, lalu buka
> `https://api.telegram.org/bot<TOKEN>/getUpdates`
> di browser. Cari `"chat":{"id":XXXXXXX}`

---

### LANGKAH 3 — Test Bot

Buka URL ini di browser (ganti TOKEN dan CHAT_ID):
```
https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<CHAT_ID>&text=Test+berhasil!
```
Jika Telegram dapat pesan "Test berhasil!" → ✅ lanjut ke deploy!

---

## 🚀 Deploy ke Railway (Gratis)

1. Upload folder `trafficapp/` ke GitHub
2. Buka **railway.app** → New Project → Deploy from GitHub
3. Set **Environment Variables** di tab Variables:
   ```
   TELEGRAM_BOT_TOKEN  = 1234567890:AAHxxxxxxx
   TELEGRAM_CHAT_ID    = 123456789
   APP_URL             = https://xxx.up.railway.app
   TOKEN_EXPIRE_MINUTES= 10
   ```
4. Copy URL dari Settings → Domains → isi ke APP_URL
5. Redeploy → selesai ✅

---

## 🔧 Jalankan Lokal

```bash
cd trafficapp
npm install
cp .env.example .env
# Edit .env dengan token & chat id Anda
npm start
# Buka http://localhost:3000
```

---

## 👨‍💼 Halaman Admin

```
https://yourapp.railway.app/admin
```
Lihat semua session, approve/reject tanpa buka Telegram.

---

## ❓ Troubleshooting

| Masalah | Solusi |
|---------|--------|
| Tidak dapat pesan Telegram | Pastikan sudah kirim `/start` ke bot Anda |
| Chat ID salah | Cek ulang via @userinfobot |
| Token expired | Pengunjung perlu request ulang |
| Bot token error | Salin ulang token dari BotFather |
