import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export const DEFAULT_BUDGET = {
  maxSteps: 8,
  maxToolCalls: 16,
  maxWallMs: 60_000,
  maxTokens: 4000,
};

export class AgentBudgetError extends Error {
  constructor(msg) { super(msg); this.name = "AgentBudgetError"; }
}

export class AgentKillSwitchError extends Error {
  constructor(msg) { super(msg); this.name = "AgentKillSwitchError"; }
}

function killSwitchOn() {
  return String(process.env.MUSE_AGENT_KILL_SWITCH || "").toLowerCase() === "true";
}

function tooLong(s, n) {
  if (typeof s !== "string") return s;
  return s.length > n ? s.slice(0, n) + `…[+${s.length - n} chars]` : s;
}

/**
 * Run an agent loop with OpenAI tool-calling.
 *
 * @param {object} opts
 * @param {string} opts.model              - OpenAI chat model (must support tool calling).
 * @param {string} opts.systemPrompt       - System message defining the op.
 * @param {string} opts.userInput          - User's request for this run.
 * @param {Array}  opts.tools              - Array of { name, description, schema, allowed:bool, handler:async(args)=>any }.
 * @param {object} [opts.budget]           - Override default budget.
 * @param {function} [opts.onStep]         - Optional callback after every step.
 * @returns {Promise<{ok, finalText, trace, toolCallCount, durationMs, error}>}
 */
export async function runAgent({ model = "gpt-4o-mini", systemPrompt, userInput, tools = [], budget, onStep }) {
  if (killSwitchOn()) throw new AgentKillSwitchError("MUSE_AGENT_KILL_SWITCH is on");
  const b = { ...DEFAULT_BUDGET, ...(budget || {}) };
  const start = Date.now();
  const trace = [];
  let toolCallCount = 0;

  const allowedTools = tools.filter(t => t.allowed !== false);
  const toolMap = new Map(allowedTools.map(t => [t.name, t]));
  const toolDefs = allowedTools.map(t => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.schema || { type: "object", properties: {} },
    },
  }));

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userInput || "" },
  ];

  let finalText = "";
  let lastError = null;
  let stepNum = 0;

  while (stepNum < b.maxSteps) {
    if (Date.now() - start > b.maxWallMs) {
      lastError = `Wall-clock budget exceeded (${b.maxWallMs}ms)`;
      break;
    }
    stepNum += 1;

    let resp;
    try {
      resp = await openai.chat.completions.create({
        model,
        messages,
        tools: toolDefs.length ? toolDefs : undefined,
        tool_choice: toolDefs.length ? "auto" : undefined,
        max_tokens: b.maxTokens,
        temperature: 0.2,
      });
    } catch (err) {
      lastError = `LLM call failed: ${err.message}`;
      trace.push({ step: stepNum, kind: "llm_error", error: lastError });
      break;
    }

    const msg = resp.choices?.[0]?.message;
    if (!msg) {
      lastError = "LLM returned no message";
      break;
    }

    // Push assistant turn into history. The OpenAI API requires
    // tool_calls + content (may be null) on the assistant message,
    // followed by one tool message per call.
    messages.push({
      role: "assistant",
      content: msg.content || "",
      ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}),
    });

    const calls = msg.tool_calls || [];

    if (!calls.length) {
      // Final answer.
      finalText = msg.content || "";
      trace.push({ step: stepNum, kind: "final", text: tooLong(finalText, 4000) });
      onStep?.(trace[trace.length - 1]);
      return { ok: true, finalText, trace, toolCallCount, durationMs: Date.now() - start, error: null };
    }

    for (const call of calls) {
      if (toolCallCount >= b.maxToolCalls) {
        lastError = `Tool-call budget exceeded (${b.maxToolCalls})`;
        trace.push({ step: stepNum, kind: "budget_error", error: lastError });
        // Push synthetic tool result so message history stays valid.
        messages.push({ role: "tool", tool_call_id: call.id, content: `ERROR: ${lastError}` });
        break;
      }
      toolCallCount += 1;
      const name = call.function?.name;
      const tool = toolMap.get(name);
      let argsRaw = call.function?.arguments || "{}";
      let args;
      try { args = JSON.parse(argsRaw); } catch { args = {}; }

      const stepEntry = {
        step: stepNum,
        kind: "tool_call",
        toolName: name,
        args,
        startedAt: new Date().toISOString(),
      };

      if (!tool) {
        stepEntry.error = `Unknown or disallowed tool: ${name}`;
        stepEntry.result = null;
        trace.push(stepEntry);
        onStep?.(stepEntry);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: `ERROR: tool "${name}" is not available in this op.`,
        });
        continue;
      }

      try {
        const result = await tool.handler(args || {});
        stepEntry.result = result;
        stepEntry.durationMs = Date.now() - new Date(stepEntry.startedAt).getTime();
        trace.push(stepEntry);
        onStep?.(stepEntry);
        const payload = typeof result === "string" ? result : JSON.stringify(result);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: tooLong(payload, 6000),
        });
      } catch (err) {
        stepEntry.error = err.message || String(err);
        stepEntry.durationMs = Date.now() - new Date(stepEntry.startedAt).getTime();
        trace.push(stepEntry);
        onStep?.(stepEntry);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: `ERROR: ${stepEntry.error}`,
        });
      }
    }

    if (lastError) break;
  }

  if (!lastError && stepNum >= b.maxSteps) {
    lastError = `Step budget exceeded (${b.maxSteps} steps)`;
  }
  return {
    ok: false,
    finalText: finalText || "",
    trace,
    toolCallCount,
    durationMs: Date.now() - start,
    error: lastError,
  };
}
