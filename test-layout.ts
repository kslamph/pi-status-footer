/**
 * Layout unit tests: line-2 fitting rules.
 *
 * Line 2 = folder/git group + model segment. The model id is shortened from
 * the left (with an ellipsis) before the whole git group is dropped; the
 * provider and thinking level are never truncated. Below MIN_FIT_WIDTH the
 * line is rendered in full and allowed to overflow.
 *
 * Run: node --experimental-strip-types test-layout.ts
 */
import assert from "node:assert";
import {
	fitSecondLine,
	measureWidth,
	shortenModelId,
} from "./stats-footer.ts";

// --- shortenModelId -------------------------------------------------------

assert.strictEqual(
	shortenModelId("abcdefghij", 100),
	"abcdefghij",
	"fits → unchanged",
);
assert.strictEqual(shortenModelId("abcdefghij", 0), "", "zero budget → empty");
assert.strictEqual(
	shortenModelId("abcdefghij", -5),
	"",
	"negative budget → empty",
);
const truncated = shortenModelId("abcdefghij", 5);
assert.ok(truncated.startsWith("…"), `ellipsis prefix: ${truncated}`);
assert.ok(truncated.endsWith("j"), `keeps trailing chars: ${truncated}`);
assert.ok(
	measureWidth(truncated) <= 5,
	`respects budget: ${truncated} (${measureWidth(truncated)})`,
);

// --- fitSecondLine --------------------------------------------------------

const gitGroup = "📁 my-very-long-project-name ▸  main +123 -45";
const base = {
	gitGroup,
	modelPrefix: "🤖 ",
	provider: "openai",
	modelId: "ry-very-long-modelid-4o",
	modelSuffix: " 💭 medium",
	separator: "  ",
};
const fullModel = "🤖 openai/ry-very-long-modelid-4o 💭 medium";
const full = `${gitGroup}  ${fullModel}`;
const minModel = "🤖 openai/ 💭 medium";
const Wfull = measureWidth(full);
const Wmin = measureWidth(`${gitGroup}  ${minModel}`);

// Generous width: nothing is touched.
const wide = fitSecondLine(base, Wfull + 1);
assert.strictEqual(wide, full, `wide width keeps the full line: ${wide}`);

// One column short: git stays, the id loses leading chars behind an ellipsis,
// while provider and thinking level remain intact.
const short = fitSecondLine(base, Wfull);
assert.ok(short.includes("📁"), `git kept while the id can shrink: ${short}`);
assert.ok(short.includes("openai/"), `provider fully kept: ${short}`);
assert.ok(short.includes("…"), `ellipsis marks the cut: ${short}`);
assert.ok(short.includes("💭 medium"), `thinking fully kept: ${short}`);
assert.ok(
	!short.includes("ry-very-long-modelid-4o"),
	`full model id removed: ${short}`,
);
assert.ok(short.endsWith("4o 💭 medium"), `id tail preserved: ${short}`);
assert.ok(measureWidth(short) <= Wfull - 1, `fits the budget: ${short}`);

// Too narrow for git + even a bare `provider/`: the whole folder group is
// dropped, but provider and thinking level still show.
const narrow = fitSecondLine(base, 50);
assert.ok(!narrow.includes("📁"), `git group dropped: ${narrow}`);
assert.ok(narrow.includes("openai/"), `provider still shown: ${narrow}`);
assert.ok(narrow.includes("💭 medium"), `thinking still shown: ${narrow}`);

// Below MIN_FIT_WIDTH: render everything and let the TUI clip.
const tiny = fitSecondLine(base, 40);
assert.strictEqual(tiny, full, `below MIN_FIT_WIDTH renders in full: ${tiny}`);

// No model selected: no dangling provider slash.
const noModel = fitSecondLine(
	{ ...base, provider: "", modelId: "no-model", modelSuffix: " 💭 off" },
	80,
);
assert.ok(noModel.includes("🤖 no-model 💭 off"), `no slash: ${noModel}`);
assert.ok(!noModel.includes("//"), `no double slash: ${noModel}`);

console.log("✓ shortenModelId: budget handling + trailing-char ellipsis");
console.log("✓ fitSecondLine: full line when it fits");
console.log("✓ fitSecondLine: id shortened from the left, provider/thinking kept");
console.log("✓ fitSecondLine: git group dropped only when the model can't share");
console.log("✓ fitSecondLine: below 50 columns renders in full");
