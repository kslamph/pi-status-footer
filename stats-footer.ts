/** Compact, responsive status footer for pi. */

import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";

type UsageTotals = Pick<
	Usage,
	"input" | "output" | "cacheRead" | "cacheWrite"
> & {
	cost: number;
};

type RenderTui = { requestRender(force?: boolean): void };

const THINKING_THEME_COLOR = {
	off: "thinkingOff",
	minimal: "thinkingMinimal",
	low: "thinkingLow",
	medium: "thinkingMedium",
	high: "thinkingHigh",
	xhigh: "thinkingXhigh",
	max: "thinkingMax",
} as const;

export function formatTokens(count: number): string {
	if (count < 1_000) return String(count);
	if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
	if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	return `${Math.round(count / 1_000_000)}M`;
}

export function formatDuration(ms: number): string {
	const totalSeconds = Math.max(0, Math.floor(ms / 1_000));
	const hours = Math.floor(totalSeconds / 3_600);
	const minutes = Math.floor((totalSeconds % 3_600) / 60);
	const seconds = totalSeconds % 60;
	const pad = (n: number): string => String(n).padStart(2, "0");
	// Clock style: 1:02:03 = 1h 2m 3s; below one hour M:SS, e.g. 2:01.
	if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
	return `${minutes}:${pad(seconds)}`;
}

/**
 * Output tokens per second for an assistant message generation window.
 * Returns null when too little time has elapsed for a meaningful rate.
 */
export function computeTps(
	outputTokens: number,
	startMs: number,
	nowMs = Date.now(),
): number | null {
	const elapsedSec = (nowMs - startMs) / 1000;
	if (elapsedSec < 0.25) return null;
	return outputTokens / elapsedSec;
}

function emptyUsageTotals(): UsageTotals {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
}

function addUsage(totals: UsageTotals, usage: Usage | undefined): void {
	if (!usage) return;
	totals.input += usage.input;
	totals.output += usage.output;
	totals.cacheRead += usage.cacheRead;
	totals.cacheWrite += usage.cacheWrite;
	totals.cost += usage.cost.total;
}

export function collectSessionStats(entries: readonly SessionEntry[]): {
	usage: UsageTotals;
} {
	const usage = emptyUsageTotals();

	for (const entry of entries) {
		if (entry.type === "message" && entry.message.role === "assistant") {
			const message = entry.message as AssistantMessage;
			addUsage(usage, message.usage);
			continue;
		}
		if (entry.type === "message" && entry.message.role === "toolResult") {
			addUsage(usage, entry.message.usage);
			continue;
		}
		if (entry.type === "branch_summary" || entry.type === "compaction") {
			addUsage(usage, entry.usage);
		}
	}

	return { usage };
}

export function calculateCacheHitRate(usage: UsageTotals): number | null {
	const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
	return promptTokens > 0 ? (usage.cacheRead / promptTokens) * 100 : null;
}

/**
 * East Asian Ambiguous code point ranges (inclusive [start, end] pairs),
 * flat. Derived from the Unicode EastAsianWidth=A property (same data set
 * used by get-east-asian-width). Many CJK terminals and fonts render these
 * as double-width while wcwidth-style helpers count them as 1 column.
 */
