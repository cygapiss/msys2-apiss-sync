import { dirname, isAbsolute, join } from "node:path";
import { performance } from "node:perf_hooks";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
//#region src/mirror-merge/args.ts
function readFlag(args, name) {
	return args.includes(name);
}
function wantsHelp(args) {
	return args.includes("--help") || args.includes("-h");
}
function printMirrorMergeCliHelp(defaultDestinationPath) {
	console.log(`Usage: yarn mirror-merge [options]

Options:
  --clean                   Reset destination sync branches before replay
  --dry-run                 Preview queue without replay commits or push
  --push                    Push destination branches after replay
  --skip-fetch              Skip mirror and destination fetch
  --max-commits <n>         Limit replay to n queue entries (0 = no limit)
  --destination-path <path> Existing destination git clone (must exist)
                            Omit to use ${defaultDestinationPath} (cloned if missing)
  --log-file <path>         Write log to file
  --log-append              Append to log file
  --log-to-console          Also print log lines to stdout
  -h, --help                Show this help
`);
}
function readStringOption(args, name) {
	const index = args.indexOf(name);
	if (index < 0) return;
	const value = args[index + 1];
	if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}`);
	return value;
}
function readIntOption(args, name, fallback = 0) {
	const value = readStringOption(args, name);
	if (value === void 0) return fallback;
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed)) throw new Error(`Invalid integer for ${name}: ${value}`);
	return parsed;
}
//#endregion
//#region src/types/constants.ts
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
//#region src/mirror-merge/config.ts
function getSyncRepoRoot(startPath = dirname(fileURLToPath(import.meta.url))) {
	let current = startPath;
	while (true) try {
		readFileSync(join(current, MIRROR_MERGE_CONFIG_PATH), "utf8");
		return current;
	} catch {
		const parent = dirname(current);
		if (parent === current) throw new Error(`Could not locate sync repo root (${MIRROR_MERGE_CONFIG_PATH} not found).`);
		current = parent;
	}
}
function loadSyncConfig(repoRoot = getSyncRepoRoot(), configPath) {
	const path = configPath ?? join(repoRoot, "config/mirror-merge.json");
	return JSON.parse(readFileSync(path, "utf8"));
}
function getDestinationCloneUrl(config) {
	return config.Destination.Url ?? `https://github.com/${config.Owner}/${config.Destination.Repo}.git`;
}
function getMirrorCloneUrlForSource(config, source) {
	return `https://github.com/${config.Owner}/${source.Repo}.git`;
}
function getSourceConfigEntry(config, sourceId) {
	const normalized = sourceId.trim().toLowerCase();
	for (const entry of config.Sources) if (entry.SortKey === sourceId || entry.SortKey === normalized || entry.Repo === sourceId || entry.Repo.toLowerCase() === normalized || entry.UpstreamRepo.toLowerCase() === normalized || `${config.Owner}/${entry.Repo}`.toLowerCase() === normalized) return entry;
	throw new Error(`Unknown source: ${sourceId}`);
}
//#endregion
//#region src/mirror-merge/log.ts
var FIBONACCI_PROGRESS_UP_TO_100 = /* @__PURE__ */ new Set([
	1,
	2,
	3,
	5,
	8,
	13,
	21,
	34,
	55,
	89
]);
/** Log at fibonacci indices for the first 100 entries, then every 100; always log at total. */
function shouldLogQueueProgress(processed, total) {
	if (processed <= 0) return false;
	if (total !== void 0 && processed === total) return true;
	if (processed <= 100) return FIBONACCI_PROGRESS_UP_TO_100.has(processed) || processed === 100;
	return processed % 100 === 0;
}
function getWorkDirectory(repoRoot) {
	const work = join(repoRoot, ".work");
	mkdirSync(work, { recursive: true });
	return work;
}
function setMirrorMergeUtf8Environment() {
	process.env.LANG = "C.UTF-8";
	process.env.LC_ALL = "C.UTF-8";
}
function createMirrorMergeLogger(repoRoot, options = {}) {
	const quietConsole = Boolean(options.logFile) && !options.logToConsole;
	let fd;
	if (options.logFile) {
		const path = isAbsolute(options.logFile) ? options.logFile : join(repoRoot, options.logFile);
		mkdirSync(dirname(path), { recursive: true });
		fd = openSync(path, options.append ? "a" : "w");
	}
	return {
		write(message, level = "Info") {
			const line = `${level === "Warn" ? "[mirror-merge][warn]" : level === "Error" ? "[mirror-merge][error]" : "[mirror-merge]"} ${message}`;
			if (!quietConsole || level !== "Info") console.log(line);
			if (fd !== void 0) writeSync(fd, `${line}\n`, void 0, "utf8");
		},
		close() {
			if (fd !== void 0) {
				closeSync(fd);
				fd = void 0;
			}
		}
	};
}
function convertToUnixLineEndings(text) {
	return (text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}
function splitCommitMessage(message) {
	const normalized = convertToUnixLineEndings(message).replace(/\n+$/g, "");
	if (!normalized) return {
		Subject: "",
		Body: ""
	};
	const lines = normalized.split("\n");
	const subject = lines[0] ?? "";
	if (lines.length === 1) return {
		Subject: subject,
		Body: ""
	};
	const bodyStart = lines[1] === "" ? 2 : 1;
	return {
		Subject: subject,
		Body: bodyStart < lines.length ? lines.slice(bodyStart).join("\n").replace(/\s+$/g, "") : ""
	};
}
function writeJsonFile(path, value) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
//#endregion
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
function streamGitText(repoPath, gitArgs, env = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn("git", repoPath ? [
			"-C",
			repoPath,
			...gitArgs
		] : gitArgs, {
			env: {
				...process.env,
				...env
			},
			windowsHide: true
		});
		const stdout = [];
		const stderr = [];
		child.stdout.on("data", (chunk) => {
			stdout.push(chunk);
		});
		child.stderr.on("data", (chunk) => {
			stderr.push(chunk);
		});
		child.on("error", (error) => {
			reject(error);
		});
		child.on("close", (code) => {
			const stdoutText = Buffer.concat(stdout).toString("utf8");
			const stderrText = Buffer.concat(stderr).toString("utf8");
			if (code === 0) {
				resolve(stdoutText || stderrText);
				return;
			}
			const command = repoPath ? `git -C ${repoPath} ${gitArgs.join(" ")}` : `git ${gitArgs.join(" ")}`;
			const output = (stderrText || stdoutText).trim();
			reject(/* @__PURE__ */ new Error(`git command failed (${command}): ${output}`));
		});
	});
}
function runGitStdin(repoPath, gitArgs, inputText, env = {}, maxAttempts = 5, logger) {
	return runGitInternal(repoPath, gitArgs, inputText, env, maxAttempts, logger);
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
//#endregion
//#region src/mirror-merge/history.ts
function getUpstreamCommitLogMetadataFormat() {
	return "%H%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ce%x1f%ct%x1f%B%x1e";
}
function convertFromUpstreamCommitLogMetadataText(text) {
	const normalized = convertToUnixLineEndings(text).trim();
	if (!normalized) return [];
	const recordSep = String.fromCharCode(30);
	const fieldSep = String.fromCharCode(31);
	const entries = [];
	for (const rawRecord of normalized.split(recordSep)) {
		const record = rawRecord.trim();
		if (!record) continue;
		const parts = record.split(fieldSep);
		if (parts.length < 8) {
			const preview = record.slice(0, 120);
			throw new Error(`Invalid upstream commit log record (expected 8 fields, got ${parts.length}): ${preview}`);
		}
		const split = splitCommitMessage(parts.slice(7).join(fieldSep).replace(/\n+$/g, ""));
		entries.push({
			Sha: parts[0],
			AuthorDateUnix: Number(parts[3]),
			CommitterDateUnix: Number(parts[6]),
			AuthorName: parts[1],
			AuthorEmail: parts[2],
			CommitterName: parts[4],
			CommitterEmail: parts[5],
			Subject: split.Subject,
			Body: split.Body
		});
	}
	return entries;
}
async function exportUpstreamCommitLogRawText(mirrorPath, afterSha, untilSha, branch = "master") {
	const range = afterSha ? `${afterSha}..${untilSha}` : untilSha;
	return convertToUnixLineEndings(await streamGitText(mirrorPath, [
		"log",
		"--reverse",
		`--format=${getUpstreamCommitLogMetadataFormat()}`,
		range
	])).trim();
}
function getMirrorTipSha(mirrorPath, branch = "master") {
	try {
		return runGitText(mirrorPath, ["rev-parse", `origin/${branch}`]).trim();
	} catch {
		return runGitText(mirrorPath, ["rev-parse", branch]).trim();
	}
}
function resolveMirrorContentBranchRef(mirrorPath, branch) {
	const originRef = `origin/${branch}`;
	try {
		runGitText(mirrorPath, [
			"rev-parse",
			"--verify",
			originRef
		]);
		return originRef;
	} catch {
		return branch;
	}
}
function newReplayCommitEntry(sourceId, logEntry, config) {
	const sourceEntry = getSourceConfigEntry(config, sourceId);
	return {
		Sha: logEntry.Sha,
		SourceId: sourceEntry.SortKey,
		SortKey: sourceEntry.SortKey,
		DestSubdir: sourceEntry.DestSubdir,
		UpstreamRepo: sourceEntry.UpstreamRepo,
		CommitterDateUnix: logEntry.CommitterDateUnix,
		AuthorDateUnix: logEntry.AuthorDateUnix,
		AuthorName: logEntry.AuthorName,
		AuthorEmail: logEntry.AuthorEmail,
		CommitterName: logEntry.CommitterName,
		CommitterEmail: logEntry.CommitterEmail,
		Subject: logEntry.Subject,
		Body: logEntry.Body
	};
}
async function getSourceReplayHistory(sourceId, config, mirrorPath, afterSha, untilSha) {
	return convertFromUpstreamCommitLogMetadataText(await exportUpstreamCommitLogRawText(mirrorPath, afterSha, untilSha, getSourceConfigEntry(config, sourceId).Branch)).map((entry) => newReplayCommitEntry(sourceId, entry, config));
}
//#endregion
//#region src/mirror-merge/fork-safe.ts
function buildFirstParentSpine(parentMap, tipSha) {
	const spine = /* @__PURE__ */ new Set();
	let current = tipSha;
	while (current) {
		spine.add(current);
		const parents = parentMap.get(current);
		if (!parents || parents.length === 0) break;
		current = parents[0];
	}
	return spine;
}
function precomputeForkSafeFlagsForQueue(queueEntries, parentMap, tipSha, onProgress, progressInterval = 2e3) {
	const count = queueEntries.length;
	if (count === 0) return [];
	onProgress?.(0, count);
	const spine = buildFirstParentSpine(parentMap, tipSha ?? queueEntries[count - 1].Sha);
	const flags = new Array(count);
	for (let index = 0; index < count; index++) {
		flags[index] = spine.has(queueEntries[index].Sha);
		if (onProgress && (index % progressInterval === 0 || index === count - 1)) onProgress(index + 1, count);
	}
	onProgress?.(count, count);
	return flags;
}
//#endregion
//#region src/mirror-merge/queue.ts
var gitEmptyTree = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
function getFirstParentFromMap(parentMap, commit) {
	const parents = parentMap.get(commit);
	if (!parents || parents.length === 0) return gitEmptyTree;
	return parents[0];
}
function compareReplayRank(left, right) {
	if (left.CommitterDateUnix !== right.CommitterDateUnix) return Math.sign(left.CommitterDateUnix - right.CommitterDateUnix);
	if (left.AuthorDateUnix !== right.AuthorDateUnix) return Math.sign(left.AuthorDateUnix - right.AuthorDateUnix);
	if (left.SourceId !== right.SourceId) return left.SourceId < right.SourceId ? -1 : 1;
	if (left.Sha === right.Sha) return 0;
	return left.Sha < right.Sha ? -1 : 1;
}
function mergeTwoReplayCommitQueues(left, right) {
	const merged = [];
	let i = 0;
	let j = 0;
	while (i < left.length && j < right.length) if (compareReplayRank(left[i], right[j]) <= 0) {
		merged.push(left[i]);
		i++;
	} else {
		merged.push(right[j]);
		j++;
	}
	while (i < left.length) {
		merged.push(left[i]);
		i++;
	}
	while (j < right.length) {
		merged.push(right[j]);
		j++;
	}
	return merged;
}
function mergeReplayCommitQueues(...lists) {
	if (lists.length === 0) return [];
	let merged = lists[0];
	for (let index = 1; index < lists.length; index++) merged = mergeTwoReplayCommitQueues(merged, lists[index]);
	return merged;
}
function getReplayAgeCutoffUnix(config, nowUnix = Math.floor(Date.now() / 1e3)) {
	return nowUnix - (config.Replay.MinReplayAgeMinutes === void 0 || config.Replay.MinReplayAgeMinutes < 0 ? 5 : config.Replay.MinReplayAgeMinutes) * 60;
}
async function buildMirrorCommitParentMap(mirrorPath, branch = "master") {
	const raw = await streamGitText(mirrorPath, [
		"rev-list",
		"--parents",
		resolveMirrorContentBranchRef(mirrorPath, branch)
	]);
	const map = /* @__PURE__ */ new Map();
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const parts = trimmed.split(/\s+/);
		map.set(parts[0], parts.slice(1));
	}
	return map;
}
function precomputeSourceCursorBranchSafeFlags(queueEntries, parentMap, tipSha, onProgress, progressInterval = 2e3) {
	return precomputeForkSafeFlagsForQueue(queueEntries, parentMap, tipSha, onProgress, progressInterval);
}
function precomputeReplayCursorBranchSafeFlags(input) {
	const sourceIds = [...new Set(input.Queue.map((entry) => entry.SourceId))];
	const progressInterval = input.ProgressInterval ?? 2e3;
	const safeBySource = {};
	for (const sourceId of sourceIds) safeBySource[sourceId] = precomputeSourceCursorBranchSafeFlags(input.SourceEntries?.[sourceId] ?? input.Queue.filter((entry) => entry.SourceId === sourceId), input.ParentMaps[sourceId], void 0, input.OnSourceProgress ? (processed, total) => input.OnSourceProgress(sourceId, processed, total) : void 0, progressInterval);
	const indices = {};
	const cursorSafe = {};
	for (const sourceId of sourceIds) {
		indices[sourceId] = 0;
		cursorSafe[sourceId] = true;
	}
	const flags = new Array(input.Queue.length);
	for (let index = 0; index < input.Queue.length; index++) {
		const entry = input.Queue[index];
		cursorSafe[entry.SourceId] = safeBySource[entry.SourceId][indices[entry.SourceId]] ?? true;
		indices[entry.SourceId]++;
		flags[index] = sourceIds.every((sourceId) => cursorSafe[sourceId]);
	}
	return flags;
}
function filterReplayQueueByAge(queue, config, log, nowUnix = Math.floor(Date.now() / 1e3)) {
	const minutes = config.Replay.MinReplayAgeMinutes ?? 5;
	const cutoff = getReplayAgeCutoffUnix(config, nowUnix);
	const eligible = queue.filter((entry) => entry.CommitterDateUnix <= cutoff);
	const held = queue.length - eligible.length;
	if (held > 0) log(`Holding ${held} commit(s) with committer date within the last ${minutes} minute(s) to avoid timeline reorder.`);
	return eligible;
}
//#endregion
//#region src/mirror-merge/replay.ts
function formatReplayCommitMessage(input) {
	const body = convertToUnixLineEndings(input.Metadata.Body);
	const bodyBlock = body ? `\n\n${body}\n` : "\n";
	return convertToUnixLineEndings(input.Template.replaceAll("{SortKey}", input.SortKey).replaceAll("{Subject}", input.Metadata.Subject).replaceAll("{Body}", body).replaceAll("{BodyBlock}", bodyBlock).replaceAll("{UpstreamRepo}", input.UpstreamRepo).replaceAll("{UpstreamSha}", input.UpstreamSha));
}
function parseReplayCommitSourceSha(message, upstreamRepo) {
	const footer = `Source: ${upstreamRepo}@`;
	const index = message.lastIndexOf(footer);
	if (index < 0) return null;
	const sha = message.slice(index + footer.length, index + footer.length + 40);
	return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}
