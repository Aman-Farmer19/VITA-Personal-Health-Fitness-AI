const { createServer } = require('http');
const { parse } = require('url');
const { writeFileSync } = require('fs');
const { join } = require('path');
const next = require('next');
const { WebSocketServer } = require('ws');
const os = require('os');

const dev = process.env.NODE_ENV !== 'production';
const port = 3000;
const app = next({ dev });
const handle = app.getRequestHandler();

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const iface of nets[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

// ── Write IP to static file at startup — no API route needed ─────────
const localIP = getLocalIP();
try {
  writeFileSync(join(__dirname, 'public', 'local-ip.json'), JSON.stringify({ ip: localIP }));
} catch { }

process.on('uncaughtException', (err) => {
  if (err.message?.includes('WebSocket') || err.code === 'WS_ERR_INVALID_UTF8') return;
  console.error('[VITA] Error:', err.message);
});

app.prepare().then(() => {
  const httpServer = createServer(async (req, res) => {
    try {
      await handle(req, res, parse(req.url, true));
    } catch (err) {
      res.statusCode = 500;
      res.end('Internal server error');
    }
  });

  // ── WebSocket on /vita-ws path only — never intercepts HMR ──────────
  const wss = new WebSocketServer({ server: httpServer, path: '/vita-ws' });
  const clients = new Map();

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const clientType = url.searchParams.get('type') || 'unknown';
    const clientId = Date.now() + Math.random().toString(36).slice(2);
    ws.clientType = clientType;
    clients.set(clientId, ws);
    console.log(`[VITA] ✅ ${clientType} connected — total: ${clients.size}`);

    if (clientType === 'phone') {
      clients.forEach(c => {
        if (c.clientType === 'laptop' && c.readyState === 1)
          c.send(JSON.stringify({ type: 'phone_connected' }));
      });
    }

    ws.on('message', (data) => {
      try {
        const msg = data.toString('utf8');
        clients.forEach((c, id) => {
          if (id !== clientId && c.readyState === 1) c.send(msg);
        });
      } catch { }
    });

    ws.on('close', () => {
      clients.delete(clientId);
      console.log(`[VITA] ❌ ${clientType} disconnected — total: ${clients.size}`);
      if (clientType === 'phone') {
        clients.forEach(c => {
          if (c.clientType === 'laptop' && c.readyState === 1)
            c.send(JSON.stringify({ type: 'phone_disconnected' }));
        });
      }
    });

    ws.on('error', () => { });
  });

  wss.on('error', () => { });

  httpServer.listen(port, '0.0.0.0', () => {
    console.log('\n');
    console.log('  ██╗   ██╗██╗████████╗ █████╗ ');
    console.log('  ██║   ██║██║╚══██╔══╝██╔══██╗');
    console.log('  ╚██╗ ██╔╝██║   ██║   ███████║');
    console.log('   ╚═══╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝');
    console.log('\n  Personal Health & Fitness AI\n');
    console.log(`  💻  Laptop  →  http://localhost:${port}`);
    console.log(`  📱  Phone   →  http://${localIP}:${port}/phone`);
    console.log('\n  Same WiFi or USB tethering required!\n');
  });
});