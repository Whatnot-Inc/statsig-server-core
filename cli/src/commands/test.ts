import {
  Arch,
  OS,
  buildDockerImage,
  getArchInfo,
  getDockerImageTag,
  isLinux,
} from '@/utils/docker_utils.js';
import { BASE_DIR } from '@/utils/file_utils.js';
import { Log } from '@/utils/teminal_utils.js';
import { execSync } from 'child_process';

import { CommandBase } from './command_base.js';

const TEST_COMMANDS: Record<string, string> = {
  python: [
    'cd statsig-pyo3',
    'maturin build',
    'pip install ../target/wheels/statsig_python_core*manylinux*.whl --force-reinstall',
    'mkdir clean_test_env && cd clean_test_env && pytest ../tests --capture=no -v',
  ].join(' && '),
  java: [
    'cargo build -p statsig_ffi',
    'mkdir -p statsig-ffi/bindings/java/src/main/resources/native',
    'cp target/debug/libstatsig_ffi.so statsig-ffi/bindings/java/src/main/resources/native',
    'cd statsig-ffi/bindings/java',
    './gradlew test --rerun-tasks --console rich',
  ].join(' && '),

  php: [
    'cargo build -p statsig_ffi',
    'cd statsig-php',
    'composer update',
    'composer test',
  ].join(' && '),

  node: [
    'cd statsig-node',
    'pnpm install',
    'mkdir build && mv ./src/*.ts ./build',
    'pnpm exec napi build --cross-compile --platform --js binding.js --dts binding.d.ts --output-dir build',
    "tsc ./build/index.ts",
    'pnpm test',
  ].join(' && '),

  rust: [
    'cargo test -p statsig-rust',
    'cargo test -p statsig-rust --features with_zstd',
  ].join(' && '),
};

type Options = {
  skipDockerBuild: boolean;
  os: OS;
  arch: Arch;
  docker: boolean;
};

export class Test extends CommandBase {
  constructor() {
    super(import.meta.url);

    this.description('Run the tests for all relevant files');

    this.argument('<language>', 'The language to run tests for, e.g. python');

    this.option(
      '-sdb, --skip-docker-build',
      'Skip building the docker image',
      false,
    );

    this.option('-n, --no-docker', 'Run the tests locally without docker');

    this.option(
      '-os, --os <string>',
      'The OS to run tests for, e.g. debian',
      'debian',
    );

    this.option(
      '-a, --arch <string>',
      'The architecture to run tests for, e.g. amd64',
      'arm64',
    );
  }

  override async run(lang: string, options: Options) {
    Log.title('Running Tests');

    Log.stepBegin('Configuration');
    Log.stepProgress(`Language: ${lang}`);
    Log.stepProgress(`OS: ${options.os}`);
    Log.stepProgress(`Arch: ${options.arch}`);
    Log.stepProgress(`Skip Docker Build: ${options.skipDockerBuild}`);
    Log.stepProgress(`Docker: ${options.docker}`);
    Log.stepEnd(`Skip Docker Build: ${options.skipDockerBuild}`);

    if (!options.skipDockerBuild && options.docker) {
      buildDockerImage(options.os, options.arch);
    }

    runTestInDockerImage(lang, options);

    Log.conclusion('Tests Ran');
  }
}

function runTestInDockerImage(lang: string, options: Options) {
  const { docker } = getArchInfo(options.arch);
  const dockerImageTag = getDockerImageTag(options.os, options.arch);

  Log.title(`Running tests for ${lang}`);
  const dockerCommand = [
    'docker run --rm',
    `--platform ${docker}`,
    `-v "${BASE_DIR}":/app`,
    `-v "/tmp:/tmp"`,
    `-v "/tmp/statsig-server-core/cargo-registry:/usr/local/cargo/registry"`,
    dockerImageTag,
    `"cd /app && ${TEST_COMMANDS[lang]}"`, // && while true; do sleep 1000; done
  ].join(' ');

  let command = TEST_COMMANDS[lang];
  if (isLinux(options.os) && options.docker) {
    Log.stepBegin(`Executing docker command for ${lang}`);
    command = dockerCommand;
  } else {
    Log.stepBegin(`Executing command for ${lang}`);
    command = TEST_COMMANDS[lang];
  }
  Log.stepProgress(`${command}`);

  execSync(command, {
    cwd: BASE_DIR,
    stdio: 'inherit',
    env: { ...process.env, RUST_BACKTRACE: '1', FORCE_COLOR: 'true' },
  });
}
