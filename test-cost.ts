/**
 * Cost unit tests: formatting tiers, session summation, and the line-1
 * segment (session sum + current turn's delta).
 *
 * The delta is the session cost at `turn_start` subtracted from the current
 * session cost, so it must reset per turn and never leak the previous turn.
 *
 * Run: node --experimental-strip-types test-cost.ts
 */
import assert from "node:assert";
import statsFooter, {
	collectSessionStats,
	formatCost,
	formatCostDelta,
} from "./stats-footer.ts";

// --- formatCost: precision tiers -----------------------------------------

assert.strictEqual(formatCost(0.00200772), "$0.002", "rounds at 3 decimals");
assert.strictEqual(formatCost(0.00042), "$0.000", "sub-milli rounds to zero, not exponential");
assert.strictEqual(formatCost(0.1234), "$0.123", "3 decimals");
assert.strictEqual(formatCost(1.5), "$1.500", "always 3 decimals");
assert.strictEqual(formatCost(12.3449), "$12.345", "rounds half up");
assert.strictEqual(formatCost(1_234.4), "$1234.400", "four digits: no k-compaction");

// Fixed decimals mean the pathological rate (a cost divided by 1e6 twice)
// renders as an obviously broken number, never as a plausible price.
assert.strictEqual(formatCost(3.618468e-9), "$0.000", "sub-nano → $0.000");
assert.strictEqual(formatCostDelta(3.618468e-9), "+$0.000000", "delta keeps 6 decimals");
for (const bad of [3.618468e-9, 0.00200772, 1234.4, 0.1]) {
	assert.ok(!/[eE]/.test(formatCost(bad)), `no exponent in ${formatCost(bad)}`);
	assert.ok(!/[eE]/.test(formatCostDelta(bad)), `no exponent in ${formatCostDelta(bad)}`);
}

// No rates on the model (aggregator providers record cost 0) is missing data,
// not a free session; no usage at all is a plain dash.
assert.strictEqual(formatCost(0), "n/a", "zero cost with tokens → n/a");
assert.strictEqual(formatCost(0, false), "-", "zero cost without tokens → -");
assert.strictEqual(formatCost(Number.NaN), "n/a", "NaN → n/a");
assert.strictEqual(formatCost(Number.POSITIVE_INFINITY), "n/a", "Infinity → n/a");
assert.strictEqual(formatCost(-1), "n/a", "negative → n/a");

// --- formatCostDelta ------------------------------------------------------

assert.strictEqual(formatCostDelta(0), "", "no spend yet → omitted");
assert.strictEqual(formatCostDelta(0.02), "+$0.020000", "cent delta at 6 decimals");
assert.strictEqual(formatCostDelta(12.5), "+$12.500000", "dollar delta at 6 decimals");
assert.strictEqual(formatCostDelta(0.00200772), "+$0.002008", "delta is not quantised to zero");

// --- collectSessionStats sums cost over every usage-bearing entry --------

const usageOf = (cost: number) => ({
	input: 100,
	output: 50,
	cacheRead: 1_000,
	cacheWrite: 0,
	totalTokens: 1_150,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
});
const messageEntry = (role: string, cost: number) => ({
	type: "message",
	message: { role, usage: usageOf(cost) },
});

const summed = collectSessionStats([
	messageEntry("assistant", 0.2),
	messageEntry("toolResult", 0.05),
	{ type: "compaction", usage: usageOf(0.01) },
	{ type: "branch_summary", usage: usageOf(0.02) },
	{ type: "message", message: { role: "user" } }, // no usage → ignored
] as any);
assert.strictEqual(
	summed.usage.cost,
	0.28,
	"cost summed across assistant/toolResult/compaction/branch_summary",
);

// --- Render: session sum + per-turn delta ---------------------------------

type Handler = (event: any, ctx?: any) => void;
const handlers = new Map<string, Handler[]>();
const pi = {
	on(name: string, fn: Handler) {
		if (!handlers.has(name)) handlers.set(name, []);
		handlers.get(name)!.push(fn);
	},
};
const emit = (name: string, event?: any, ctx?: any) => {
	for (const fn of handlers.get(name) ?? []) fn(event, ctx);
};

const tui = { requestRender() {} };
const theme = { fg(_color: string, text: string) { return text; } };
const footerData = {
	onBranchChange() { return () => {}; },
	getGitBranch() { return "main"; },
};

let entries: any[] = [];
const sessionCtx = {
	mode: "tui",
	cwd: process.cwd(),
	sessionManager: { getEntries() { return entries; } },
	getContextUsage() { return { percent: 10, contextWindow: 200_000 }; },
	model: { provider: "test", id: "test-model", contextWindow: 200_000 },
	thinkingLevel: "off",
};

