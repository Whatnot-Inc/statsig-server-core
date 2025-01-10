import { BASE_DIR, getRootedPath } from '@/utils/file_utils.js';
import { Log } from '@/utils/teminal_utils.js';
import { execSync } from 'child_process';
import { Command } from 'commander';

const DOCKER_IMAGE = 'statsig/server-core-test-runner';

const TEST_COMMANDS: Record<string, string> = {
  python: [
    'cd /app/statsig-pyo3',
    'maturin build',
    'pip install ../target/wheels/sigstat_python_core*manylinux*.whl --force-reinstall --break-system-packages',
    'python3 -m pytest tests --capture=no -v',
  ].join(' && '),
  java: [
    'cd /app',
    'cargo build -p statsig_ffi',
    'mkdir -p /app/statsig-ffi/bindings/java/src/main/resources/native',
    'cp target/debug/libstatsig_ffi.so /app/statsig-ffi/bindings/java/src/main/resources/native',
    'cd /app/statsig-ffi/bindings/java',
    './gradlew test --rerun-tasks --console rich',
  ].join(' && '),
  php: [
    'cd /app',
    'cargo build -p statsig_ffi',
    'cd /app/statsig-php',
    'composer update',
    'composer test',
  ].join(' && '),
};

type Options = {
  skipDockerBuild: boolean;
};

export class UnitTests extends Command {
  constructor() {
    super('unit-tests');

    this.description('Run the tests for all relevant files');

    this.argument(
      '[language]',
      'The language to run tests for, e.g. python',
      'all',
    );

    this.option(
      '-sdb, --skip-docker-build',
      'Skip building the docker image',
      false,
    );

    this.action(this.run.bind(this));
  }

  async run(lang: string, options: Options) {
    Log.title('Running Tests');

    Log.stepBegin('Configuration');
    Log.stepProgress(`Language: ${lang}`);
    Log.stepProgress(`Skip Docker Build: ${options.skipDockerBuild}`);
    Log.stepEnd('Configuration');

    if (!options.skipDockerBuild) {
      await buildDockerImage();
    }

    const languages = lang === 'all' ? Object.keys(TEST_COMMANDS) : [lang];

    for (const lang of languages) {
      await runTestInDockerImage(lang);
    }

    Log.conclusion('Tests Ran');
  }
}

async function buildDockerImage() {
  const command = [
    'docker build .',
    `-t ${DOCKER_IMAGE}`,
    `-f ${getRootedPath(`cli/src/docker/Dockerfile.debian`)}`,
    `--secret id=gh_token_id,env=GH_TOKEN`,
  ].join(' ');

  Log.stepBegin(`Building Test Runner Docker Image`);
  Log.stepProgress(command);

  execSync(command, { cwd: BASE_DIR, stdio: 'inherit' });

  Log.stepEnd(`Built Test Runner Docker Image`);
}

async function runTestInDockerImage(lang: string) {
  Log.title(`Running tests for ${lang}`);

  const command = [
    'docker run --rm -it',
    `-v "${BASE_DIR}":/app`,
    `-v "/tmp:/tmp"`,
    `-v "/tmp/statsig-server-core/cargo-registry:/usr/local/cargo/registry"`,
    `${DOCKER_IMAGE}`,
    `"${TEST_COMMANDS[lang]}"`, // && while true; do sleep 1000; done
  ].join(' ');

  Log.stepBegin(`Executing docker command for ${lang}`);
  Log.stepProgress(command);

  execSync(command, { cwd: BASE_DIR, stdio: 'inherit' });

  Log.stepEnd(`Tests completed for ${lang}`);
}
