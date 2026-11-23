import { Container, MouseRegion, Spacer, Text, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.ts";
import { ToolExecutionComponent } from "./tool-execution.ts";

/** Distinct tool names a collapsed summary lists before folding the rest into `+N more`. */
const MAX_SUMMARY_NAMES = 4;

type SummaryState = "error" | "pending" | "success";

const BACKGROUNDS: Record<SummaryState, "toolErrorBg" | "toolPendingBg" | "toolSuccessBg"> = {
	error: "toolErrorBg",
	pending: "toolPendingBg",
	success: "toolSuccessBg",
};

/**
 * Collapses the consecutive tool calls of one assistant turn into a single summary line
 * (`read ×3 · grep ×2`).
 *
 * A group of one, an expanded group, and a group holding image results render their rows as is,
 * so nothing that is only visible in a row (images, per-row diffs) disappears behind a summary.
 */
export class ToolRunGroupComponent extends Container {
	private readonly tools: ToolExecutionComponent[] = [];
	private expanded: boolean;
	private outputPad: number;
	private summaryText?: Text;
	private summaryLine = "";
	private summaryState?: SummaryState;

	constructor(expanded = false, outputPad = 1) {
		super();
		this.expanded = expanded;
		this.outputPad = outputPad;
	}

	addTool(tool: ToolExecutionComponent): void {
		this.tools.push(tool);
		this.updateDisplay();
	}

	forEachTool(callback: (tool: ToolExecutionComponent) => void): void {
		for (const tool of this.tools) {
			callback(tool);
		}
	}

	/** Expand state driven by ctrl+O: the group and its rows move together. */
	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		for (const tool of this.tools) {
			tool.setExpanded(expanded);
		}
		this.updateDisplay();
	}

	/** Clicking the summary reveals the rows without expanding any of them. */
	showToolRows(): void {
		this.expanded = true;
		this.updateDisplay();
	}

	setOutputPad(outputPad: number): void {
		this.outputPad = outputPad;
		for (const tool of this.tools) {
			tool.setOutputPad(outputPad);
		}
		this.updateDisplay();
	}

	override invalidate(): void {
		super.invalidate();
		// Theme colors and row state are baked into the summary string, so rebuild it.
		this.summaryLine = "";
		this.summaryState = undefined;
		this.syncSummary();
	}

	override render(width: number): string[] {
		this.syncSummary();
		return super.render(width);
	}

	private showsToolRows(): boolean {
		return this.expanded || this.tools.length === 1 || this.tools.some((tool) => tool.hasImages());
	}

	private updateDisplay(): void {
		this.clear();
		this.summaryText = undefined;

		if (this.showsToolRows()) {
			for (const tool of this.tools) {
				this.addChild(tool);
			}
			return;
		}

		const summary = new Text("", this.outputPad, 0);
		this.summaryText = summary;
		this.summaryLine = "";
		this.summaryState = undefined;
		this.addChild(new Spacer(1));
		this.addChild(
			new MouseRegion(summary, (event: TuiMouseEvent) => {
				if (event.type !== "click" || event.button !== "left") return undefined;
				this.showToolRows();
				return { handled: true };
			}),
		);
		this.syncSummary();
	}

	private syncSummary(): void {
		const summary = this.summaryText;
		if (!summary) {
			return;
		}

		const state = this.summaryStateFor();
		if (state !== this.summaryState) {
			this.summaryState = state;
			summary.setCustomBgFn((line: string) => theme.bg(BACKGROUNDS[state], line));
		}

		const line = this.buildSummaryLine();
		if (line !== this.summaryLine) {
			this.summaryLine = line;
			summary.setText(line);
		}
	}

	private summaryStateFor(): SummaryState {
		if (this.tools.some((tool) => tool.hasError())) {
			return "error";
		}
		if (this.tools.some((tool) => tool.isRunning())) {
			return "pending";
		}
		return "success";
	}

	private buildSummaryLine(): string {
		const counts = new Map<string, number>();
		for (const tool of this.tools) {
			const name = tool.getToolName();
			counts.set(name, (counts.get(name) ?? 0) + 1);
		}

		const parts: string[] = [];
		for (const [name, count] of counts) {
			if (parts.length === MAX_SUMMARY_NAMES) {
				parts.push(theme.fg("muted", `+${counts.size - MAX_SUMMARY_NAMES} more`));
				break;
			}
			parts.push(`${theme.fg("toolTitle", theme.bold(name))}${theme.fg("muted", ` ×${count}`)}`);
		}

		let line = parts.join(theme.fg("muted", " · "));
		const failed = this.tools.filter((tool) => tool.hasError()).length;
		if (failed > 0) {
			line += theme.fg("error", ` · ${failed} failed`);
		}
		return line;
	}
}

/**
 * Appends a tool row to the transcript. Consecutive rows share one run group, so a long string of
 * calls collapses into a summary line instead of a screenful of rows.
 */
export function appendToolToChat(
	chat: Container,
	tool: ToolExecutionComponent,
	options: { group: boolean; expanded: boolean; outputPad: number },
): void {
	if (!options.group) {
		chat.addChild(tool);
		return;
	}

	const last = chat.children.at(-1);
	if (last instanceof ToolRunGroupComponent) {
		last.addTool(tool);
		return;
	}

	const group = new ToolRunGroupComponent(options.expanded, options.outputPad);
	group.addTool(tool);
	chat.addChild(group);
}

/** Visits every tool row in a transcript, including the ones grouped behind a summary line. */
export function forEachToolRow(chat: Container, callback: (tool: ToolExecutionComponent) => void): void {
	for (const child of chat.children) {
		if (child instanceof ToolExecutionComponent) {
			callback(child);
		} else if (child instanceof ToolRunGroupComponent) {
			child.forEachTool(callback);
		}
	}
}
