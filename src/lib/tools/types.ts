/** JSON Schema for a tool's arguments, as the model sees it (OpenAI/Groq function-calling format). */
export type JsonSchema = {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type ToolGroup = 'screen' | 'apps' | 'communication' | 'time' | 'files' | 'web' | 'device' | 'notifications';

export type ToolDef<A = any> = {
  /** `^[a-z0-9_]+$`: function names can't contain dots. */
  name: string;
  group: ToolGroup;
  /** Written for the model: what it does, when to use it, what to do next. */
  description: string;
  parameters: JsonSchema;
  /** Short present-tense line for the chat, e.g. "Opening Instagram". */
  label: (args: A) => string;
  /** Needs the native module, so only works in the development build on Android. */
  native?: boolean;
  /** Longer than the default 20 s (e.g. waiting for something on screen). */
  timeoutMs?: number;
  run: (args: A) => Promise<unknown>;
};

/** Error codes the model understands (see docs/agent-platform.md). */
export type ToolErrorCode =
  | 'invalid_args'
  | 'not_supported'
  | 'permission_missing'
  | 'not_found'
  | 'app_not_installed'
  | 'failed'
  | 'timeout';

export class ToolError extends Error {
  constructor(
    message: string,
    readonly code: ToolErrorCode
  ) {
    super(message);
  }
}

/** An action from the backend: one tool call. */
export type Action = { id: string; tool: string; args?: Record<string, unknown> };

export type ActionResult = {
  action_id: string;
  status: 'done' | 'failed';
  output?: unknown;
  error?: { code: ToolErrorCode; message: string };
};
