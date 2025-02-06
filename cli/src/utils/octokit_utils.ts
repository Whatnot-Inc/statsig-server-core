import { createAppAuth } from '@octokit/auth-app';
import { createReadStream, writeFileSync } from 'fs';
import { Octokit } from 'octokit';
import path from 'path';

import { getFileSize } from './file_utils.js';
import { SemVer } from './semver.js';
import { Log } from './teminal_utils.js';

const GITHUB_APP_ID = process.env.GH_APP_ID;
const GITHUB_INSTALLATION_ID = process.env.GH_APP_INSTALLATION_ID;
const GITHUB_APP_PRIVATE_KEY = process.env.GH_APP_PRIVATE_KEY;

export type GhRelease = Awaited<
  ReturnType<Octokit['rest']['repos']['getReleaseByTag']>
>['data'];

export type GhAsset = Awaited<
  ReturnType<Octokit['rest']['repos']['listReleaseAssets']>
>['data'][number];

type GhBranch = Awaited<ReturnType<Octokit['rest']['git']['getRef']>>['data'];

export async function getOctokit() {
  const token = await getInstallationToken();

  return new Octokit({
    auth: token,
  });
}

export async function getInstallationToken() {
  if (!GITHUB_APP_ID) {
    throw new Error('GITHUB_APP_ID is not set');
  }

  if (!GITHUB_INSTALLATION_ID) {
    throw new Error('GITHUB_INSTALLATION_ID is not set');
  }

  if (!GITHUB_APP_PRIVATE_KEY) {
    throw new Error('GITHUB_APP_PRIVATE_KEY is not set');
  }

  const auth = createAppAuth({
    appId: GITHUB_APP_ID,
    privateKey: GITHUB_APP_PRIVATE_KEY,
  });

  const result = await auth({
    type: 'installation',
    installationId: GITHUB_INSTALLATION_ID,
  });

  return result.token;
}

export async function getReleaseByVersion(
  octokit: Octokit,
  repo: string,
  version: SemVer,
): Promise<GhRelease | null> {
  try {
    const { data } = await octokit.rest.repos.getReleaseByTag({
      owner: 'statsig-io',
      repo,
      tag: version.toString(),
    });

    return data;
  } catch {
    return null;
  }
}

export async function getBranchByVersion(
  octokit: Octokit,
  repo: string,
  version: SemVer,
): Promise<GhBranch | null> {
  try {
    const branch = version.toBranch();
    const branchRef = `heads/${branch}`;

    const result = await octokit.rest.git.getRef({
      owner: 'statsig-io',
      repo,
      ref: branchRef,
    });

    return result.data;
  } catch {
    return null;
  }
}

export async function createGithubRelease(
  octokit: Octokit,
  repository: string,
  version: SemVer,
  targetSha: string,
) {
  Log.stepBegin('Creating GitHub Release');
  Log.stepProgress(`Repository: ${repository}`);
  Log.stepProgress(`Release Tag: ${version}`);
  Log.stepEnd(`Target SHA: ${targetSha}`);

  Log.stepBegin('Checking for existing release');
  const release = await getReleaseByVersion(octokit, repository, version);

  if (release) {
    Log.stepEnd(`Release already exists: ${release.html_url}`, 'failure');
    process.exit(1);
  }

  Log.stepEnd(`Release ${version} does not exist`);

  Log.stepBegin('Checking if branch exists');
  const branch = await getBranchByVersion(octokit, repository, version);

  if (!branch) {
    Log.stepEnd(`Branch ${version.toBranch()} does not exist`, 'failure');
    process.exit(1);
  }

  Log.stepEnd(`Branch ${branch.ref} exists`);

  Log.stepBegin('Creating release');

  const { result: newRelease, error } = await createReleaseForVersion(
    octokit,
    repository,
    version,
    branch.object.sha,
  );

  if (!newRelease) {
    Log.stepEnd(`Failed to create release`, 'failure');
    console.error(error ?? 'Unknown error');
    process.exit(1);
  }

  Log.stepEnd(`Release created: ${newRelease.html_url}`);

  Log.conclusion(`Successfully Created Release ${version}`);
}

export async function deleteReleaseAssetWithName(
  octokit: Octokit,
  repo: string,
  releaseId: number,
  assetName: string,
) {
  const { data } = await octokit.rest.repos.listReleaseAssets({
    owner: 'statsig-io',
    repo,
    release_id: releaseId,
    per_page: 100,
  });

  const existingAsset = data.find((asset) => asset.name === assetName);

  if (!existingAsset) {
    return false;
  }

  await octokit.rest.repos.deleteReleaseAsset({
    owner: 'statsig-io',
    repo,
    asset_id: existingAsset.id,
  });

  return true;
}

export async function uploadReleaseAsset(
  octokit: Octokit,
  repo: string,
  releaseId: number,
  assetPath: string,
  name?: string,
) {
  const assetContent = createReadStream(assetPath);
  const size = getFileSize(assetPath);

  try {
    const response = await octokit.rest.repos.uploadReleaseAsset({
      owner: 'statsig-io',
      repo,
      release_id: releaseId,
      name: name ?? path.basename(assetPath),
      // It wants a string, but it works with streams too
      data: assetContent as unknown as string,
      headers: {
        'Content-Length': size.toString(),
      },
    });

    return { result: response.data, error: null };
  } catch (error) {
    return { result: null, error };
  }
}

export async function createReleaseForVersion(
  octokit: Octokit,
  repo: string,
  version: SemVer,
  targetSha?: string,
): Promise<{ result?: GhRelease; error?: any }> {
  try {
    const result = await octokit.rest.repos.createRelease({
      owner: 'statsig-io',
      repo,
      tag_name: version.toString(),
      target_commitish: targetSha,
      prerelease: version.isBeta(),
    });

    return { result: result.data };
  } catch (error) {
    console.error(error);
    return { error };
  }
}

export async function getAllAssetsForRelease(
  octokit: Octokit,
  repo: string,
  releaseId: number,
  prefix: string,
) {
  try {
    const { data } = await octokit.rest.repos.listReleaseAssets({
      owner: 'statsig-io',
      repo,
      release_id: releaseId,
      per_page: 100,
    });

    const assets = data.filter((asset) => asset.name.startsWith(prefix));

    return { assets, error: null };
  } catch (error) {
    return { error, assets: null };
  }
}

export async function downloadReleaseAsset(
  octokit: Octokit,
  repo: string,
  assetId: number,
): Promise<ArrayBuffer> {
  const file = await octokit.rest.repos.getReleaseAsset({
    owner: 'statsig-io',
    repo,
    asset_id: assetId,
    headers: {
      Accept: 'application/octet-stream',
    },
  });

  // the 'Accept' header means it returns a buffer
  return file.data as unknown as ArrayBuffer;
}

export async function downloadArtifactToFile(
  octokit: Octokit,
  repo: string,
  artifactId: number,
  filePath: string,
): Promise<{ data: ArrayBuffer; url: string }> {
  const response = (await octokit.rest.actions.downloadArtifact({
    owner: 'statsig-io',
    repo,
    artifact_id: artifactId,
    archive_format: 'zip',
  })) as { data?: ArrayBuffer; url?: string };

  if (
    !response.data ||
    !response.url ||
    !(response.data instanceof ArrayBuffer)
  ) {
    throw new Error(`Failed to download artifact ${artifactId}`);
  }

  writeFileSync(filePath, Buffer.from(response.data));

  return { data: response.data, url: response.url };
}
