'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { openDb } = require('./db');
const { scanIntoDb } = require('./scan');
const { computeStats } = require('./stats');

const DASHBOARD_PATH = path.join(__dirname, 'dashboard.html');
const DEFAULT_PORT = 4321;

function handleRequest(request, response) {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/api/stats') {
    const db = openDb();
    try {
      scanIntoDb(db); // refresh skill inventory on every dashboard load
      const stats = computeStats(db);
      response.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      response.end(JSON.stringify(stats));
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: String(error.message || error) }));
    } finally {
      db.close();
    }
    return;
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(fs.readFileSync(DASHBOARD_PATH));
    return;
  }
  response.writeHead(404, { 'Content-Type': 'text/plain' });
  response.end('not found');
}

// Listens on preferredPort, walking upward if it is taken.
function startServer(preferredPort, onReady) {
  const server = http.createServer(handleRequest);
  let port = preferredPort || DEFAULT_PORT;
  let attempts = 0;
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && attempts < 50) {
      attempts += 1;
      port += 1;
      server.listen(port, '127.0.0.1');
    } else {
      throw error;
    }
  });
  server.on('listening', () => onReady && onReady(server.address().port, server));
  server.listen(port, '127.0.0.1');
  return server;
}

module.exports = { startServer, DEFAULT_PORT };
