import {
  getFilenameWithoutExtension,
  getRootedPath,
} from '@/utils/file_utils.js';
import {
  deleteReleaseAssetWithName,
  getOctokit,
  getReleaseByVersion,
  uploadReleaseAsset,
} from '@/utils/octokit_utils.js';
import { Log } from '@/utils/teminal_utils.js';
import { getRootVersion } from '@/utils/toml_utils.js';
import path from 'path';

import { CommandBase } from './command_base.js';

type Options = {
  repo: string;
  release: string;
};

export class GhAttachAssets extends CommandBase {
  constructor() {
    super(import.meta.url);

    this.description('Attaches assets to a release');

    this.requiredOption(
      '--repo, <string>',
      'The name of the repository, e.g. statsig-core-php',
    );

    this.argument('<asset-path>', 'The path to the asset to attach');
  }

  override async run(asset: string, { repo }: Options) {
    Log.title('Attaching Asset to Release');

    const version = getRootVersion();
    const assetPath = getRootedPath(asset);
    const name = path.basename(assetPath);

    Log.stepBegin('Configuration');
    Log.stepProgress(`Repo: ${repo}`);
    Log.stepProgress(`Release Tag: ${version}`);
    Log.stepProgress(`Asset Name: ${name}`);
    Log.stepEnd(`Asset Path: ${assetPath}`);

    const octokit = await getOctokit();

    Log.stepBegin('Getting release');
    const release = await getReleaseByVersion(octokit, repo, version);
    if (!release) {
      Log.stepEnd('Release not found', 'failure');
      process.exit(1);
    }
    Log.stepEnd(`Release Found: ${release.html_url}`);

    Log.stepBegin('Deleting existing asset');
    const didDelete = await deleteReleaseAssetWithName(
      octokit,
      repo,
      release.id,
      name,
    );

    if (didDelete) {
      Log.stepEnd('Existing asset deleted');
    } else {
      Log.stepEnd('No existing asset found');
    }

    Log.stepBegin('Uploading asset');
    const uploadUrl = release.upload_url;
    if (!uploadUrl) {
      Log.stepEnd('No upload URL found', 'failure');
      process.exit(1);
    }

    const { result, error } = await uploadReleaseAsset(
      octokit,
      repo,
      release.id,
      assetPath,
    );

    if (error || !result) {
      const errMessage =
        error instanceof Error ? error.message : error ?? 'Unknown Error';

      Log.stepEnd(`Failed to upload asset: ${errMessage}`, 'failure');
      process.exit(1);
    }

    Log.stepEnd(`Asset uploaded: ${result.browser_download_url}`);

    Log.conclusion('Successfully Uploaded Asset');
  }
}
