const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { WebSocketServer } = require('ws');
const os = require('os');

const dev = process.env.NODE_ENV !== 'production';
const port = 3000;

const app = next({ dev });
const handle = app.getRequestHandler();

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

// ── FIX 3: Catch any uncaught WS errors so server doesn't crash ──
process.on('uncaughtException', (err) => {
  if (err.message?.includes('Invalid WebSocket') || err.code === 'WS_ERR_INVALID_UTF8') return;
  console.error('[VITA] Uncaught exception:', err.message);
});

app.prepare().then(() => {
  const httpServer = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      res.statusCode = 500;
      res.end('Internal server error');
    }
  });

  // ── FIX 2: Use /vita-ws path so Next.js HMR WebSocket is NOT intercepted ──
  const wss = new WebSocketServer({ server: httpServer, path: '/vita-ws' });
  const clients = new Map();

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const clientType = url.searchParams.get('type') || 'unknown';
    const clientId   = Date.now() + Math.random().toString(36).slice(2);
    ws.clientType    = clientType;
    ws.clientId      = clientId;
    clients.set(clientId, ws);

    console.log(`[VITA] ✅ ${clientType} connected — total: ${clients.size}`);

    if (clientType === 'phone') {
      clients.forEach((c) => {
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
      } catch {}
    });

    ws.on('close', () => {
      clients.delete(clientId);
      console.log(`[VITA] ❌ ${clientType} disconnected — total: ${clients.size}`);
      if (clientType === 'phone') {
        clients.forEach((c) => {
          if (c.clientType === 'laptop' && c.readyState === 1)
            c.send(JSON.stringify({ type: 'phone_disconnected' }));
        });
      }
    });

    // ── FIX 3: Silently ignore WS frame errors ──
    ws.on('error', () => {});
  });

  wss.on('error', () => {});

  httpServer.listen(port, '0.0.0.0', () => {
    const ip = getLocalIP();
    console.log('\n');
    console.log('  ██╗   ██╗██╗████████╗ █████╗ ');
    console.log('  ██║   ██║██║╚══██╔══╝██╔══██╗');
    console.log('  ██║   ██║██║   ██║   ███████║');
    console.log('  ╚██╗ ██╔╝██║   ██║   ██╔══██║');
    console.log('   ╚████╔╝ ██║   ██║   ██║  ██║');
    console.log('    ╚═══╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝');
    console.log('\n  Personal Health & Fitness AI\n');
    console.log(`  💻  Laptop  →  http://localhost:${port}`);
    console.log(`  📱  Phone   →  http://${ip}:${port}/phone`);
    console.log('\n  Make sure both devices are on the same WiFi!\n');
  });
});