const AMBIGUOUS_RANGES: readonly number[] = [
	161, 161, 164, 164, 167, 168, 170, 170, 173, 174, 176, 180,
	182, 186, 188, 191, 198, 198, 208, 208, 215, 216, 222, 225,
	230, 230, 232, 234, 236, 237, 240, 240, 242, 243, 247, 250,
	252, 252, 254, 254, 257, 257, 273, 273, 275, 275, 283, 283,
	294, 295, 299, 299, 305, 307, 312, 312, 319, 322, 324, 324,
	328, 331, 333, 333, 338, 339, 358, 359, 363, 363, 462, 462,
	464, 464, 466, 466, 468, 468, 470, 470, 472, 472, 474, 474,
	476, 476, 593, 593, 609, 609, 708, 708, 711, 711, 713, 715,
	717, 717, 720, 720, 728, 731, 733, 733, 735, 735, 768, 879,
	913, 929, 931, 937, 945, 961, 963, 969, 1025, 1025, 1040, 1103,
	1105, 1105, 8208, 8208, 8211, 8214, 8216, 8217, 8220, 8221, 8224, 8226,
	8228, 8231, 8240, 8240, 8242, 8243, 8245, 8245, 8251, 8251, 8254, 8254,
	8308, 8308, 8319, 8319, 8321, 8324, 8364, 8364, 8451, 8451, 8453, 8453,
	8457, 8457, 8467, 8467, 8470, 8470, 8481, 8482, 8486, 8486, 8491, 8491,
	8531, 8532, 8539, 8542, 8544, 8555, 8560, 8569, 8585, 8585, 8592, 8601,
	8632, 8633, 8658, 8658, 8660, 8660, 8679, 8679, 8704, 8704, 8706, 8707,
	8711, 8712, 8715, 8715, 8719, 8719, 8721, 8721, 8725, 8725, 8730, 8730,
	8733, 8736, 8739, 8739, 8741, 8741, 8743, 8748, 8750, 8750, 8756, 8759,
	8764, 8765, 8776, 8776, 8780, 8780, 8786, 8786, 8800, 8801, 8804, 8807,
	8810, 8811, 8814, 8815, 8834, 8835, 8838, 8839, 8853, 8853, 8857, 8857,
	8869, 8869, 8895, 8895, 8978, 8978, 9312, 9449, 9451, 9547, 9552, 9587,
	9600, 9615, 9618, 9621, 9632, 9633, 9635, 9641, 9650, 9651, 9654, 9655,
	9660, 9661, 9664, 9665, 9670, 9672, 9675, 9675, 9678, 9681, 9698, 9701,
	9711, 9711, 9733, 9734, 9737, 9737, 9742, 9743, 9756, 9756, 9758, 9758,
	9792, 9792, 9794, 9794, 9824, 9825, 9827, 9829, 9831, 9834, 9836, 9837,
	9839, 9839, 9886, 9887, 9919, 9919, 9926, 9933, 9935, 9939, 9941, 9953,
	9955, 9955, 9960, 9961, 9963, 9969, 9972, 9972, 9974, 9977, 9979, 9980,
	9982, 9983, 10045, 10045, 10102, 10111, 11094, 11097, 12872, 12879, 57344, 63743,
	65024, 65039, 65533, 65533, 127232, 127242, 127248, 127277, 127280, 127337, 127344, 127373,
	127375, 127376, 127387, 127404, 917760, 917999, 983040, 1048573, 1048576, 1114109,
];

function isAmbiguousCodePoint(cp: number): boolean {
	let lo = 0;
	let hi = AMBIGUOUS_RANGES.length / 2 - 1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const start = AMBIGUOUS_RANGES[mid * 2]!;
		const end = AMBIGUOUS_RANGES[mid * 2 + 1]!;
		if (cp < start) hi = mid - 1;
		else if (cp > end) lo = mid + 1;
		else return true;
	}
	return false;
}

/** Extra columns a CJK terminal may add for ambiguous-width characters. */
function ambiguousExtraWidth(str: string): number {
	let extra = 0;
	for (const ch of str) {
		const cp = ch.codePointAt(0)!;
		if (cp >= 161 && isAmbiguousCodePoint(cp)) extra += 1;
	}
	return extra;
}

/**
 * Conservative terminal width: like visibleWidth(), but East Asian
 * Ambiguous characters (│ ↑ ↓ · — … “ ” etc.) count as 2 columns.
 * Terminals/fonts in CJK locales frequently render them double-width;
 * counting them narrowly is what makes a "fitted" footer line wrap onto
 * an extra row and scroll the pane (clobbering the tmux status bar).
 */
export function measureWidth(str: string): number {
	return visibleWidth(str) + ambiguousExtraWidth(str);
}

/**
 * truncateToWidth(), but re-trims until the *conservative* width fits,
 * so the result never wraps even on ambiguous-wide terminals.
 */
export function truncateSafe(
	str: string,
	maxWidth: number,
	ellipsis = "...",
): string {
	let out = truncateToWidth(str, maxWidth, ellipsis);
	let budget = maxWidth;
	while (measureWidth(out) > maxWidth && budget > 0) {
		budget -= 1;
		out = truncateToWidth(str, budget, ellipsis);
	}
	return out;
}

/** Extra column reserved at the right edge to absorb font quirks. */
const SAFETY_MARGIN = 1;

function joinSegments(segments: string[], separator: string): string {
	return segments.filter(Boolean).join(separator);
}

