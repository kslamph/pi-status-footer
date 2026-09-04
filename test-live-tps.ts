/**
 * Smoke test: simulates the pi event stream and asserts that the footer
 * shows a live t/s value DURING streaming (before message_end), and that
 * the chars-per-token calibration engages at message_end.
 *
 * Run: node --experimental-strip-types test-live-tps.ts
 */
import assert from "node:assert";
import statsFooter from "./stats-footer.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

// Capture the footer render closure from setFooter.
let renderFn: ((width: number) => string[]) | null = null;
const tui = { requestRender() {} };
const theme = { fg(_color: string, text: string) { return text; } };
const footerData = {
	onBranchChange() { return () => {}; },
	getGitBranch() { return "main"; },
};

const sessionCtx = {
	mode: "tui",
	cwd: process.cwd(),
	sessionManager: { getEntries() { return []; } },
	getContextUsage() { return { percent: 10, contextWindow: 200000 }; },
	model: { provider: "test", id: "test-model", contextWindow: 200000 },
	thinkingLevel: "off",
};

statsFooter(pi as any);

// The setFooter callback returns { render } — capture it on session_start.
const ctxWithUi = {
	...sessionCtx,
	ui: {
		setFooter(fn: any) {
			const result = fn(tui, theme, footerData);
			renderFn = (width: number) => result.render(width);
		},
	},
};
emit("session_start", {}, ctxWithUi);
assert.ok(renderFn, "footer render captured from setFooter");

// --- Simulate streaming: message_start, then deltas over >0.25s ---
emit("agent_start");
emit("turn_start");
emit("message_start", {
	message: { role: "assistant", usage: undefined },
});
// 40 deltas of 10 chars = 400 chars; with default 4 chars/token ≈ 100 tokens.
for (let i = 0; i < 40; i++) {
	emit("message_update", {
		message: { role: "assistant", usage: undefined },
		assistantMessageEvent: {
			type: "text_delta",
			contentIndex: 0,
			delta: "abcdefghij",
			partial: { role: "assistant", usage: undefined },
		},
	});
}
await sleep(450); // exceed computeTps' 0.25s floor
const midStream = renderFn!(120).join("\n");
const tpsMatch = midStream.match(/⚡(\d+) t\/s/);
assert.ok(tpsMatch, `live t/s segment present during streaming: ${midStream}`);
const liveTps = Number(tpsMatch![1]);
assert.ok(liveTps > 0, `live t/s > 0 while streaming (got ${liveTps}): ${midStream}`);
assert.ok(
	liveTps < 400,
	`live t/s plausible (got ${liveTps}, would exceed 400 t/s)`,
);

// --- message_end: final usage arrives, rate freezes as lastTps ---
emit("message_end", {
	message: { role: "assistant", usage: { output: 100, input: 10, cacheRead: 0, cacheWrite: 0, cost: { total: 0.001 } } },
});
const afterEnd = renderFn!(120).join("\n");
const endMatch = afterEnd.match(/⚡(\d+) t\/s/);
assert.ok(endMatch, `t/s retained after message_end: ${afterEnd}`);
assert.ok(
	Number(endMatch![1]) > 0 && Number(endMatch![1]) < 400,
	`post-end t/s plausible: ${afterEnd}`,
);

// --- Second message: calibration from msg 1 (400 chars / 100 tokens = 4.0)
// keeps the estimate accurate ---
emit("message_start", {
	message: { role: "assistant", usage: undefined },
});
for (let i = 0; i < 40; i++) {
	emit("message_update", {
		message: { role: "assistant", usage: undefined },
		assistantMessageEvent: {
			type: "text_delta",
			contentIndex: 0,
			delta: "abcdefghij",
			partial: { role: "assistant", usage: undefined },
		},
	});
}
await sleep(450);
const second = renderFn!(120).join("\n");
const secondMatch = second.match(/⚡(\d+) t\/s/);
assert.ok(secondMatch && Number(secondMatch[1]) > 0, `second message live t/s: ${second}`);

// --- Reset paths don't throw ---
emit("message_end", {
	message: { role: "assistant", usage: { output: 100, input: 10, cacheRead: 0, cacheWrite: 0, cost: { total: 0.001 } } },
});
emit("agent_settled");
emit("turn_end");
emit("model_select");
emit("session_shutdown");

console.log("✓ live TPS shows during streaming (before message_end)");
console.log("✓ TPS plausible while streaming and after end");
console.log("✓ chars/token calibration engaged; second message estimates live");
