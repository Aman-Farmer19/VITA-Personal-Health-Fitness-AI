import { NextResponse } from 'next/server';
import os from 'os';

// Cache result — no need to scan interfaces on every request
let cachedIP: string | null = null;

export function GET() {
  if (cachedIP) return NextResponse.json({ ip: cachedIP });

  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        cachedIP = iface.address;
        return NextResponse.json({ ip: cachedIP });
      }
    }
  }
  return NextResponse.json({ ip: 'localhost' });
}