function fitSegments(
	segments: string[],
	separator: string,
	width: number,
): string {
	if (width <= 0 || segments.length === 0) return "";
	// The first segment (model + thinking level) has top priority. If it
	// alone is wider than the terminal, show a truncated prefix of it
	// instead of skipping it in favor of lower-priority segments.
	if (measureWidth(segments[0]!) > width) {
		return truncateSafe(segments[0]!, width, "...");
	}
	const fitted: string[] = [segments[0]!];
	for (const segment of segments.slice(1)) {
		const candidate = joinSegments([...fitted, segment], separator);
		if (measureWidth(candidate) <= width) fitted.push(segment);
	}
	return truncateSafe(joinSegments(fitted, separator), width, "");
}

/** Walk up from cwd to find the git repo root directory (or null). */
function findRepoRoot(startDir: string): string | null {
	let dir = startDir;
	while (true) {
		if (existsSync(join(dir, ".git"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

/** Parse `git diff --shortstat` output into added/deleted line counts. */
function parseShortStat(output: string): { added: number; deleted: number } {
	const ins = output.match(/(\d+) insertion/);
	const del = output.match(/(\d+) deletion/);
	return {
		added: ins ? Number(ins[1]) : 0,
		deleted: del ? Number(del[1]) : 0,
	};
}

export default function statsFooter(pi: ExtensionAPI) {
	let tuiRef: RenderTui | null = null;
	let timer: ReturnType<typeof setInterval> | null = null;
	let runStart: number | null = null;
	let lastRunDuration = 0;
	// Turn timer: elapsed time since the current turn began (frozen at turn_end).
	let turnStart: number | null = null;
	let lastTurnDuration = 0;
	// Tokens-per-second tracking: generation window of the current assistant
	// message (genStart → message_end) plus the last completed message's rate.
	let genStart: number | null = null;
	let liveOutput = 0;
	let lastTps: number | null = null;
	// Characters streamed for the current assistant message (text + thinking
	// + toolcall deltas). Used to estimate output tokens live, since most
	// providers only report usage.output at message end.
	let deltaChars = 0;
	// Exponentially-averaged chars-per-token ratio, calibrated from each
	// message's real usage.output at message_end. Default 4 ≈ English prose.
	let charsPerToken = 4;
	// Git status: repo folder name + working-tree diff stats (+N -M), fetched
	// asynchronously (render is synchronous, so results are cached).
	let sessionCwd: string | null = null;
	// Working-folder label: git repo root's basename when cwd is inside a repo,
	// otherwise the basename of cwd itself — so the folder always shows even
	// when there is no git repo.
	let folderName: string | null = null;
	let repoName: string | null = null;
	let gitAdded = 0;
	let gitDeleted = 0;
	let gitFetching = false;
	let lastGitFetch = 0;

	const rerender = () => tuiRef?.requestRender();
	const stopTimer = () => {
		if (timer !== null) clearInterval(timer);
		timer = null;
	};
	// Ask git for `git diff --shortstat HEAD` (staged + unstaged vs HEAD) and
	// cache the result for the synchronous render. Debounced to 1s so heavy
	// repos aren't hammered; non-blocking execFile keeps the TUI responsive.
	const fetchGitDiff = (cwd: string) => {
		if (gitFetching) return;
		const now = Date.now();
		if (now - lastGitFetch < 1_000) return;
		lastGitFetch = now;
		gitFetching = true;
		execFile(
			"git",
			["--no-optional-locks", "diff", "--shortstat", "HEAD"],
			{ cwd, timeout: 3_000 },
			(err, stdout) => {
				gitFetching = false;
				if (err) {
					gitAdded = 0;
					gitDeleted = 0;
				} else {
					({ added: gitAdded, deleted: gitDeleted } = parseShortStat(stdout));
				}
				rerender();
			},
		);
	};

	pi.on("session_start", (_event, ctx) => {
		stopTimer();
		runStart = null;
		lastRunDuration = 0;
		turnStart = null;
		lastTurnDuration = 0;
		genStart = null;
		liveOutput = 0;
		lastTps = null;
		deltaChars = 0;
		sessionCwd = ctx.cwd;
		folderName = basename(ctx.cwd);
		const repoRoot = findRepoRoot(ctx.cwd);
		repoName = repoRoot === null ? null : basename(repoRoot);
		gitAdded = 0;
		gitDeleted = 0;
		if (ctx.mode !== "tui") return;

		ctx.ui.setFooter((tui, theme, footerData) => {
			tuiRef = tui;
			fetchGitDiff(ctx.cwd);
			const unsubscribeBranch = footerData.onBranchChange(() => {
				fetchGitDiff(ctx.cwd);
				rerender();
			});

			return {
				dispose() {
					unsubscribeBranch();
					stopTimer();
					tuiRef = null;
				},
				invalidate() {},
				render(width: number): string[] {
					if (width <= 0) return [];
					try {
						const entries = ctx.sessionManager.getEntries() as SessionEntry[];
						const { usage } = collectSessionStats(entries);
						const cacheRate = calculateCacheHitRate(usage);
						const context = ctx.getContextUsage();
						const contextWindow =
							context?.contextWindow ?? ctx.model?.contextWindow ?? 0;
						const contextPercent = context?.percent ?? null;

						let contextColor: "dim" | "success" | "warning" | "error" = "dim";
						if (contextPercent !== null) {
							if (contextPercent >= 80) contextColor = "error";
							else if (contextPercent >= 60) contextColor = "warning";
							else contextColor = "success";
						}

						const modelId = ctx.model
							? `${ctx.model.provider}/${ctx.model.id}`
							: "no-model";
						const thinkingLevel = ctx.thinkingLevel || "off";
						const contextText =
							contextPercent === null
								? `?/${formatTokens(contextWindow)}`
								: `${contextPercent.toFixed(0)}%/${formatTokens(contextWindow)}`;
						const separator = "  "; // two spaces — clean icon-bar look
						const elapsed =
							runStart === null ? lastRunDuration : Date.now() - runStart;
						const turnElapsed =
							turnStart === null ? lastTurnDuration : Date.now() - turnStart;
						const thinkingColor =
							THINKING_THEME_COLOR[
								thinkingLevel as keyof typeof THINKING_THEME_COLOR
							] ?? "thinkingMedium";
						let thinkingText: string;
						try {
							thinkingText = `💭 ${theme.fg(thinkingColor, thinkingLevel)}`;
						} catch {
							// thinkingMax is optional in themes; fall back to a vivid level.
							thinkingText = `💭 ${theme.fg("thinkingHigh", thinkingLevel)}`;
						}
						// TPS: live rate while the current assistant message streams,
						// falling back to the last completed message's rate so the value
						// keeps a fixed position instead of flashing only at message_end.
						let tpsSuffix = "";
						const liveTps =
							genStart !== null && liveOutput > 0
								? computeTps(liveOutput, genStart, Date.now())
								: null;
						const tpsValue = liveTps ?? lastTps;
						tpsSuffix = ` ⚡${Math.round(tpsValue ?? 0)} t/s`;
						// Line 1 — model + tokens/stats, each segment icon-prefixed.
						const statsLine = fitSegments(
							[
								`🤖 ${theme.fg("accent", modelId)} ${thinkingText}`,
								theme.fg(
									"dim",
									`↑${formatTokens(usage.input)} ↓${formatTokens(usage.output)}${tpsSuffix}`,
								),
								theme.fg(
									"dim",
									`💾 ${cacheRate === null ? "-" : `${cacheRate.toFixed(0)}%`}`,
								),
								`📦 ${theme.fg(contextColor, contextText)}`,
							],
							separator,
							Math.max(0, width - SAFETY_MARGIN),
						);
						// Line 2 — folder/git status + working/turn timers. The folder
						// name always shows (repo root basename, or plain cwd basename
						// when not inside a git repo); branch + diff only when git is
						// present.
						const branch = footerData.getGitBranch();
						const gitSegments: string[] = [];
						if (folderName !== null) {
							const folderLabel = repoName ?? folderName;
							const folderText = `📁 ${theme.fg("accent", folderLabel)}`;
							if (repoName !== null) {
								const branchText = branch
									? ` ▸  ${branch}`
									: "";
								gitSegments.push(
									folderText + branchText +
										` ${theme.fg("toolDiffAdded", `+${gitAdded}`)} ${theme.fg("toolDiffRemoved", `-${gitDeleted}`)}`,
								);
							} else {
								gitSegments.push(folderText);
							}
						}
						// ⏳ = work in progress (whole agent run), 💬 = current turn.
						gitSegments.push(
							`⏳ ${theme.fg("accent", formatDuration(elapsed))}`,
							`💬 ${theme.fg("accent", formatDuration(turnElapsed))}`,
						);
						const gitLine = fitSegments(
							gitSegments,
							separator,
							Math.max(0, width - SAFETY_MARGIN),
						);

						return [
							truncateSafe(statsLine, width, ""),
							truncateSafe(gitLine, width, ""),
						];
					} catch {
						// Footer rendering must never crash the TUI, even on very
						// narrow terminals or unexpected context shapes.
						return [];
					}
				},
			};
		});
	});

	pi.on("agent_start", () => {
		if (runStart === null) runStart = Date.now();
		lastRunDuration = 0;
		stopTimer();
		timer = setInterval(() => {
			if (sessionCwd !== null) fetchGitDiff(sessionCwd);
			rerender();
		}, 1_000);
		rerender();
	});
	pi.on("agent_settled", () => {
		if (runStart !== null) lastRunDuration = Date.now() - runStart;
		runStart = null;
		genStart = null;
		liveOutput = 0;
		stopTimer();
		rerender();
	});
	// --- Turn timer ---
	// A turn is one user→assistant cycle inside the agent loop. "working" spans
	// the whole agent run; "turn" shows only the current turn's elapsed time.
	pi.on("turn_start", () => {
		turnStart = Date.now();
		lastTurnDuration = 0;
	});
	pi.on("turn_end", () => {
		if (turnStart !== null) lastTurnDuration = Date.now() - turnStart;
		turnStart = null;
		rerender();
	});
	pi.on("session_shutdown", () => {
		stopTimer();
		tuiRef = null;
		runStart = null;
		turnStart = null;
		lastTurnDuration = 0;
		genStart = null;
		liveOutput = 0;
		lastTps = null;
		deltaChars = 0;
		sessionCwd = null;
		folderName = null;
		repoName = null;
		gitAdded = 0;
		gitDeleted = 0;
		lastGitFetch = 0;
	});

	// --- Tokens-per-second tracking ---
	// Each assistant message's generation window is measured from its
	// message_start (streaming begins) to message_end (stream done).
	// Each assistant message's generation window is measured from its
	// message_start (streaming begins) to message_end (stream done).
	// message_update carries progressively updated usage.output for providers
	// that report it (e.g. some gateways); most providers (Anthropic, OpenAI)
	// only send output usage at message end, so tokens are estimated live from
	// the streamed delta characters, calibrated by charsPerToken. Real usage
	// is preferred whenever it is reported and has grown past the estimate;
	// message_end keeps the final usage's rate as lastTps for display while
	// idle.
	pi.on("message_start", (event) => {
		if (event.message.role !== "assistant") return;
		genStart = Date.now();
		liveOutput = (event.message as AssistantMessage).usage?.output ?? 0;
		deltaChars = 0;
	});
	pi.on("message_update", (event) => {
		if (event.message.role !== "assistant") return;
		const assistantEvent = event.assistantMessageEvent;
		if (
			assistantEvent &&
			"delta" in assistantEvent &&
			typeof assistantEvent.delta === "string"
		) {
			deltaChars += assistantEvent.delta.length;
		}
		const partial =
			assistantEvent && "partial" in assistantEvent
				? (assistantEvent as { partial?: AssistantMessage }).partial
				: undefined;
		const reported =
			partial?.usage?.output ??
			(event.message as AssistantMessage).usage?.output;
		const estimated = Math.round(deltaChars / charsPerToken);
		const output = Math.max(
			typeof reported === "number" ? reported : 0,
			liveOutput,
			estimated,
		);
		if (output > liveOutput) liveOutput = output;
	});
	pi.on("message_end", (event) => {
		if (event.message.role === "assistant") {
			const output =
				(event.message as AssistantMessage).usage?.output ?? liveOutput;
			if (genStart !== null && output > 0) {
				const tps = computeTps(output, genStart, Date.now());
				lastTps = tps === null ? null : Math.round(tps);
			}
			// Calibrate the live chars-per-token estimate against the real
			// output token count so the next message's estimate is accurate.
			if (deltaChars > 0 && output > 0) {
				const ratio = deltaChars / output;
				charsPerToken = Math.min(
					12,
					Math.max(1.5, charsPerToken * 0.7 + ratio * 0.3),
				);
			}
			genStart = null;
			liveOutput = 0;
			deltaChars = 0;
		}
		rerender();
	});
	pi.on("thinking_level_select", rerender);
	pi.on("model_select", () => {
		// A different model streams at a different rate; drop any stale number.
		lastTps = null;
		genStart = null;
		liveOutput = 0;
		deltaChars = 0;
		rerender();
	});
	pi.on("session_info_changed", rerender);
}