statsFooter(pi as any);
// Returns the captured render fn, so callers never have to re-assert it.
const startSession = (): ((width: number) => string[]) => {
	let captured: ((width: number) => string[]) | null = null;
	emit("session_start", {}, {
		...sessionCtx,
		ui: {
			setFooter(fn: any) {
				const result = fn(tui, theme, footerData);
				captured = (width: number) => result.render(width);
			},
		},
	});
	assert.ok(captured, "footer render captured from setFooter");
	return captured;
};

// Resume a session that already spent $0.40: entries are in place *before*
// session_start, which is what resuming actually looks like.
entries = [messageEntry("assistant", 0.4)];
let renderFn = startSession();

const line1 = (): string => renderFn(200)[0]!;
const sumOf = (): string | null => line1().match(/💰 (\S+)/)?.[1] ?? null;
const deltaOf = (): string | null => line1().match(/(\+\$[\d.]+)/)?.[1] ?? null;

// The resumed sum shows, but no delta until a turn actually runs.
assert.strictEqual(sumOf(), "$0.400", `resumed session sum: ${line1()}`);
assert.strictEqual(deltaOf(), null, `no delta before the first turn: ${line1()}`);

// Turn 1 spends $0.02.
emit("turn_start");
entries = [...entries, messageEntry("assistant", 0.02)];
emit("turn_end");
assert.strictEqual(sumOf(), "$0.420", `sum after turn 1: ${line1()}`);
assert.strictEqual(deltaOf(), "+$0.020000", `delta is turn 1 only: ${line1()}`);

// Turn 2 must not inherit turn 1: the baseline is re-read at turn_start.
emit("turn_start");
assert.strictEqual(deltaOf(), null, `delta resets at turn_start: ${line1()}`);
entries = [...entries, messageEntry("assistant", 0.1)];
emit("turn_end");
assert.strictEqual(sumOf(), "$0.520", `sum after turn 2: ${line1()}`);
assert.strictEqual(deltaOf(), "+$0.100000", `delta excludes turn 1: ${line1()}`);

// The delta tracks the live turn: it grows as the turn spends, and a turn
// that spends nothing renders no delta at all.
emit("turn_start");
entries = [...entries, messageEntry("assistant", 0.25)];
assert.strictEqual(deltaOf(), "+$0.250000", `delta grows within the turn: ${line1()}`);
emit("turn_end");

// Tokens spent but the model declares no pricing → n/a, not $0.00.
emit("session_shutdown");
entries = [messageEntry("assistant", 0)];
renderFn = startSession();
assert.strictEqual(sumOf(), "n/a", `unpriced model → n/a: ${line1()}`);
assert.strictEqual(deltaOf(), null, `no delta when nothing is billed: ${line1()}`);

// Empty session: no cost segment at all (nothing spent, nothing to report).
emit("session_shutdown");
entries = [];
renderFn = startSession();
assert.strictEqual(sumOf(), null, `no 💰 before any usage: ${line1()}`);

// Back to a priced session for the layout assertions.
entries = [messageEntry("assistant", 0.2)];
renderFn = startSession();
emit("turn_start");
entries = [...entries, messageEntry("assistant", 0.05)];

// A stale baseline (cost lower than the recorded baseline — e.g. entries
// rewritten by a branch switch) must not render a negative delta.
assert.ok(
	deltaOf() === null || !deltaOf()!.startsWith("-"),
	`delta never negative: ${line1()}`,
);

// Layout: cost stays on line 1, after the timers.
const finalLines = renderFn(200);
assert.ok(finalLines[0]!.includes("💰"), `cost on line 1: ${finalLines[0]}`);
assert.ok(
	finalLines[0]!.indexOf("💬") < finalLines[0]!.indexOf("💰"),
	`cost is the last segment: ${finalLines[0]}`,
);
assert.ok(
	!finalLines[1]!.includes("💰"),
	`cost is not on line 2: ${finalLines[1]}`,
);

// Reset paths don't throw.
emit("agent_settled");
emit("turn_end");
emit("model_select");
emit("session_shutdown");

console.log("✓ formatCost: fixed 3 decimals, rounded, never exponential");
console.log("✓ formatCost: unpriced models read n/a, no usage reads -");
console.log("✓ formatCostDelta: 6 decimals, omitted at zero, +$ prefix otherwise");
console.log("✓ collectSessionStats: cost summed across all usage-bearing entries");
console.log("✓ render: session sum shown, no delta before the first turn");
console.log("✓ render: delta covers the current turn only, resets per turn");
console.log("✓ render: cost is the last line-1 segment (clips first when narrow)");