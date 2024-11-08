import { BumpVersion } from './bump_version.js';
import { GhAttachAssets } from './gh_attach_assets.js';
import { GhCreateRelease } from './gh_create_release.js';
import { GhPushPhp } from './gh_push_php.js';
import { SyncVersion } from './sync_version.js';
import { ZipFiles } from './zip_files.js';

export const Commands = [
  new BumpVersion(),
  new SyncVersion(),
  new ZipFiles(),
  new GhCreateRelease(),
  new GhPushPhp(),
  new GhAttachAssets(),
];
