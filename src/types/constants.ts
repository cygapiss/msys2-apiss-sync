/** mirror-sync tooling branch on each msys2-apiss/* mirror repo. */
export const MIRROR_SYNC_BRANCH = 'msys2-apiss-mirror-sync';

/** mirror-merge tooling branch on destination repo cygapiss/msys2-apiss. */
export const MIRROR_MERGE_BRANCH = 'msys2-apiss-mirror-merge';

/** mirror-poll -> mirror-sync workflow_dispatch input on mirror-sync.yml. */
export const WORKFLOW_DISPATCH_MIRROR_SYNC = 'workflow_dispatch_mirror_sync';

/** mirror-sync -> mirror-merge workflow_dispatch input on mirror-merge.yml. */
export const WORKFLOW_DISPATCH_MIRROR_MERGE = 'workflow_dispatch_mirror_merge';

export const GITHUB_API = 'https://api.github.com';

/** mirror-sync bundled CLI filename (committed in tooling repo; CI downloads by URL). */
export const MIRROR_SYNC_BUNDLE = 'mirror-sync.mjs';

/** mirror-merge bundled CLI filename (committed in tooling repo; CI downloads by URL). */
export const MIRROR_MERGE_BUNDLE = 'mirror-merge.mjs';

/** Install templates copied by mirror-init (workflow YAML). */
export const MIRROR_TEMPLATE_DIR = 'config/mirror-template';

/** Per-mirror mirror-sync config; repo name matches filename (<repo>.json). */
export const MIRROR_SYNC_CONFIG_DIR = 'config/mirror-sync';

/** Prebuilt mirror-sync/mirror-merge bundles (yarn run pack). */
export const MIRROR_TOOLINGS_TEMPLATE_DIR = 'config/mirror-template/toolings';

/** mirror-merge replay config path under downloaded .github/toolings/ in CI. */
export const MIRROR_MERGE_BUNDLED_CONFIG_REL = 'config/mirror-merge.json';

/** mirror-sync bundle install dir on mirror/destination tooling branches. */
export const MIRROR_SYNC_TOOLINGS_DIR = '.github/toolings';

/** mirror-merge replay config in the tooling repo (local yarn mirror-merge). */
export const MIRROR_MERGE_CONFIG_PATH = 'config/mirror-merge.json';

/** mirror-poll config in the tooling repo. */
export const MIRROR_POLL_CONFIG_PATH = 'config/mirror-poll.json';

/** Repo -> per-repo tooling digest map (mirror-init --push only). */
export const TOOLING_DIGEST_PATH = 'config/digest.json';

/** This tooling repository (mirror-poll workflows on main). */
export const TOOLING_REPO = 'msys2-apiss-sync';

/** Default branch for TOOLING_REPO (mirror-poll.yml lives here). */
export const TOOLING_DEFAULT_BRANCH = 'main';

/** GitHub raw URL base for committed mirror-template toolings (CI download). */
export const TOOLING_REPO_RAW_BASE = `https://raw.githubusercontent.com/msys2-apiss/${TOOLING_REPO}/${TOOLING_DEFAULT_BRANCH}`;

/** mirror-sync CLI bundle URL (downloaded in mirror-sync.yml; not committed on mirror repos). */
export const MIRROR_SYNC_BUNDLE_URL = `${TOOLING_REPO_RAW_BASE}/${MIRROR_TOOLINGS_TEMPLATE_DIR}/${MIRROR_SYNC_BUNDLE}`;

/** mirror-merge CLI bundle URL (downloaded in mirror-merge.yml; not committed on destination). */
export const MIRROR_MERGE_BUNDLE_URL = `${TOOLING_REPO_RAW_BASE}/${MIRROR_TOOLINGS_TEMPLATE_DIR}/${MIRROR_MERGE_BUNDLE}`;

/** mirror-merge replay config URL (downloaded with mirror-merge.mjs in CI). */
export const MIRROR_MERGE_CONFIG_URL = `${TOOLING_REPO_RAW_BASE}/${MIRROR_MERGE_CONFIG_PATH}`;

/** mirror-sync per-mirror config URL (downloaded in mirror-sync.yml by repository name). */
export function mirrorSyncConfigUrl(repoName: string): string {
  return `${TOOLING_REPO_RAW_BASE}/${MIRROR_SYNC_CONFIG_DIR}/${repoName}.json`;
}
