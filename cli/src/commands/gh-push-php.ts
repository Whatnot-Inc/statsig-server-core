import { getRootedPath } from '@/utils/file_utils.js';
import {
  commitAndPushChanges,
  createEmptyRepository,
} from '@/utils/git_utils.js';
import { getBranchByVersion, getOctokit } from '@/utils/octokit_utils.js';
import { Log } from '@/utils/terminal_utils.js';
import { getRootVersion } from '@/utils/toml_utils.js';

import { CommandBase } from './command_base.js';

export class GhPushPhp extends CommandBase {
  constructor() {
    super(import.meta.url);

    this.description('Pushes the statsig-php package to GitHub');
  }

  override async run() {
    Log.title('Pushing statsig-php to GitHub');

    const version = getRootVersion();

    Log.stepBegin(`Checking if ${version.toBranch()} branch exists`);
    const octokit = await getOctokit();
    const foundBranch = await getBranchByVersion(
      octokit,
      'statsig-core-php',
      version,
    );

    if (foundBranch) {
      Log.stepEnd(`Branch ${version.toBranch()} already exists`, 'failure');
      process.exit(1);
    }
    Log.stepEnd(`Branch ${version.toBranch()} does not exist`);

    Log.stepBegin('Creating empty repository');
    const repoPath = getRootedPath('statsig-php');
    await createEmptyRepository(repoPath, 'statsig-core-php');
    Log.stepEnd(`Repo Created: ${repoPath}`);

    Log.stepBegin('Committing changes');

    Log.stepBegin('Getting Branch Info');
    const branch = 'master';
    const remoteBranch = version.toBranch();
    const remote = 'origin';
    Log.stepProgress(`Local Branch: ${branch}`);
    Log.stepProgress(`Remote Branch: ${remoteBranch}`);
    Log.stepEnd(`Remote Name: ${remote}`);

    Log.stepBegin('Committing changes');
    const { success, error } = await commitAndPushChanges({
      repoPath,
      message: `chore: bump version to ${version.toString()}`,
      remote,
      localBranch: branch,
      remoteBranch,
      shouldPushChanges: true,
    });

    if (error || !success) {
      const errMessage =
        error instanceof Error ? error.message : (error ?? 'Unknown Error');

      Log.stepEnd(`Failed to commit changes: ${errMessage}`, 'failure');
      process.exit(1);
    }

    Log.stepEnd('Changes committed');

    Log.conclusion('Successfully pushed statsig-php to GitHub');
  }
}
