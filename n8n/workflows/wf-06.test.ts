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
    new URL("./wf-06-error-handler.json", import.meta.url),
  );
  const serialized = await readFile(path, "utf8");
  return {
    workflow: JSON.parse(serialized) as Workflow,
    serialized,
  };
}

describe("WF-06 Error Handler", () => {
  it("routes sanitized error alerts to the discord bot", async () => {
    const { workflow } = await loadWorkflow();
    const trigger = workflow.nodes.find(
      ({ type }) => type === "n8n-nodes-base.errorTrigger",
    );
    const sanitize = workflow.nodes.find(
      ({ name }) => name === "Sanitize Alert",
    );
    const request = workflow.nodes.find(
      ({ type }) => type === "n8n-nodes-base.httpRequest",
    );
    expect(trigger).toBeDefined();
    expect(sanitize).toBeDefined();
    expect(request?.parameters).toMatchObject({
      method: "POST",
      url: "http://discord-bot:3002/v1/ops-alert",
    });
  });

  it("is inactive on import and contains no secrets", async () => {
    const { workflow, serialized } = await loadWorkflow();
    expect(workflow.active).toBe(false);
    expect(serialized).not.toMatch(
      /DISCORD_BOT_TOKEN|password|api[_-]?key|hmac/i,
    );
  });
});