function getDiffTreeEntries(mirrorPath, parent, commit) {
	const raw = runGitText(mirrorPath, [
		"diff-tree",
		"-r",
		"-z",
		"-M",
		"--no-commit-id",
		parent,
		commit
	]);
	if (!raw) return [];
	const tokens = raw.split("\0").filter((token) => token.length > 0);
	const entries = [];
	let i = 0;
	while (i < tokens.length) {
		const token = tokens[i];
		const match = /^:(\d+) (\d+) ([0-9a-f]{40}) ([0-9a-f]{40}) (\S+)$/.exec(token);
		if (!match) {
			i++;
			continue;
		}
		const newMode = match[2];
		const newSha = match[4];
		const status = match[5];
		i++;
		if (/^R/.test(status)) {
			if (i + 1 >= tokens.length) throw new Error(`Unexpected diff-tree rename payload for commit ${commit}`);
			entries.push({
				Kind: "Delete",
				Path: tokens[i]
			});
			entries.push({
				Kind: "Update",
				Path: tokens[i + 1],
				Mode: newMode,
				Sha: newSha
			});
			i += 2;
			continue;
		}
		if (i >= tokens.length) throw new Error(`Unexpected diff-tree payload for commit ${commit}`);
		const path = tokens[i++];
		if (status === "D" || newMode === "000000") entries.push({
			Kind: "Delete",
			Path: path
		});
		else entries.push({
			Kind: "Update",
			Path: path,
			Mode: newMode,
			Sha: newSha
		});
	}
	return entries;
}
function applyUpstreamCommitToIndex(input) {
	const diffEntries = getDiffTreeEntries(input.MirrorPath, input.Parent, input.Commit);
	if (diffEntries.length === 0) return false;
	runGit(input.DestinationPath, ["read-tree", "HEAD"]);
	const indexLines = [];
	const removePaths = [];
	for (const entry of diffEntries) if (entry.Kind === "Delete") removePaths.push(`${input.DestSubdir}/${entry.Path}`);
	else indexLines.push(`${entry.Mode} ${entry.Sha}\t${input.DestSubdir}/${entry.Path}`);
	if (indexLines.length > 0) runGitStdin(input.DestinationPath, ["update-index", "--index-info"], `${indexLines.join("\n")}\n`);
	if (removePaths.length > 0) runGitStdin(input.DestinationPath, [
		"rm",
		"--cached",
		"-r",
		"-f",
		"--ignore-unmatch",
		"--pathspec-from-file=-"
	], `${removePaths.join("\n")}\n`);
	return runGitText(input.DestinationPath, [
		"diff",
		"--cached",
		"--name-only"
	]).trim().length > 0;
}
function testUpstreamCommitHasMappedChanges(mirrorPath, commit, parent) {
	return getDiffTreeEntries(mirrorPath, parent, commit).length > 0;
}
function formatGitReplayDateEnv(unixSeconds) {
	return `@${unixSeconds}`;
}
function newReplayCommit(destinationPath, entry, message) {
	runGitStdin(destinationPath, [
		"commit",
		"-F",
		"-"
	], message, {
		GIT_AUTHOR_NAME: entry.AuthorName,
		GIT_AUTHOR_EMAIL: entry.AuthorEmail,
		GIT_AUTHOR_DATE: formatGitReplayDateEnv(entry.AuthorDateUnix),
		GIT_COMMITTER_NAME: entry.CommitterName,
		GIT_COMMITTER_EMAIL: entry.CommitterEmail,
		GIT_COMMITTER_DATE: formatGitReplayDateEnv(entry.CommitterDateUnix)
	});
}
//#endregion
//#region src/mirror-merge/repos.ts
function mirrorGitObjectsPath(mirrorPath) {
	return join(realpathSync(mirrorPath), ".git", "objects");
}
function initializeMirrorRepository(input) {
	const mirrorRoot = join(input.WorkDirectory, "mirrors");
	mkdirSync(mirrorRoot, { recursive: true });
	const mirrorPath = join(mirrorRoot, input.Source.Repo);
	const url = getMirrorCloneUrlForSource(input.Config, input.Source);
	if (!existsSync(mirrorPath)) {
		input.Logger.write(`Cloning mirror ${input.Source.SortKey} to ${mirrorPath} (${url})`);
		runGit(null, [
			"clone",
			url,
			mirrorPath
		], {}, 5, input.Logger);
		setGitRepoUtf8Encoding(mirrorPath);
	} else if (!input.SkipFetch) {
		input.Logger.write(`Fetching mirror ${input.Source.SortKey} (${mirrorPath})`);
		runGit(mirrorPath, [
			"fetch",
			"origin",
			"--prune"
		], {}, 5, input.Logger);
	}
	setGitRepoUtf8Encoding(mirrorPath);
	return mirrorPath;
}
function initializeDestinationRepository(input) {
	if (input.DestinationPath) {
		const destPath = realpathSync(input.DestinationPath);
		if (!input.SkipFetch) {
			input.Logger.write(`Fetching destination (${destPath})`);
			runGit(destPath, [
				"fetch",
				"origin",
				"--prune"
			], {}, 5, input.Logger);
		}
		setGitRepoUtf8Encoding(destPath);
		return destPath;
	}
	const destRoot = join(input.WorkDirectory, "destination");
	mkdirSync(destRoot, { recursive: true });
	const destPath = join(destRoot, input.Config.Destination.Repo);
	const url = getDestinationCloneUrl(input.Config);
	if (!existsSync(destPath)) {
		input.Logger.write(`Cloning destination to ${destPath} (${url})`);
		runGit(null, [
			"clone",
			url,
			destPath
		], {}, 5, input.Logger);
		setGitRepoUtf8Encoding(destPath);
	} else if (!input.SkipFetch) {
		input.Logger.write(`Fetching destination (${destPath})`);
		runGit(destPath, [
			"fetch",
			"origin",
			"--prune"
		], {}, 5, input.Logger);
	}
	setGitRepoUtf8Encoding(destPath);
	return destPath;
}
function setGitRepoUtf8Encoding(repoPath) {
	for (const [key, value] of [
		["i18n.logOutputEncoding", "utf-8"],
		["i18n.commitEncoding", "utf-8"],
		["core.quotepath", "false"]
	]) runGit(repoPath, [
		"config",
		key,
		value
	]);
}
function initializeDestinationAlternates(destinationPath, mirrorPaths) {
	const alternatesDir = join(destinationPath, ".git", "objects", "info");
	mkdirSync(alternatesDir, { recursive: true });
	const normalized = mirrorPaths.map((mirrorPath) => mirrorGitObjectsPath(mirrorPath)).filter((objectsPath) => existsSync(objectsPath)).map((objectsPath) => objectsPath.replace(/\\/g, "/"));
	writeFileSync(join(alternatesDir, "alternates"), `${normalized.join("\n")}\n`, "utf8");
}
function ensureDestinationBaseCommit(destinationPath, config, logger) {
	const base = config.Destination.BaseCommit;
	try {
		runGit(destinationPath, [
			"cat-file",
			"-e",
			`${base}^{commit}`
		]);
		return;
	} catch {
		logger.write("Base commit not in clone; fetching from origin", "Warn");
	}
	runGit(destinationPath, [
		"fetch",
		"origin",
		base
	], {}, 5, logger);
	runGit(destinationPath, [
		"cat-file",
		"-e",
		`${base}^{commit}`
	]);
}
function prepareDestinationWorkingTree(destinationPath) {
	runGit(destinationPath, ["clean", "-fd"]);
}
function checkoutDestinationReplayBranch(destinationPath, branchName, sha) {
	prepareDestinationWorkingTree(destinationPath);
	runGit(destinationPath, [
		"checkout",
		"-f",
		"-B",
		branchName,
		sha
	]);
	runGit(destinationPath, [
		"reset",
		"--hard",
		"HEAD"
	]);
}
function setDestinationReplayCheckout(destinationPath, config, isFullReplay) {
	const replayBranch = config.Destination.ReplayTip;
	if (isFullReplay) {
		checkoutDestinationReplayBranch(destinationPath, replayBranch, config.Destination.BaseCommit);
		return;
	}
	const replayTipSha = getDestinationBranchSha(destinationPath, replayBranch);
	if (!replayTipSha) throw new Error(`Missing destination branch origin/${replayBranch}`);
	checkoutDestinationReplayBranch(destinationPath, replayBranch, replayTipSha);
}
function getDestinationBranchSha(destinationPath, branchName) {
	try {
		return runGitText(destinationPath, ["rev-parse", `origin/${branchName}`]).trim();
	} catch {
		return null;
	}
}
function getLocalDestinationBranchSha(destinationPath, branchName) {
	try {
		return runGitText(destinationPath, ["rev-parse", branchName]).trim();
	} catch {
		return null;
	}
}
function testAllSyncBranchesExist(destinationPath, config) {
	if (!getDestinationBranchSha(destinationPath, config.Destination.ReplayTip)) return false;
	for (const source of config.Sources) if (!getDestinationBranchSha(destinationPath, source.CursorBranch)) return false;
	return true;
}
function setDestinationBranchSha(destinationPath, branchName, sha) {
	let currentBranch = null;
	try {
		currentBranch = runGitText(destinationPath, [
			"symbolic-ref",
			"--short",
			"HEAD"
		]).trim();
	} catch {}
	if (currentBranch === branchName) {
		if (runGitText(destinationPath, ["rev-parse", "HEAD"]).trim() !== sha) runGit(destinationPath, [
			"reset",
			"--hard",
			sha
		]);
		return;
	}
	runGit(destinationPath, [
		"branch",
		"-f",
		branchName,
		sha
	]);
}
function updateDestinationCursorBranchRefs(destinationPath, config, updates) {
	for (const source of config.Sources) {
		const sha = updates[source.SortKey];
		if (sha) setDestinationBranchSha(destinationPath, source.CursorBranch, sha);
	}
}
function updateDestinationSyncBranchRefs(destinationPath, config, input) {
	setDestinationBranchSha(destinationPath, config.Destination.ReplayTip, input.ReplayTipSha);
	updateDestinationCursorBranchRefs(destinationPath, config, input.CursorDestShas);
}
function resolveUpstreamCursorSha(destinationPath, cursorDestSha, upstreamRepo) {
	return parseReplayCommitSourceSha(runGitText(destinationPath, [
		"log",
		"-1",
		"--format=%B",
		cursorDestSha
	]), upstreamRepo);
}
function resolveSyncRetrieveCursorsFromBranches(destinationPath, config) {
	const cursors = {};
	for (const source of config.Sources) {
		const destSha = getDestinationBranchSha(destinationPath, source.CursorBranch);
		cursors[source.SortKey] = {
			DestSha: destSha,
			UpstreamSha: destSha ? resolveUpstreamCursorSha(destinationPath, destSha, source.UpstreamRepo) : null
		};
	}
	return cursors;
}
function advanceSyncCursorDestShasIfSafe(input) {
	const result = { ...input.LastDestShas };
	if (!input.CursorBranchSafe) return result;
	result[input.SourceId] = input.ReplayTipSha;
	return result;
}
function clearDestinationSyncBranches(destinationPath, config, logger) {
	const base = config.Destination.BaseCommit;
	const replayBranch = config.Destination.ReplayTip;
	try {
		runGit(destinationPath, [
			"cat-file",
			"-e",
			`${base}^{commit}`
		]);
		checkoutDestinationReplayBranch(destinationPath, replayBranch, base);
	} catch {
		logger.write(`Base commit not in clone; deleting replay branch ${replayBranch}`, "Warn");
		try {
			runGit(destinationPath, [
				"branch",
				"-D",
				replayBranch
			]);
		} catch {}
	}
	for (const source of config.Sources) {
		try {
			runGit(destinationPath, [
				"branch",
				"-D",
				source.CursorBranch
			]);
		} catch {}
		try {
			runGit(destinationPath, [
				"update-ref",
				"-d",
				`refs/remotes/origin/${source.CursorBranch}`
			]);
		} catch {}
	}
	try {
		runGit(destinationPath, [
			"update-ref",
			"-d",
			`refs/remotes/origin/${replayBranch}`
		]);
	} catch {}
}
function pushDestinationBranches(destinationPath, config, forceReplayBranch) {
	const replayBranch = config.Destination.ReplayTip;
	runGit(destinationPath, [
		"push",
		"origin",
		...forceReplayBranch ? ["--force"] : [],
		replayBranch
	]);
	for (const source of config.Sources) if (getLocalDestinationBranchSha(destinationPath, source.CursorBranch)) runGit(destinationPath, [
		"push",
		"origin",
		source.CursorBranch
	]);
	else runGit(destinationPath, [
		"push",
		"origin",
		"--delete",
		source.CursorBranch
	]);
}
//#endregion
//#region src/mirror-merge/replay-graph.ts
function serializeCommitParentMap(branch, tipSha, parentMap) {
	const parents = [];
	for (const [sha, parentList] of parentMap) parents.push([sha, [...parentList]]);
	return {
		Branch: branch,
		TipSha: tipSha,
		Parents: parents
	};
}
function deserializeCommitParentMap(serialized) {
	const parentMap = /* @__PURE__ */ new Map();
	for (const [sha, parentList] of serialized.Parents) parentMap.set(sha, parentList);
	return parentMap;
}
function getMirrorParentGraphCachePath(cacheDir, sourceKey, branch, tipSha) {
	return join(cacheDir, `parent-map-${sourceKey}-${branch}-${tipSha}.json`);
}
function saveMirrorParentGraph(cachePath, branch, tipSha, parentMap) {
	writeJsonFile(cachePath, serializeCommitParentMap(branch, tipSha, parentMap));
}
function loadMirrorParentGraph(cachePath) {
	if (!existsSync(cachePath)) return null;
	return deserializeCommitParentMap(JSON.parse(readFileSync(cachePath, "utf8")));
}
async function loadOrBuildMirrorCommitParentMap(input) {
	const cached = loadMirrorParentGraph(input.CachePath);
	if (cached) return cached;
	const parentMap = await input.Build();
	saveMirrorParentGraph(input.CachePath, input.Branch, input.TipSha, parentMap);
	return parentMap;
}
//#endregion
//#region src/mirror-merge/index.ts
function resolveMirrorMergeMode(input) {
	return input.Clean || !input.AllSyncBranchesExist ? "bootstrap" : "incremental";
}
function formatMirrorMergeCursorSummary(config, upstreamCursors) {
	return config.Sources.map((source) => `${source.SortKey}=${(upstreamCursors[source.SortKey] ?? "none").slice(0, 8)}`).join(" ");
}
async function runMirrorMerge(input) {
	const clean = Boolean(input.Clean);
	const dryRun = Boolean(input.DryRun);
	const push = Boolean(input.Push);
	const skipFetch = Boolean(input.SkipFetch);
	const maxCommits = input.MaxCommits ?? 0;
	const config = input.Config;
	const logger = input.Logger;
	const replayBranch = config.Destination.ReplayTip;
	logger.write(`Mirror-Merge start (clean=${clean} dryRun=${dryRun} push=${push} skipFetch=${skipFetch})`);
	const mirrorPaths = /* @__PURE__ */ new Map();
	for (const source of config.Sources) mirrorPaths.set(source.SortKey, initializeMirrorRepository({
		WorkDirectory: input.WorkDirectory,
		Source: source,
		Config: config,
		SkipFetch: skipFetch,
		Logger: logger
	}));
	const destPath = initializeDestinationRepository({
		WorkDirectory: input.WorkDirectory,
		Config: config,
		DestinationPath: input.DestinationPath,
		SkipFetch: skipFetch,
		Logger: logger
	});
	for (const source of config.Sources) logger.write(`Mirror ${source.SortKey}: ${mirrorPaths.get(source.SortKey)}`);
	logger.write(`Destination: ${destPath}`);
	initializeDestinationAlternates(destPath, [...mirrorPaths.values()]);
	ensureDestinationBaseCommit(destPath, config, logger);
	if (clean) {
		logger.write("Clean: resetting destination sync branches");
		clearDestinationSyncBranches(destPath, config, logger);
	}
	const lastDestShas = Object.fromEntries(config.Sources.map((source) => [source.SortKey, null]));
	const upstreamCursors = Object.fromEntries(config.Sources.map((source) => [source.SortKey, null]));
	if (!clean) {
		const retrieveCursors = resolveSyncRetrieveCursorsFromBranches(destPath, config);
		for (const source of config.Sources) {
			lastDestShas[source.SortKey] = retrieveCursors[source.SortKey]?.DestSha ?? null;
			upstreamCursors[source.SortKey] = retrieveCursors[source.SortKey]?.UpstreamSha ?? null;
		}
	}
	const isFullReplay = resolveMirrorMergeMode({
		Clean: clean,
		AllSyncBranchesExist: !clean && testAllSyncBranchesExist(destPath, config)
	}) === "bootstrap";
	if (isFullReplay) logger.write("Bootstrap: full replay (no age gate)");
	else logger.write(`Incremental: cursors ${formatMirrorMergeCursorSummary(config, upstreamCursors)}`);
	if (!dryRun) if (clean || isFullReplay) setDestinationReplayCheckout(destPath, config, true);
	else {
		const replayTipSha = getDestinationBranchSha(destPath, replayBranch);
		if (!replayTipSha) throw new Error(`Missing destination branch origin/${replayBranch}`);
		checkoutDestinationReplayBranch(destPath, replayBranch, replayTipSha);
	}
	else setDestinationReplayCheckout(destPath, config, isFullReplay);
	const historyLists = await Promise.all(config.Sources.map(async (source) => {
		const mirrorPath = mirrorPaths.get(source.SortKey);
		const tip = getMirrorTipSha(mirrorPath, source.Branch);
		return getSourceReplayHistory(source.SortKey, config, mirrorPath, upstreamCursors[source.SortKey], tip);
	}));
	let queue = mergeReplayCommitQueues(...historyLists);
	const historyCounts = Object.fromEntries(config.Sources.map((source, index) => [source.SortKey, historyLists[index].length]));
	logger.write(`Retrieved ${config.Sources.map((source) => `${source.SortKey}=${historyCounts[source.SortKey]}`).join(" ")} merged=${queue.length}`);
	if (!isFullReplay) {
		queue = filterReplayQueueByAge(queue, config, (message) => logger.write(message));
		logger.write(`After age gate: ${queue.length} commit(s)`);
	}
	if (queue.length === 0) {
		logger.write("No commits to replay.");
		return {
			Status: "no-commits",
			Processed: 0,
			Replayed: 0
		};
	}
	if (maxCommits > 0 && queue.length > maxCommits) {
		queue = queue.slice(0, maxCommits);
		logger.write(`Throttled to MaxCommits=${maxCommits}`);
	}
	const graphCacheDir = join(input.WorkDirectory, "cache", "replay-graph");
	const parentMaps = {};
	await Promise.all(config.Sources.map(async (source) => {
		const mirrorPath = mirrorPaths.get(source.SortKey);
		const tip = getMirrorTipSha(mirrorPath, source.Branch);
		parentMaps[source.SortKey] = await loadOrBuildMirrorCommitParentMap({
			CachePath: getMirrorParentGraphCachePath(graphCacheDir, source.SortKey, source.Branch, tip),
			Branch: source.Branch,
			TipSha: tip,
			Build: () => buildMirrorCommitParentMap(mirrorPath, source.Branch)
		});
	}));
	const sourceEntries = Object.fromEntries(config.Sources.map((source, index) => [source.SortKey, historyLists[index]]));
	const precomputeStart = performance.now();
	let lastPrecomputeReport = -1;
	const cursorBranchSafeFlags = precomputeReplayCursorBranchSafeFlags({
		Queue: queue,
		ParentMaps: parentMaps,
		SourceEntries: sourceEntries,
		OnSourceProgress: (sourceId, processed, total) => {
			if (processed === 0) {
				logger.write(`Precompute fork-safe flags ${sourceId}: start (${total} entries)`);
				return;
			}
			const pct = Math.round(processed / total * 100);
			if (processed === total || processed - lastPrecomputeReport >= 5e3) {
				logger.write(`Precompute fork-safe flags ${sourceId}: ${processed}/${total} (${pct}%) +${Math.round(performance.now() - precomputeStart)}ms`);
				lastPrecomputeReport = processed;
			}
		},
		ProgressInterval: 5e3
	});
	logger.write("Precomputed fork-safe cursor branch flags");
	let replayed = 0;
	const skipEmpty = Boolean(config.Replay.SkipEmptyTreeDiff);
	for (let index = 0; index < queue.length; index++) {
		const entry = queue[index];
		const mirrorPath = mirrorPaths.get(entry.SourceId);
		const parentMap = parentMaps[entry.SourceId];
		if (!mirrorPath || !parentMap) throw new Error(`Unknown SourceId on queue entry: ${entry.SourceId}`);
		const parent = getFirstParentFromMap(parentMap, entry.Sha);
		const message = formatReplayCommitMessage({
			Template: getSourceConfigEntry(config, entry.SourceId).CommitMessage,
			SortKey: entry.SortKey,
			Metadata: entry,
			UpstreamRepo: entry.UpstreamRepo,
			UpstreamSha: entry.Sha
		});
		let entryReplayed = false;
		if (dryRun) if (!testUpstreamCommitHasMappedChanges(mirrorPath, entry.Sha, parent) && skipEmpty) logger.write(`[${entry.SourceId}] skip empty diff ${entry.Sha.slice(0, 8)} ${entry.Subject}`);
		else logger.write(`[${entry.SourceId}] dry-run would replay ${entry.Sha.slice(0, 8)} ${entry.Subject}`);
		else if (!applyUpstreamCommitToIndex({
			MirrorPath: mirrorPath,
			Commit: entry.Sha,
			Parent: parent,
			DestSubdir: entry.DestSubdir,
			DestinationPath: destPath
		}) && skipEmpty) logger.write(`[${entry.SourceId}] skip empty diff ${entry.Sha.slice(0, 8)} ${entry.Subject}`);
		else {
			newReplayCommit(destPath, entry, message);
			runGit(destPath, [
				"reset",
				"--hard",
				"HEAD"
			]);
			replayed++;
			entryReplayed = true;
		}
		if (!dryRun && entryReplayed) {
			const cursorBranchSafe = cursorBranchSafeFlags[index] ?? false;
			if (cursorBranchSafe) {
				const replayTipSha = runGitText(destPath, ["rev-parse", "HEAD"]).trim();
				const previousDestShas = { ...lastDestShas };
				const nextDestShas = advanceSyncCursorDestShasIfSafe({
					SourceId: entry.SourceId,
					ReplayTipSha: replayTipSha,
					CursorBranchSafe: cursorBranchSafe,
					LastDestShas: lastDestShas
				});
				const updates = {};
				for (const source of config.Sources) {
					const nextSha = nextDestShas[source.SortKey];
					if (nextSha !== previousDestShas[source.SortKey]) {
						updates[source.SortKey] = nextSha;
						lastDestShas[source.SortKey] = nextSha;
					}
				}
				if (Object.keys(updates).length > 0) updateDestinationCursorBranchRefs(destPath, config, updates);
			}
		}
		if (shouldLogQueueProgress(index + 1, queue.length)) {
			const processed = index + 1;
			const remaining = queue.length - processed;
			logger.write(`Progress: ${processed}/${queue.length} (${replayed} replayed, ${remaining} remaining)`);
		}
	}
	if (dryRun) {
		logger.write(`Dry run complete; processed ${queue.length} queue entry(ies).`);
		return {
			Status: "dry-run",
			Processed: queue.length,
			Replayed: 0
		};
	}
	if (replayed > 0) runGit(destPath, [
		"reset",
		"--hard",
		"HEAD"
	]);
	const replayTip = runGitText(destPath, ["rev-parse", "HEAD"]).trim();
	updateDestinationSyncBranchRefs(destPath, config, {
		ReplayTipSha: replayTip,
		CursorDestShas: lastDestShas
	});
	logger.write(`Replayed ${replayed} commit(s); tip=${replayTip.slice(0, 8)}`);
	if (push) {
		logger.write("Pushing destination branches");
		pushDestinationBranches(destPath, config, clean || isFullReplay);
	} else logger.write("Skipping push (pass --push to publish destination branches)");
	logger.write("Mirror-Merge done.");
	return {
		Status: "done",
		Processed: queue.length,
		Replayed: replayed,
		TipSha: replayTip
	};
}
async function runMirrorMergeCli() {
	setMirrorMergeUtf8Environment();
	const args = process.argv.slice(2);
	const repoRoot = getSyncRepoRoot();
	const config = loadSyncConfig(repoRoot);
	const defaultDestinationPath = join(".work", "destination", config.Destination.Repo);
	if (wantsHelp(args)) {
		printMirrorMergeCliHelp(defaultDestinationPath);
		return;
	}
	const logger = createMirrorMergeLogger(repoRoot, {
		logFile: readStringOption(args, "--log-file"),
		append: readFlag(args, "--log-append"),
		logToConsole: readFlag(args, "--log-to-console")
	});
	try {
		await runMirrorMerge({
			RepoRoot: repoRoot,
			WorkDirectory: getWorkDirectory(repoRoot),
			Config: config,
			Logger: logger,
			Clean: readFlag(args, "--clean"),
			DryRun: readFlag(args, "--dry-run"),
			Push: readFlag(args, "--push"),
			SkipFetch: readFlag(args, "--skip-fetch"),
			MaxCommits: readIntOption(args, "--max-commits", 0),
			DestinationPath: readStringOption(args, "--destination-path")
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.write(message, "Error");
		logger.write("Re-run without --clean to continue from branch cursors.", "Warn");
		process.exitCode = 1;
	} finally {
		logger.close();
	}
}
//#endregion
//#region src/mirror-merge/cli.ts
runMirrorMergeCli();
//#endregion
