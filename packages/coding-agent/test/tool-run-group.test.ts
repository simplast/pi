import { Container, Text, type TUI, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, test } from "vitest";
import { ToolExecutionComponent, type ToolRenderers } from "../src/modes/interactive/components/tool-execution.ts";
import { appendToolToChat, ToolRunGroupComponent } from "../src/modes/interactive/components/tool-run.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const WIDTH = 80;
const tui = { requestRender: () => {} } as unknown as TUI;

const renderers: ToolRenderers = {
	renderCall: (args: any) => new Text(`call ${args.path}`, 0, 0),
	// Mirrors the built-in renderers: collapsed rows show output only once expanded.
	renderResult: (result: any, options: { expanded: boolean }) =>
		options.expanded ? new Text(`text ${result.content[0]?.text ?? ""}`, 0, 0) : new Text("", 0, 0),
};

function createRow(name: string, path: string, id = path): ToolExecutionComponent {
	return new ToolExecutionComponent(name, id, { path }, { showImages: false }, renderers, tui, "/tmp");
}

function createFinishedRow(name: string, path: string, isError = false): ToolExecutionComponent {
	const row = createRow(name, path);
	row.setArgsComplete();
	row.markExecutionStarted();
	row.updateResult({ content: [{ type: "text", text: `${path} output` }], isError }, false);
	return row;
}

function createGroup(rows: ToolExecutionComponent[], expanded = false): ToolRunGroupComponent {
	const group = new ToolRunGroupComponent(expanded, 1);
	for (const row of rows) {
		group.addTool(row);
	}
	return group;
}

function renderText(component: { render(width: number): string[] }): string {
	return stripAnsi(component.render(WIDTH).join("\n"));
}

function visibleLines(component: { render(width: number): string[] }): string[] {
	return component
		.render(WIDTH)
		.map((line) => stripAnsi(line).trim())
		.filter((line) => line !== "");
}

function clickSummary(group: ToolRunGroupComponent): void {
	const lines = group.render(WIDTH);
	const row = lines.findIndex((line) => stripAnsi(line).includes("×"));
	expect(row).toBeGreaterThanOrEqual(0);
	const event: TuiMouseEvent = {
		type: "click",
		button: "left",
		x: 2,
		y: row,
		screenX: 2,
		screenY: row,
		width: WIDTH,
		height: lines.length,
		shift: false,
		alt: false,
		ctrl: false,
		clickCount: 1,
	};
	expect(group.handleMouse(event)?.handled).toBe(true);
}

describe("ToolRunGroupComponent", () => {
	beforeAll(() => initTheme("dark"));

	test("collapses the calls of a run into one summary line", () => {
		const group = createGroup([
			createFinishedRow("read", "a.ts"),
			createFinishedRow("read", "b.ts"),
			createFinishedRow("grep", "src"),
		]);

		const lines = visibleLines(group);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain("read ×2");
		expect(lines[0]).toContain("grep ×1");
		expect(renderText(group)).not.toContain("call a.ts");
	});

	test("shows its single call like an ungrouped row", () => {
		const group = createGroup([createFinishedRow("read", "a.ts")]);

		expect(renderText(group)).toContain("call a.ts");
		expect(renderText(group)).not.toContain("read ×1");
	});

	test("reveals the collapsed rows when the summary is clicked", () => {
		const group = createGroup([createFinishedRow("read", "a.ts"), createFinishedRow("read", "b.ts")]);
		clickSummary(group);

		expect(renderText(group)).toContain("call a.ts");
		expect(renderText(group)).toContain("call b.ts");
		// Clicking reveals rows; it does not expand their output.
		expect(renderText(group)).not.toContain("a.ts output");
	});

	test("expanding the group expands every row", () => {
		const group = createGroup([createFinishedRow("read", "a.ts"), createFinishedRow("grep", "src")]);
		group.setExpanded(true);

		expect(renderText(group)).toContain("a.ts output");
		expect(renderText(group)).toContain("src output");

		group.setExpanded(false);
		expect(visibleLines(group)).toHaveLength(1);
	});

	test("counts failed calls in the summary", () => {
		const group = createGroup([
			createFinishedRow("read", "a.ts"),
			createFinishedRow("read", "b.ts", true),
			createFinishedRow("read", "c.ts", true),
		]);

		const lines = visibleLines(group);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain("2 failed");
	});

	test("keeps a long run readable by folding extra tool names", () => {
		const group = createGroup([
			createFinishedRow("read", "a"),
			createFinishedRow("grep", "b"),
			createFinishedRow("find", "c"),
			createFinishedRow("ls", "d"),
			createFinishedRow("edit", "e"),
			createFinishedRow("write", "f"),
		]);

		const lines = visibleLines(group);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain("+2 more");
	});
});

describe("appendToolToChat", () => {
	beforeAll(() => initTheme("dark"));

	test("joins consecutive rows into one group", () => {
		const chat = new Container();
		for (const path of ["a.ts", "b.ts", "c.ts"]) {
			appendToolToChat(chat, createFinishedRow("read", path), { group: true, expanded: false, outputPad: 1 });
		}

		expect(chat.children).toHaveLength(1);
		expect(visibleLines(chat)).toHaveLength(1);
	});

	test("starts a new group after anything else lands in the transcript", () => {
		const chat = new Container();
		appendToolToChat(chat, createFinishedRow("read", "a.ts"), { group: true, expanded: false, outputPad: 1 });
		appendToolToChat(chat, createFinishedRow("read", "b.ts"), { group: true, expanded: false, outputPad: 1 });
		// The assistant message that follows a run of tools sits between two groups.
		chat.addChild(new Text("next turn", 0, 0));
		appendToolToChat(chat, createFinishedRow("grep", "src"), { group: true, expanded: false, outputPad: 1 });
		appendToolToChat(chat, createFinishedRow("grep", "lib"), { group: true, expanded: false, outputPad: 1 });

		expect(chat.children).toHaveLength(3);
		expect(visibleLines(chat).filter((line) => line.includes("×"))).toHaveLength(2);
	});

	test("adds ungrouped rows when grouping is off", () => {
		const chat = new Container();
		appendToolToChat(chat, createFinishedRow("read", "a.ts"), { group: false, expanded: false, outputPad: 1 });
		appendToolToChat(chat, createFinishedRow("read", "b.ts"), { group: false, expanded: false, outputPad: 1 });

		expect(chat.children).toHaveLength(2);
		expect(renderText(chat)).toContain("call a.ts");
		expect(renderText(chat)).toContain("call b.ts");
	});
});
