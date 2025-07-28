import express from 'express';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { State } from '../common';
import { INITIAL_STATE } from './initial_state';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.static(join(__dirname, 'public')));

app.use((req, _res, next) => {
  log(`${req.method} ${req.path}`);
  next();
});

app.get('/', async (_req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

app.post('/state', async (req, res) => {
  log('Received state', req.body);
  if (req.body && Object.keys(req.body).length > 0) {
    log('Writing state', req.body);
    writeState(req.body);
  }

  const state = readState();
  log('Sending state', state);
  res.status(200).json(state);
});

app.get('/stats', async (_req, res) => {
  const stats = readDockerStats();
  res.status(200).json(stats);
});

app.listen(80, async () => {
  log('Dashboard server running');

  const state = INITIAL_STATE;
  if (state.scrapi.dcs.syncing.enabled) {
    await syncDcs(state);
  }

  setInterval(update, 1000);
});

function log(message: string, ...args: unknown[]) {
  console.log(`[${new Date().toISOString()}][dashboard] ${message}`, ...args);
}

function writeState(state: Record<string, unknown>) {
  writeFileSync(
    '/shared-volume/temp_state.json',
    JSON.stringify(state, null, 2),
  );

  execSync('mv /shared-volume/temp_state.json /shared-volume/state.json');
}

function readState() {
  const contents = readFileSync('/shared-volume/state.json', 'utf8');
  return JSON.parse(contents);
}

function readDockerStats() {
  const contents = readFileSync('/shared-volume/docker-stats.log', 'utf8');
  const lines = contents.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.trim() !== '') {
      return JSON.parse(line);
    }
  }
  return {};
}

async function update() {
  const state = readState();
  const dcsState = state.scrapi.dcs;
  const now = new Date();

  if (dcsState.syncing.enabled) {
    const updatedAt = new Date(dcsState.syncing.updatedAt);
    if (now.getTime() - updatedAt.getTime() > dcsState.syncing.intervalMs) {
      await syncDcs(state);
    }
  }
}

async function syncDcs(state: State) {
  log('Syncing DCS');
  const sdkKey = state.scrapi.dcs.syncing.sdkKey;
  try {
    const [v2Payload, v1Payload] = await Promise.all([
      safeFetch(
        `https://api.statsigcdn.com/v2/download_config_specs/${sdkKey}.json`,
      ),
      safeFetch(
        `https://api.statsigcdn.com/v1/download_config_specs/${sdkKey}.json`,
      ),
    ]);

    if (v2Payload == null || v1Payload == null) {
      throw new Error('Failed to fetch DCS');
    }

    state.scrapi.dcs.response.v2Payload = v2Payload;
    state.scrapi.dcs.response.v1Payload = v1Payload;
    state.scrapi.dcs.syncing.updatedAt = new Date();

    writeState(state);
    log('Successfully synced DCS');
  } catch (error) {
    log('Error polling DCS', error);
    return;
  }
}

function safeFetch(url: string) {
  return fetch(url)
    .then((res) => res.text())
    .catch((error) => {
      log('Error fetching', url, error);
      return null;
    });
}
