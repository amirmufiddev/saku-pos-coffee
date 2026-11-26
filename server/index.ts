// server/index.ts
import { loadProjectEnv } from './config/load-env.js';

loadProjectEnv();

import { createServer } from './server.js';
import os from 'node:os';

const port = Number(process.env.SERVER_PORT) || 3344;
const host = process.env.SERVER_HOST || '0.0.0.0';

const instance = createServer();

instance.server.listen(port, host, () => {
  // Determine local LAN IP for multi-terminal connections
  const networkInterfaces = os.networkInterfaces();
  const lanIps: string[] = [];

  for (const name of Object.keys(networkInterfaces)) {
    for (const net of networkInterfaces[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        lanIps.push(net.address);
      }
    }
  }

  console.log('===============================================================');
  console.log('       ☕ SAKUPOS - COFFEE — OUTLET TRANSACTION SERVER (LAN)       ');
  console.log('===============================================================');
  console.log(`🚀 Server listening on http://localhost:${port}`);
  if (lanIps.length > 0) {
    console.log(`🌐 Multi-Terminal LAN Address: http://${lanIps[0]}:${port}`);
    console.log(`   (Secondary POS terminals connect to this LAN IP)`);
  }
  console.log(`📦 Database: SQLite WAL mode initialized at data/outlet_pos.sqlite`);
  console.log(`🖨️  Print Queue & Cup Label Service: ACTIVE`);
  console.log(`🏠 Mode: 100% Local Offline SQLite (No External API)`);
  console.log('===============================================================');
});
