import { TOOLS } from '@/lib/tools/catalog';
import { hasNativeAgent, toToolError } from '@/lib/tools/native';
import { ToolError, type Action, type ActionResult, type ToolDef } from '@/lib/tools/types';

export type { Action, ActionResult, ToolDef } from '@/lib/tools/types';

const DEFAULT_TIMEOUT_MS = 20_000;
const byName = new Map(TOOLS.map((t) => [t.name, t]));

/** Tools this device can run right now: native ones only in the Android development build. */
export function availableTools(): ToolDef[] {
  return TOOLS.filter((t) => !t.native || hasNativeAgent);
}

/** The catalog in function-calling format, sent to the backend on device registration. */
export function toolSpecs() {
  return availableTools().map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
}

/** One-line description for the chat ("Opening Instagram"). */
export function describeAction(action: Action): string {
  const tool = byName.get(action.tool);
  if (!tool) return action.tool.replace(/_/g, ' ');
  try {
    return tool.label(action.args ?? {});
  } catch {
    return tool.name.replace(/_/g, ' ');
  }
}

/** Runs one tool call. Never throws: failures come back as results the model can act on. */
export async function runAction(action: Action): Promise<ActionResult> {
  const tool = byName.get(action.tool);
  if (!tool || (tool.native && !hasNativeAgent)) {
    return failed(action, new ToolError(`“${action.tool}” isn’t available on this device.`, 'not_supported'));
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new ToolError('That took too long.', 'timeout')),
        tool.timeoutMs ?? DEFAULT_TIMEOUT_MS
      );
    });
    const output = await Promise.race([tool.run(action.args ?? {}), timeout]);
    return { action_id: action.id, status: 'done', output: output ?? { done: true } };
  } catch (e) {
    return failed(action, toToolError(e));
  } finally {
    clearTimeout(timer);
  }
}

function failed(action: Action, error: ToolError): ActionResult {
  return { action_id: action.id, status: 'failed', error: { code: error.code, message: error.message } };
}
