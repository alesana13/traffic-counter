require('dotenv').config();
const express = require('express');
const axios   = require('axios');
const crypto  = require('crypto');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// No-cache untuk index.html
app.use((req, res, next) => {
  if (req.path === '/' || req.path.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────
const TG_TOKEN  = process.env.TELEGRAM_BOT_TOKEN || '';
const TG_CHATID = process.env.TELEGRAM_CHAT_ID   || '';
const APP_URL   = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const EXPIRE_MS = (parseInt(process.env.TOKEN_EXPIRE_MINUTES) || 10) * 60 * 1000;

// SECRET untuk sign accessKey — tahan Railway restart
const SECRET = process.env.SECRET_KEY || 'mudik-balik-secret-2024';

// ─────────────────────────────────────────────
//  IN-MEMORY STORE
// ─────────────────────────────────────────────
const sessions  = new Map(); // token → { name, ip, status, createdAt, expiresAt }
const revoked   = new Set(); // token yang dicabut setelah approved

setInterval(() => {
  const now = Date.now();
  for (const [token, s] of sessions.entries()) {
    if (s.status === 'pending' && now > s.expiresAt) s.status = 'expired';
    if (now - s.createdAt > 3600000) sessions.delete(token);
  }
}, 5 * 60 * 1000);

// ─────────────────────────────────────────────
//  HMAC ACCESS KEY — bisa diverifikasi tanpa sessions map
// ─────────────────────────────────────────────
function makeAccessKey(token, name, expiresAt) {
  const payload = `${token}:${name}:${expiresAt}`;
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('hex').slice(0, 24);
  return Buffer.from(`${payload}:${sig}`).toString('base64url');
}

function verifyAccessKey(accessKey) {
  try {
    const decoded = Buffer.from(accessKey, 'base64url').toString();
    const lastColon = decoded.lastIndexOf(':');
    const payload = decoded.slice(0, lastColon);
    const sig     = decoded.slice(lastColon + 1);
    const parts   = payload.split(':');
    if (parts.length < 3) return null;
    const token     = parts[0];
    const expiresAt = parseInt(parts[parts.length - 1]);
    if (isNaN(expiresAt) || Date.now() > expiresAt) return null;
    if (revoked.has(token)) return null;
    const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('hex').slice(0, 24);
    if (sig !== expected) return null;
    return { token, name: parts.slice(1, -1).join(':') };
  } catch(e) { return null; }
}

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────
function generateToken(len = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

async function sendTelegram(message) {
  if (!TG_TOKEN || !TG_CHATID) {
    console.warn('⚠ Telegram config belum diset.');
    return false;
  }
  try {
    await axios.post(
      `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,
      { chat_id: TG_CHATID, text: message, parse_mode: 'Markdown' },
      { timeout: 8000 }
    );
    return true;
  } catch (err) {
    console.error('Telegram error:', err.message);
    return false;
  }
}

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || '?';
}

// ─────────────────────────────────────────────
//  ROUTES
// ─────────────────────────────────────────────

// POST /api/request-access
app.post('/api/request-access', async (req, res) => {
  const { name } = req.body;
  if (!name || name.trim().length < 2) return res.status(400).json({ error: 'Nama terlalu pendek' });

  const token     = generateToken();
  const now       = Date.now();
  const expiresAt = now + EXPIRE_MS;
  const ip        = getClientIp(req);
  const timeStr   = new Date().toLocaleString('id-ID', { timeZone:'Asia/Jakarta' });

  sessions.set(token, { name: name.trim(), ip, status: 'pending', createdAt: now, expiresAt });

  const approveUrl = `${APP_URL}/approve/${token}`;
  const rejectUrl  = `${APP_URL}/reject/${token}`;
  const msg =
    `🚦 *PERMINTAAN AKSES TRAFFIC COUNTER*\n\n` +
    `👤 Nama  : ${name.trim()}\n` +
    `🕐 Waktu : ${timeStr} WIB\n` +
    `🌐 IP    : ${ip}\n\n` +
    `✅ *IZINKAN* akses:\n${approveUrl}\n\n` +
    `❌ *TOLAK* akses:\n${rejectUrl}\n\n` +
    `_Token berlaku ${Math.round(EXPIRE_MS/60000)} menit_`;

  const sent = await sendTelegram(msg);
  console.log(`[${timeStr}] "${name.trim()}" (${ip}) token:${token} Telegram:${sent?'OK':'GAGAL'}`);

  res.json({ token, expires: expiresAt, tgDelivered: sent });
});

// GET /api/status/:token — polling dari frontend
app.get('/api/status/:token', (req, res) => {
  const s = sessions.get(req.params.token);
  if (!s) return res.status(404).json({ status: 'not_found' });

  if (s.status === 'pending' && Date.now() > s.expiresAt) s.status = 'expired';

  const payload = { status: s.status, name: s.name };
  if (s.status === 'approved') {
    // HMAC-signed accessKey — verifiable tanpa sessions map
    payload.accessKey = makeAccessKey(req.params.token, s.name, s.expiresAt);
  }
  res.json(payload);
});

// POST /api/verify — verifikasi accessKey saat refresh halaman
app.post('/api/verify', (req, res) => {
  const { accessKey } = req.body;
  if (!accessKey) return res.json({ valid: false });
  const result = verifyAccessKey(accessKey);
  if (!result) return res.json({ valid: false });
  res.json({ valid: true, name: result.name });
});

// GET /approve/:token
app.get('/approve/:token', (req, res) => {
  const s = sessions.get(req.params.token);
  if (!s) return res.send(htmlResponse('❌ Token Tidak Ditemukan', 'Token tidak valid atau sudah kadaluarsa.', false));
  if (Date.now() > s.expiresAt) {
    s.status = 'expired';
    return res.send(htmlResponse('⏰ Token Kadaluarsa', `Permintaan dari <b>${s.name}</b> sudah habis waktunya.`, false));
  }
  if (s.status === 'approved') return res.send(htmlResponse('✅ Sudah Diizinkan', `Akses untuk <b>${s.name}</b> sudah diizinkan.`, true));
  if (s.status === 'rejected') return res.send(htmlResponse('🚫 Sudah Ditolak', `Ubah jadi diizinkan?`, false, req.params.token));

  s.status = 'approved';
  revoked.delete(req.params.token); // batalkan revoke jika ada
  console.log(`✅ DIIZINKAN: "${s.name}" (${s.ip})`);
  res.send(htmlResponse('✅ Akses Diizinkan!', `<b>${s.name}</b> sekarang bisa menggunakan Traffic Counter.`, true));
});

// GET /reject/:token
app.get('/reject/:token', (req, res) => {
  const s = sessions.get(req.params.token);
  if (!s) return res.send(htmlResponse('❌ Token Tidak Ditemukan', 'Token tidak valid.', false));
  if (s.status === 'approved') {
    s.status = 'rejected';
    revoked.add(req.params.token); // tandai revoked agar accessKey tidak bisa dipakai lagi
    console.log(`❌ DICABUT: "${s.name}" (${s.ip})`);
    return res.send(htmlResponse('🚫 Akses Dicabut', `Akses <b>${s.name}</b> telah dicabut.`, false));
  }
  s.status = 'rejected';
  console.log(`❌ DITOLAK: "${s.name}" (${s.ip})`);
  res.send(htmlResponse('🚫 Akses Ditolak', `Permintaan dari <b>${s.name}</b> telah ditolak.`, false));
});

// GET /admin
app.get('/admin', (req, res) => {
  const rows = [...sessions.entries()]
    .sort((a,b) => b[1].createdAt - a[1].createdAt)
    .map(([token, s]) => {
      const statusColor = {pending:'#f5c842', approved:'#00e676', rejected:'#ff3b3b', expired:'#556'}[s.status] || '#fff';
      const time = new Date(s.createdAt).toLocaleString('id-ID', {timeZone:'Asia/Jakarta'});
      return `<tr>
        <td>${time}</td><td>${s.name}</td><td>${s.ip}</td>
        <td style="color:${statusColor};font-weight:700">${s.status.toUpperCase()}</td>
        <td>
          <a href="/approve/${token}" style="color:#00e676;margin-right:10px">✅ Izinkan</a>
          <a href="/reject/${token}"  style="color:#ff3b3b">❌ Tolak</a>
        </td></tr>`;
    }).join('');
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Admin</title>
    <style>body{font-family:monospace;background:#080b0f;color:#ddd;padding:20px}
    h1{color:#f5c842;margin-bottom:16px}table{border-collapse:collapse;width:100%}
    th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #222}
    th{color:#f5c842;font-size:.8rem;letter-spacing:.1em}td{font-size:.8rem}a{text-decoration:none}
    </style></head><body>
    <h1>🚦 Traffic Counter — Session Monitor</h1>
    <table><thead><tr><th>WAKTU</th><th>NAMA</th><th>IP</th><th>STATUS</th><th>AKSI</th></tr></thead>
    <tbody>${rows||'<tr><td colspan="5" style="color:#445">Belum ada permintaan</td></tr>'}</tbody>
    </table></body></html>`);
});

function htmlResponse(title, body, success, reissueToken=null) {
  const color = success ? '#00e676' : '#ff3b3b';
  const btn = reissueToken
    ? `<a href="/approve/${reissueToken}" style="display:inline-block;margin-top:16px;padding:10px 24px;background:rgba(0,230,118,.15);border:1px solid #00e676;color:#00e676;border-radius:8px;text-decoration:none;font-weight:700">✅ Izinkan Sekarang</a>`
    : '';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
  <style>body{font-family:'Segoe UI',sans-serif;background:#080b0f;color:#ddd;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
  .card{background:#0f1318;border:1px solid ${color}44;border-radius:16px;padding:32px 28px;max-width:360px;width:90%;text-align:center;box-shadow:0 0 40px ${color}22}
  h2{color:${color};font-size:1.4rem;margin-bottom:12px}p{line-height:1.6;color:#aaa;font-size:.9rem}.close{margin-top:20px;font-size:.75rem;color:#445}
  </style></head><body><div class="card"><h2>${title}</h2><p>${body}</p>${btn}
  <div class="close">Anda bisa tutup halaman ini.</div></div></body></html>`;
}

app.listen(PORT, () => {
  console.log(`\n🚦 Traffic Counter Server berjalan di port ${PORT}`);
  console.log(`   App URL  : ${APP_URL}`);
  console.log(`   Telegram : ${TG_CHATID ? '✅' : '⚠ BELUM DISET'}`);
  console.log(`   Secret   : ${SECRET !== 'mudik-balik-secret-2024' ? '✅ custom' : '⚠ pakai default (set SECRET_KEY di env!)'}\n`);
});
