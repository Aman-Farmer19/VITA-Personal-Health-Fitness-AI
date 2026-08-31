const { createServer } = require('https');
const { parse } = require('url');
const { writeFileSync, readFileSync } = require('fs');
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
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }

  return 'localhost';
}

// Write LAN IP so the phone page can display it.
const localIP = getLocalIP();

try {
  writeFileSync(
    join(__dirname, 'public', 'local-ip.json'),
    JSON.stringify({ ip: localIP }),
  );
} catch (err) {
  console.error('[VITA] Could not write local-ip.json:', err.message);
}

process.on('uncaughtException', (err) => {
  if (
    err.message?.includes('WebSocket') ||
    err.code === 'WS_ERR_INVALID_UTF8'
  ) {
    return;
  }

  console.error('[VITA] Error:', err.message);
});

app.prepare().then(() => {
  const httpServer = createServer(
    {
      key: readFileSync(join(__dirname, 'certs', 'vita-key.pem')),
      cert: readFileSync(join(__dirname, 'certs', 'vita-cert.pem')),
    },
    async (req, res) => {
      try {
        await handle(req, res, parse(req.url, true));
      } catch (err) {
        console.error('[VITA] Request error:', err);

        res.statusCode = 500;
        res.end('Internal server error');
      }
    },
  );

  // VITA WebSocket endpoint.
  // IMPORTANT: This does not interfere with Next.js HMR.
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/vita-ws',
  });

  const clients = new Map();

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const clientType = url.searchParams.get('type') || 'unknown';

    const clientId =
      Date.now() + Math.random().toString(36).slice(2);

    ws.clientType = clientType;

    clients.set(clientId, ws);

    console.log(
      `[VITA] ${clientType} connected - total: ${clients.size}`,
    );

    // Tell connected laptop(s) that a phone is available.
    if (clientType === 'phone') {
      clients.forEach((client) => {
        if (
          client.clientType === 'laptop' &&
          client.readyState === 1
        ) {
          client.send(
            JSON.stringify({
              type: 'phone_connected',
              source: 'server',
              protocol: 'vita-phone-v1',
              serverTimestamp: Date.now(),
            }),
          );
        }
      });
    }

    ws.on('message', (data) => {
      try {
        const raw = data.toString('utf8');
        const msg = JSON.parse(raw);

        const outbound = {
          ...msg,
          source:
            msg.source === 'phone' || clientType === 'phone'
              ? 'phone'
              : msg.source || clientType,
          serverTimestamp: Date.now(),
        };

        const payload = JSON.stringify(outbound);

        // Relay to every other connected VITA client.
        clients.forEach((client, id) => {
          if (
            id !== clientId &&
            client.readyState === 1
          ) {
            client.send(payload);
          }
        });

        console.log(
          `[VITA WS] ${clientType} message type=${String(
            msg.type || 'unknown',
          )}`,
        );
      } catch (err) {
        console.log(
          `[VITA WS] ignored invalid message from ${clientType}`,
        );
      }
    });

    ws.on('close', () => {
      clients.delete(clientId);

      console.log(
        `[VITA] ${clientType} disconnected - total: ${clients.size}`,
      );

      // Tell remaining laptop(s) that a phone disappeared.
      if (clientType === 'phone') {
        clients.forEach((client) => {
          if (
            client.clientType === 'laptop' &&
            client.readyState === 1
          ) {
            client.send(
              JSON.stringify({
                type: 'phone_disconnected',
                source: 'server',
                protocol: 'vita-phone-v1',
                serverTimestamp: Date.now(),
              }),
            );
          }
        });
      }
    });

    ws.on('error', (err) => {
      console.log(
        `[VITA WS] ${clientType} socket error: ${err.message}`,
      );
    });
  });

  httpServer.listen(port, '0.0.0.0', () => {
    console.log('');
    console.log('  VITA');
    console.log('');
    console.log('  Personal Health & Fitness AI');
    console.log('');
    console.log(`  Laptop -> https://localhost:${port}`);
    console.log(`  Phone  -> https://${localIP}:${port}/phone`);
    console.log('');
    console.log('  Same WiFi or USB tethering required!');
    console.log('');
  });
});