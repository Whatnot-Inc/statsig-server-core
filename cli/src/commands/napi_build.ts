import { BASE_DIR, ensureEmptyDir, getRootedPath } from '@/utils/file_utils.js';
import { Log } from '@/utils/teminal_utils.js';
import chalk from 'chalk';
import { ExecSyncOptionsWithStringEncoding, execSync } from 'child_process';
import { Command } from 'commander';

type Options = {
  release?: boolean;
  useNapiCross?: boolean;
  useCrossCompile?: boolean;
  rebuildOpenssl?: boolean;
  skipJsOptimizations?: boolean;
  target?: string;
};

export class NapiBuild extends Command {
  constructor() {
    super('napi-build');

    this.description('Builds the statsig-napi package');
    this.option('--release', 'Build in release mode');
    this.option('--use-napi-cross', 'Build using napi-cross');
    this.option('--use-cross-compile', 'Build using cross-compile');
    this.option('--rebuild-openssl', 'Include vendored openssl with the build');
    this.option(
      '--target, <string>',
      'Which target to build for, eg x86_64-apple-darwin',
    );
    this.option('--skip-js-optimizations', 'Skip JS optimizations');

    this.action(this.run.bind(this));
  }

  async run(options: Options) {
    Log.title('Building statsig-napi');

    Log.stepBegin('Configuration');
    Log.stepProgress(`Target: ${options.target ?? 'Not Specified'}`);
    Log.stepProgress(`Use Napi Cross: ${options.useNapiCross ?? false}`);
    Log.stepProgress(`Cross Compile: ${options.useCrossCompile ?? false}`);
    Log.stepProgress(`Rebuild OpenSSL: ${options.rebuildOpenssl ?? false}`);
    Log.stepProgress(
      `Skip JS Optimizations: ${options.skipJsOptimizations ?? false}`,
    );

    ensureEmptyDir(getRootedPath('statsig-napi/dist/lib'));

    const isWindows = options.target?.includes('windows') === true;
    if (!isWindows) {
      const versions = getNpmVersion();
      for (const [pkg, version] of Object.entries(versions)) {
        Log.stepProgress(`${pkg}: ${version}`);
      }
    }

    Log.stepEnd(`For Release: ${options.release ?? false}`);

    Log.stepBegin('Ensuring empty build directory');
    const buildDir = getRootedPath('build/node');
    ensureEmptyDir(buildDir);
    Log.stepEnd(`Empty Dir Created: ${buildDir}`);

    Log.info('\n-- Beginning Napi Build --');
    runNapiBuild(options);
    Log.info('-- Napi Build Complete --');

    if (!options.skipJsOptimizations) {
      Log.info('\n-- Running Codemod --');
      genJsFiles();
      Log.info('-- Codemod Complete --');
    } else {
      Log.info(
        chalk.yellow('\nSkipping JS optimizations [--skip-js-optimizations]'),
      );
    }

    Log.stepBegin('\nCopying to Build Directory');
    copyToBuildDir(!options.skipJsOptimizations);
    Log.stepEnd('Copied files to: ' + buildDir);

    Log.conclusion('Successfully built statsig-napi');
  }

  static generateJsFiles() {
    genJsFiles();
  }
}

function getNpmVersion() {
  const napiDir = getRootedPath('statsig-napi');

  const packages = [
    'node_modules/@napi-rs/cli',
    'node_modules/jscodeshift',
    'node_modules/typescript',
    'node_modules/prettier',
  ];

  const version: Record<string, string> = {};
  for (const pkg of packages) {
    const cmd = `cat package-lock.json | jq '.packages["${pkg}"].version'`;
    const pkgVersion = execSync(cmd, { cwd: napiDir });
    version[pkg.replace('node_modules/', '')] = pkgVersion.toString().trim();
  }

  return version;
}

function runNapiBuild(options: Options) {
  const cmd = [
    'npx napi build',
    '--platform',
    '--js bindings.js',
    '--dts bindings.d.ts',
    '--strip',
    './src',
  ];

  if (options.release) {
    cmd.push('--release');
  }

  if (options.useNapiCross) {
    cmd.push('--use-napi-cross');
  }

  if (options.useCrossCompile) {
    cmd.push('--cross-compile');
  }

  if (options.rebuildOpenssl) {
    cmd.push('--features vendored_openssl');
  }

  if (options.target) {
    cmd.push('--target', options.target);
  }

  execSync(cmd.join(' '), {
    cwd: getRootedPath('statsig-napi'),
    stdio: 'inherit',
  });
}

function genJsFiles() {
  const cmd = [
    'npx jscodeshift',
    '--fail-on-error',
    '-t codemod/custom-error-message.js',
    'src/bindings.js',
  ];

  const opts: ExecSyncOptionsWithStringEncoding = {
    cwd: getRootedPath('statsig-napi'),
    stdio: 'inherit',
    encoding: 'utf-8',
  };

  execSync(cmd.join(' '), opts);
  execSync('npx prettier --write statsig-napi/src/bindings.d.ts', {
    ...opts,
    cwd: BASE_DIR,
  });
  execSync('npx prettier --write statsig-napi/src/bindings.js', {
    ...opts,
    cwd: BASE_DIR,
  });
  execSync('npx tsc', opts);
}

function copyToBuildDir(copyJs: boolean) {
  const opts: ExecSyncOptionsWithStringEncoding = {
    cwd: getRootedPath('statsig-napi'),
    stdio: 'inherit',
    encoding: 'utf-8',
  };

  execSync('cp package.json dist', opts);
  execSync('mv src/*.node dist/lib', opts);

  if (copyJs) {
    execSync('mv src/bindings.d.ts dist/lib', opts);
    execSync('mv src/bindings.js dist/lib', opts);
  }
}
