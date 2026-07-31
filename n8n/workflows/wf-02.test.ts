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
    new URL("./wf-02-unified-signed-intake.json", import.meta.url),
  );
  const serialized = await readFile(path, "utf8");
  return {
    workflow: JSON.parse(serialized) as Workflow,
    serialized,
  };
}

describe("WF-02 Unified Signed Intake", () => {
  it("preserves raw request bytes and responds through the internal intake API", async () => {
    const { workflow } = await loadWorkflow();
    const webhook = workflow.nodes.find(
      ({ type }) => type === "n8n-nodes-base.webhook",
    );
    const internalRequest = workflow.nodes.find(
      ({ type }) => type === "n8n-nodes-base.httpRequest",
    );
    const response = workflow.nodes.find(
      ({ type }) => type === "n8n-nodes-base.respondToWebhook",
    );

    expect(webhook?.parameters).toMatchObject({
      httpMethod: "POST",
      path: "unified-intake",
      responseMode: "responseNode",
      options: { rawBody: true },
    });
    expect(internalRequest?.parameters).toMatchObject({
      method: "POST",
      url: "http://intake-api:3000/v1/events",
      contentType: "binaryData",
      inputDataFieldName: "data",
    });
    expect(response).toBeDefined();
  });

  it("is inactive on import and does not retain execution payloads", async () => {
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
      /AGGREGATOR_CALLER_SECRET|development-only-hmac|password|api[_-]?key/i,
    );
  });
});
