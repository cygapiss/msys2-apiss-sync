import { appendFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
//#region src/git/index.ts
function sleep(milliseconds) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}
function gitLockError(text) {
	return /index\.lock|Unable to create.*\.lock|Another git process/.test(text);
}
function clearGitLockFiles(repoPath, logger) {
	const gitDir = join(repoPath, ".git");
	for (const name of [
		"index.lock",
		"shallow.lock",
		"HEAD.lock"
	]) {
		const lockPath = join(gitDir, name);
		if (!existsSync(lockPath)) continue;
		try {
			rmSync(lockPath, { force: true });
			logger?.write(`Removed stale git lock: ${name}`, "Warn");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger?.write(`Could not remove git lock ${name} : ${message}`, "Warn");
		}
	}
}
function runGit(repoPath, gitArgs, env = {}, maxAttempts = 5, logger) {
	return runGitInternal(repoPath, gitArgs, void 0, env, maxAttempts, logger);
}
function runGitText(repoPath, gitArgs) {
	return runGitInternal(repoPath, gitArgs, void 0, {}, 1);
}
function runGitInternal(repoPath, gitArgs, inputText, env, maxAttempts, logger) {
	let attempt = 0;
	let lastOutput = "";
	while (attempt < maxAttempts) {
		attempt++;
		const result = spawnSync("git", repoPath ? [
			"-C",
			repoPath,
			...gitArgs
		] : gitArgs, {
			input: inputText,
			encoding: "utf8",
			env: {
				...process.env,
				...env
			},
			windowsHide: true
		});
		const stdout = result.stdout ?? "";
		const stderr = result.stderr ?? "";
		if (result.status === 0) return stdout || stderr;
		lastOutput = (stderr || stdout || result.error?.message || "").trim();
		if (repoPath && gitLockError(lastOutput) && attempt < maxAttempts) {
			clearGitLockFiles(repoPath, logger);
			sleep(200 * attempt);
			continue;
		}
		const command = repoPath ? `git -C ${repoPath} ${gitArgs.join(" ")}` : `git ${gitArgs.join(" ")}`;
		throw new Error(`git command failed (${command}): ${lastOutput}`);
	}
	const command = repoPath ? `git -C ${repoPath} ${gitArgs.join(" ")}` : `git ${gitArgs.join(" ")}`;
	throw new Error(`git command failed (${command}): ${lastOutput}`);
}
var GITHUB_HTTPS_ORIGIN = /^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/;
function githubSshPushUrl(httpsOriginUrl) {
	const match = httpsOriginUrl.trim().match(GITHUB_HTTPS_ORIGIN);
	if (!match) return null;
	const repo = match[2].endsWith(".git") ? match[2] : `${match[2]}.git`;
	return `git@github.com:${match[1]}/${repo}`;
}
//#endregion
//#region src/types/constants.ts
/** mirror-merge tooling branch on destination repo cygapiss/msys2-apiss. */
var MIRROR_MERGE_BRANCH = "msys2-apiss-mirror-merge";
/** mirror-poll -> mirror-sync workflow_dispatch input on mirror-sync.yml. */
var WORKFLOW_DISPATCH_MIRROR_SYNC = "workflow_dispatch_mirror_sync";
/** mirror-sync -> mirror-merge workflow_dispatch input on mirror-merge.yml. */
var WORKFLOW_DISPATCH_MIRROR_MERGE = "workflow_dispatch_mirror_merge";
/** mirror-sync bundled CLI filename (committed in tooling repo; CI downloads by URL). */
var MIRROR_SYNC_BUNDLE = "mirror-sync.mjs";
/** mirror-merge bundled CLI filename (committed in tooling repo; CI downloads by URL). */
var MIRROR_MERGE_BUNDLE = "mirror-merge.mjs";
/** Prebuilt mirror-sync/mirror-merge bundles (yarn run pack). */
var MIRROR_TOOLINGS_TEMPLATE_DIR = "config/mirror-template/toolings";
/** mirror-merge replay config in the tooling repo (local yarn mirror-merge). */
var MIRROR_MERGE_CONFIG_PATH = "config/mirror-merge.json";
/** GitHub raw URL base for committed mirror-template toolings (CI download). */
var TOOLING_REPO_RAW_BASE = `https://raw.githubusercontent.com/msys2-apiss/msys2-apiss-sync/main`;
`${TOOLING_REPO_RAW_BASE}${MIRROR_TOOLINGS_TEMPLATE_DIR}${MIRROR_SYNC_BUNDLE}`;
`${TOOLING_REPO_RAW_BASE}${MIRROR_TOOLINGS_TEMPLATE_DIR}${MIRROR_MERGE_BUNDLE}`;
`${TOOLING_REPO_RAW_BASE}${MIRROR_MERGE_CONFIG_PATH}`;
//#endregion
//#region src/git/mirror-dispatch.ts
var MIRROR_MERGE_DISPATCH = {
	Mirror: "mirror-merge",
	ToolingBranch: MIRROR_MERGE_BRANCH,
	WorkflowFile: "mirror-merge.yml",
	WorkflowInputs: [["event_type", WORKFLOW_DISPATCH_MIRROR_MERGE]]
};
//#endregion
//#region src/git/gh.ts
function runGh(args) {
	const result = spawnSync("gh", args, {
		encoding: "utf8",
		stdio: [
			"ignore",
			"pipe",
			"pipe"
		],
		windowsHide: true
	});
	return {
		ok: result.status === 0,
		stdout: (result.stdout ?? "").trim(),
		stderr: (result.stderr ?? "").trim()
	};
}
function ghMirrorWorkflowRunCount(owner, repoName, spec, status) {
	const result = runGh([
		"run",
		"list",
		"--repo",
		`${owner}/${repoName}`,
		"--workflow",
		spec.WorkflowFile,
		"--branch",
		spec.ToolingBranch,
		"--status",
		status,
		"--limit",
		"1",
		"--json",
		"databaseId",
		"-q",
		"length"
	]);
	if (!result.ok) return null;
	const count = Number.parseInt(result.stdout, 10);
	return Number.isFinite(count) ? count : null;
}
function ghMirrorWorkflowRunBusy(owner, repoName, spec) {
	for (const status of ["in_progress", "queued"]) {
		const count = ghMirrorWorkflowRunCount(owner, repoName, spec, status);
		if (count === null) return null;
		if (count > 0) return true;
	}
	return false;
}
//#endregion
//#region src/mirror-sync/index.ts
function loadMirrorSyncConfig(path) {
	if (!existsSync(path)) throw new Error(`Missing ${path}`);
	return JSON.parse(readFileSync(path, "utf8"));
}
function validateMirrorSyncConfig(config) {
	if (!config.UpstreamUrl) throw new Error("UpstreamUrl is required");
	if (!config.Branches?.length) throw new Error("Branches must contain at least one entry");
	for (const branch of config.Branches) if (!branch.Upstream || !branch.Mirror) throw new Error("Each Branches entry must include Upstream and Mirror");
}
function mirrorBranchNeedsUpdate(beforeSha, afterSha) {
	return beforeSha !== afterSha;
}
function getMirrorSyncNotify(config) {
	if (!config.Notify?.Enabled) return { Enabled: false };
	return {
		Enabled: true,
		Repository: config.Notify.Repository,
		EventType: config.Notify.EventType ?? "workflow_dispatch_mirror_merge"
	};
}
function shouldDispatchMirrorMerge(result) {
	return result.Advanced && result.Notify.Enabled;
}
function resolveDispatchMirrorMerge(result, options) {
	if (!shouldDispatchMirrorMerge(result)) return false;
	if (options?.MirrorMergeBusy === true) return false;
	return true;
}
function parseNotifyRepository(repository) {
	if (!repository) return null;
	const parts = repository.split("/");
	if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
	return {
		Owner: parts[0],
		Repo: parts[1]
	};
}
function mirrorMergeBusyOnNotifyTarget(notify) {
	const target = parseNotifyRepository(notify.Repository);
	if (!target) return null;
	return ghMirrorWorkflowRunBusy(target.Owner, target.Repo, MIRROR_MERGE_DISPATCH);
}
function verifyMirrorSyncEventType(eventType) {
	if (eventType === void 0) return;
	if (eventType !== "workflow_dispatch_mirror_sync") throw new Error(`Unsupported event_type: ${eventType} (expected ${WORKFLOW_DISPATCH_MIRROR_SYNC})`);
}
function getRefSha(repoPath, ref) {
	try {
		return runGitText(repoPath, ["rev-parse", ref]).trim() || null;
	} catch {
		return null;
	}
}
function ensureUpstreamRemote(repoPath, upstreamUrl) {
	try {
		runGit(repoPath, [
			"remote",
			"add",
			"upstream",
			upstreamUrl
		], {}, 1);
	} catch {
		runGit(repoPath, [
			"remote",
			"set-url",
			"upstream",
			upstreamUrl
		], {}, 1);
	}
}
/** When PushViaSsh: use git@github.com push URL (auth via ssh-agent / MIRROR_PUSH_SSH_KEY in CI). */
function configureMirrorSyncPushTransport(repoPath, config, logger) {
	if (config.PushViaSsh) {
		if (!process.env.SSH_AUTH_SOCK) logger.write("PushViaSsh: SSH_AUTH_SOCK is unset; load MIRROR_PUSH_SSH_KEY into ssh-agent before push", "Warn");
		let originUrl;
		try {
			originUrl = runGitText(repoPath, [
				"remote",
				"get-url",
				"origin"
			]).trim();
		} catch {
			return;
		}
		const sshUrl = githubSshPushUrl(originUrl);
		if (!sshUrl) {
			logger.write("PushViaSsh: origin is not a GitHub HTTPS URL; skipping SSH push URL setup", "Warn");
			return;
		}
		let pushUrl = originUrl;
		try {
			pushUrl = runGitText(repoPath, [
				"remote",
				"get-url",
				"--push",
				"origin"
			]).trim();
		} catch {}
		if (pushUrl !== sshUrl) runGit(repoPath, [
			"remote",
			"set-url",
			"--push",
			"origin",
			sshUrl
		], {}, 5, logger);
		logger.write(`Push transport: SSH (${sshUrl})`);
		return;
	}
	runGit(null, [
		"config",
		"--global",
		"http.version",
		"HTTP/1.1"
	], {}, 1, logger);
	runGit(null, [
		"config",
		"--global",
		"http.postBuffer",
		"524288000"
	], {}, 1, logger);
	logger.write("Push transport: HTTPS");
}
function syncMirrorBranch(input) {
	const { RepoPath, Branch, Logger } = input;
	Logger.write(`Syncing ${Branch.Upstream} -> ${Branch.Mirror}`);
	runGit(RepoPath, [
		"fetch",
		"upstream",
		Branch.Upstream
	], {}, 5, Logger);
	try {
		runGit(RepoPath, [
			"fetch",
			"origin",
			Branch.Mirror
		], {}, 5, Logger);
	} catch {}
	const beforeSha = getRefSha(RepoPath, `origin/${Branch.Mirror}`);
	const afterSha = runGitText(RepoPath, ["rev-parse", `upstream/${Branch.Upstream}`]).trim();
	if (!mirrorBranchNeedsUpdate(beforeSha, afterSha)) {
		Logger.write(`No upstream changes for ${Branch.Mirror}.`);
		return {
			Upstream: Branch.Upstream,
			Mirror: Branch.Mirror,
			BeforeSha: beforeSha,
			AfterSha: afterSha,
			Advanced: false
		};
	}
	Logger.write(`Advanced ${Branch.Mirror} from ${beforeSha ?? "<none>"} to ${afterSha}`);
	runGit(RepoPath, [
		"push",
		"--force",
		"origin",
		`upstream/${Branch.Upstream}:refs/heads/${Branch.Mirror}`
	], {}, 5, Logger);
	return {
		Upstream: Branch.Upstream,
		Mirror: Branch.Mirror,
		BeforeSha: beforeSha,
		AfterSha: afterSha,
		Advanced: true
	};
}
function runMirrorSync(input) {
	validateMirrorSyncConfig(input.Config);
	ensureUpstreamRemote(input.RepoPath, input.Config.UpstreamUrl);
	configureMirrorSyncPushTransport(input.RepoPath, input.Config, input.Logger);
	const branches = input.Config.Branches.map((branch) => syncMirrorBranch({
		RepoPath: input.RepoPath,
		Branch: branch,
		Logger: input.Logger
	}));
	const advancedBranches = branches.filter((branch) => branch.Advanced);
	if (input.Config.SyncTags ?? true) {
		input.Logger.write("Syncing tags from upstream");
		runGit(input.RepoPath, [
			"fetch",
			"upstream",
			"--tags"
		], {}, 5, input.Logger);
		try {
			runGit(input.RepoPath, [
				"push",
				"origin",
				"--tags"
			], {}, 5, input.Logger);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			input.Logger.write(`Tag push failed: ${message}`, "Warn");
		}
	}
	const primary = advancedBranches[0] ?? null;
	const notify = getMirrorSyncNotify(input.Config);
	const advanced = advancedBranches.length > 0;
	return {
		Advanced: advanced,
		PrimarySha: primary?.AfterSha ?? null,
		PrimaryRef: primary ? `refs/heads/${primary.Mirror}` : null,
		Notify: notify,
		Branches: branches,
		DispatchMirrorMerge: advanced && notify.Enabled
	};
}
function writeGitHubOutput(path, result) {
	const lines = [`advanced=${result.Advanced ? "true" : "false"}`];
	if (result.Advanced && result.PrimarySha && result.PrimaryRef) {
		lines.push(`sha=${result.PrimarySha}`);
		lines.push(`ref=${result.PrimaryRef}`);
	}
	lines.push(`notify=${result.Notify.Enabled ? "true" : "false"}`);
	lines.push(`dispatch_mirror_merge=${result.DispatchMirrorMerge ? "true" : "false"}`);
	if (result.Notify.Enabled) {
		lines.push(`notify_repository=${result.Notify.Repository ?? ""}`);
		lines.push(`notify_event_type=${result.Notify.EventType ?? ""}`);
	}
	appendFileSync(path, `${lines.join("\n")}\n`, "utf8");
}
function readStringOption(args, name) {
	const index = args.indexOf(name);
	if (index < 0) return;
	const value = args[index + 1];
	if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}`);
	return value;
}
function createMirrorSyncLogger() {
	return {
		write(message, level = "Info") {
			console.log(`${level === "Warn" ? "[mirror-sync][warn]" : level === "Error" ? "[mirror-sync][error]" : "[mirror-sync]"} ${message}`);
		},
		close() {}
	};
}
function runMirrorSyncCli() {
	process.env.LANG = "C.UTF-8";
	process.env.LC_ALL = "C.UTF-8";
	const args = process.argv.slice(2);
	verifyMirrorSyncEventType(readStringOption(args, "--event-type"));
	const repoPath = resolve(readStringOption(args, "--repo-path") ?? process.cwd());
	const configPath = resolve(readStringOption(args, "--config") ?? `${repoPath}/.github/mirror-sync.json`);
	const logger = createMirrorSyncLogger();
	try {
		const result = runMirrorSync({
			RepoPath: repoPath,
			Config: loadMirrorSyncConfig(configPath),
			Logger: logger
		});
		const mirrorMergeBusy = result.Notify.Enabled ? mirrorMergeBusyOnNotifyTarget(result.Notify) : null;
		const dispatchMirrorMerge = resolveDispatchMirrorMerge(result, { MirrorMergeBusy: mirrorMergeBusy });
		if (shouldDispatchMirrorMerge(result) && mirrorMergeBusy === true) logger.write(`Skip mirror-merge dispatch: run already active on ${result.Notify.Repository ?? "<unknown>"}`);
		if (shouldDispatchMirrorMerge(result) && mirrorMergeBusy === null) logger.write("mirror-merge busy check failed; dispatching anyway", "Warn");
		const outputResult = {
			...result,
			DispatchMirrorMerge: dispatchMirrorMerge
		};
		if (process.env.GITHUB_OUTPUT) writeGitHubOutput(process.env.GITHUB_OUTPUT, outputResult);
		logger.write(`done. advanced=${result.Advanced} dispatch_mirror_merge=${dispatchMirrorMerge}`);
	} catch (error) {
		logger.write(error instanceof Error ? error.message : String(error), "Error");
		process.exitCode = 1;
	} finally {
		logger.close();
	}
}
//#endregion
//#region src/mirror-sync/cli.ts
runMirrorSyncCli();
//#endregion
