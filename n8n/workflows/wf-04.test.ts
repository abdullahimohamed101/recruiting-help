import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type WorkflowNode = {
  name: string;
  type: string;
  parameters: Record<string, unknown>;
};

type Workflow = {
  active: boolean;
  nodes: WorkflowNode[];
  settings: Record<string, unknown>;
};

async function loadWorkflow(): Promise<{
  workflow: Workflow;
  serialized: string;
}> {
  const path = fileURLToPath(
    new URL("./wf-04-deliver-discord-outbox.json", import.meta.url),
  );
  const serialized = await readFile(path, "utf8");
  return {
    workflow: JSON.parse(serialized) as Workflow,
    serialized,
  };
}

describe("WF-04 Deliver Discord Outbox", () => {
  it("schedules private discord-bot delivery calls", async () => {
    const { workflow } = await loadWorkflow();
    const schedule = workflow.nodes.find(
      ({ type }) => type === "n8n-nodes-base.scheduleTrigger",
    );
    const request = workflow.nodes.find(
      ({ type }) => type === "n8n-nodes-base.httpRequest",
    );
    expect(schedule).toBeDefined();
    expect(request?.parameters).toMatchObject({
      method: "POST",
      url: "http://discord-bot:3002/v1/deliver-batch",
    });
  });

  it("is inactive on import and retains no execution payloads", async () => {
    const { workflow } = await loadWorkflow();
    expect(workflow.active).toBe(false);
    expect(workflow.settings).toMatchObject({
      saveDataErrorExecution: "none",
      saveDataSuccessExecution: "none",
      saveManualExecutions: false,
    });
  });

  it("contains no embedded credential values", async () => {
    const { serialized } = await loadWorkflow();
    expect(serialized).not.toMatch(
      /DISCORD_BOT_TOKEN|token|password|secret|api[_-]?key/i,
    );
  });
});
