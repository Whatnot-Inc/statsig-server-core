import {
  getArchInfo,
  getDockerImageTag,
  isLinux,
} from '@/utils/docker_utils.js';
import { BASE_DIR, getRootedPath } from '@/utils/file_utils.js';
import { Log } from '@/utils/teminal_utils.js';
import { execSync } from 'child_process';

import { BuilderOptions } from './builder-options.js';

export function buildNode(options: BuilderOptions) {
  Log.title(`Building statsig-node`);

  const { docker } = getArchInfo(options.arch);
  const tag = getDockerImageTag(options.os, options.arch);
  const nodeDir = getRootedPath('statsig-node');

  const outDir = options.outDir ?? './build';

  const isMusl = options.target?.includes('musl');
  const isGnu = options.target?.includes('gnu');

  const nodeCommand = [
    'pnpm exec napi build',
    '--platform',
    '--js index.js',
    '--dts index.d.ts',
    isMusl ? '--cross-compile' : '',
    isGnu ? '--use-napi-cross --features vendored_openssl' : '',
    options.release ? '--release --strip' : '',
    options.target ? `--target ${options.target}` : '',
    `--output-dir ${outDir}`,
    ` && cp package.json ${outDir}`,
    options.target ? ` && cp npm/${options.target}.package.json ${outDir}` : '',
  ].join(' ');

  const dockerCommand = [
    'docker run --rm',
    `--platform ${docker}`,
    `-v "${BASE_DIR}":/app`,
    `-v "/tmp:/tmp"`,
    `-v "/tmp/statsig-server-core/cargo-registry:/usr/local/cargo/registry"`,
    `-v "/tmp/statsig-server-core/root-cargo-registry:/root/.cargo/registry"`,
    `-v "/tmp/statsig-server-core/npm-cache:/root/.npm"`,
    tag,
    `"cd /app/statsig-node && ${nodeCommand}"`, // && while true; do echo "wait..."; sleep 1000; done
  ].join(' ');

  const command =
    isLinux(options.os) && options.docker ? dockerCommand : nodeCommand;

  Log.stepBegin(`Executing build command`);
  Log.stepProgress(command);

  execSync(command, { cwd: nodeDir, stdio: 'inherit' });

  Log.stepEnd(`Built statsig-node`);
}
