import { BASE_DIR, getRootedPath } from '@/utils/file_utils.js';
import {
  commitAndPushChanges,
  getCurrentBranchName,
} from '@/utils/git_utils.js';
import { SemVer } from '@/utils/semver.js';
import { Log } from '@/utils/teminal_utils.js';
import { getRootVersion } from '@/utils/toml_utils.js';
import chalk from 'chalk';
import { execSync } from 'child_process';
import fs from 'fs';
import { glob } from 'glob';

import { CommandBase } from './command_base.js';

export class SyncVersion extends CommandBase {
  constructor() {
    super(import.meta.url);

    this.description('Sync the version across all relevant files');

    this.option('--commit-and-push', 'Commit and push the changes', false);
  }

  override async run(options: { commitAndPush: boolean }) {
    SyncVersion.sync(options);
  }

  static async sync(options?: { commitAndPush: boolean }) {
    Log.title('Syncing Version');

    Log.stepBegin('Getting root version');
    const version = getRootVersion();
    const versionString = version.toString();
    Log.stepEnd(`Root Version: ${versionString}`);

    updateStatsigMetadataVersion(versionString);
    updateNodePackageJsonVersions(versionString);
    updateJavaGradleVersion(versionString);
    updateStatsigGrpcDepVersion(versionString);
    updatePhpComposerVersion(versionString);

    Log.stepBegin('Verifying Cargo Change');
    execSync('cargo update --workspace', { cwd: BASE_DIR });
    Log.stepEnd('Cargo Change Verified');

    if (options?.commitAndPush) {
      await tryCommitAndPushChanges(version);
    }

    Log.conclusion(`All Versions Updated to: ${versionString}`);
  }
}

function updateStatsigMetadataVersion(version: string) {
  Log.stepBegin('Updating statsig_metadata.rs');

  const path = getRootedPath('statsig-lib/src/statsig_metadata.rs');
  const contents = fs.readFileSync(path, 'utf8');

  const was = contents.match(/sdk_version: "([^"]+)"/)?.[1];
  const updated = contents.replace(
    /sdk_version: "([^"]+)"/,
    `sdk_version: "${version}"`,
  );

  fs.writeFileSync(path, updated, 'utf8');

  Log.stepEnd(`Updated Version: ${chalk.strikethrough(was)} -> ${version}`);
}

function updateNodePackageJsonVersions(version: string) {
  Log.stepBegin('Updating package.json');

  ['statsig-napi', 'statsig-node'].forEach((name) => {
    const paths = [getRootedPath(`${name}/package.json`)];
    paths.push(
      ...glob.sync(`${name}/npm/**package.json`, {
        cwd: BASE_DIR,
        absolute: true,
      }),
    );

    paths.forEach((path) => {
      const contents = fs.readFileSync(path, 'utf8');
      const json = JSON.parse(contents);

      const was = contents.match(/version": "([^"]+)"/)?.[1];
      const updated = contents.replace(
        /version": "([^"]+)"/,
        `version": "${version}"`,
      );

      fs.writeFileSync(path, updated, 'utf8');

      Log.stepProgress(
        `${json.name}: ${chalk.strikethrough(was)} -> ${version}`,
      );
    });
  });

  Log.stepEnd('Updated all package.json files');
}

function updateJavaGradleVersion(version: string) {
  Log.stepBegin('Updating gradle.properties');

  const path = getRootedPath('statsig-ffi/bindings/java/gradle.properties');
  const contents = fs.readFileSync(path, 'utf8');

  const was = contents.match(/version=([^"]+)/)?.[1];
  const updated = contents.replace(/version=([^"]+)/, `version=${version}`);

  fs.writeFileSync(path, updated, 'utf8');

  Log.stepEnd(`Updated Version: ${chalk.strikethrough(was)} -> ${version}`);
}

function updateStatsigGrpcDepVersion(version: string) {
  Log.stepBegin('Updating statsig-lib -> statsig-grpc dependency version');

  const path = getRootedPath('statsig-lib/Cargo.toml');
  const contents = fs.readFileSync(path, 'utf8');

  const was = contents.match(/sigstat-grpc = \{[^}]*version = "([^"]+)"/)?.[1];
  const updated = contents.replace(
    /(sigstat-grpc = \{[^}]*version = )"([^"]+)"/,
    `$1"${version}"`,
  );

  fs.writeFileSync(path, updated, 'utf8');

  Log.stepEnd(`Updated Version: ${chalk.strikethrough(was)} -> ${version}`);
}

function updatePhpComposerVersion(version: string) {
  Log.stepBegin('Updating composer.json');

  const path = getRootedPath('statsig-php/post-install.php');
  const contents = fs.readFileSync(path, 'utf8');

  const was = contents.match(/const VERSION = "([^"]+)"/)?.[1];
  const updated = contents.replace(
    /const VERSION = "([^"]+)"/,
    `const VERSION = "${version}"`,
  );

  fs.writeFileSync(path, updated, 'utf8');

  Log.stepEnd(`Updated Version: ${chalk.strikethrough(was)} -> ${version}`);
}

async function tryCommitAndPushChanges(version: SemVer) {
  Log.stepBegin('Commit and Push Changes');

  const localBranch = await getCurrentBranchName();
  const remoteBranch = process.env['GITHUB_REF'] ?? version.toBranch();

  Log.stepProgress(`Local Branch: ${localBranch}`);
  Log.stepProgress(`Remote Branch: ${remoteBranch}`);

  const { success, error } = await commitAndPushChanges(
    BASE_DIR,
    `chore: bump version to ${version.toString()}`,
    'origin',
    localBranch,
    remoteBranch,
    true /* shouldPushChanges */,
  );

  if (success) {
    Log.stepEnd('Successfully Committed and Pushed');
  } else if (error instanceof Error && error.name === 'NoChangesError') {
    Log.stepEnd('No Changes to Commit');
  } else {
    Log.stepEnd(`Failed to Commit and Push Changes`, 'failure');

    throw error;
  }
}
