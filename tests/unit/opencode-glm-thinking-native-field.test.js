import { describe, expect, it } from "vitest";

import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";

// GLM served through OpenCode answers 400 for any request that carries Z.AI's native
// thinking object:
//
//   {"param":"thinking","type":"invalid_request_error",
//    "message":"Upstream request failed: [unknown_parameter] invalid request body:
//               json: unknown field \"thinking\""}
//
// capabilities.js declares thinkingFormat "zai" for every GLM line, and `zai` was not
// listed in NATIVE_ONLY_FORMATS, so resolveFormat() let that model-level format win on an
// OpenAI wire. applyFormat() then wrote `thinking: {type:"enabled"}` — a vendor field —
// onto a wire that cannot carry it.
//
// The providers that really speak Z.AI (glm, glm-cn) declare thinkingFormat at provider
// level, which resolveFormat() consults first, so their native field is preserved.

describe("the Z.AI-native thinking field must not reach an OpenAI wire", () => {
  it.each(["high", "max", "none"])(
    "OpenCode + glm-5.3-flash-free(%s) sends reasoning_effort and no thinking object",
    (level) => {
      const body = applyThinking("openai", `glm-5.3-flash-free(${level})`, {}, "opencode");

      expect(body.thinking).toBeUndefined();
      expect(typeof body.reasoning_effort).toBe("string");
    },
  );

  it("keeps Z.AI's own native field for the providers that speak it", () => {
    for (const provider of ["glm", "glm-cn"]) {
      const body = applyThinking("openai", "glm-5.3-flash(high)", {}, provider);

      expect(body.thinking, provider).toBeDefined();
    }
  });

  it("declares the Z.AI dialect on the transport, where PROVIDERS reads it", () => {
    expect(PROVIDERS.glm.thinkingFormat).toBe("zai");
    expect(PROVIDERS["glm-cn"].thinkingFormat).toBe("zai");
  });

  it("leaves a non-Z.AI model on OpenCode unchanged", () => {
    // DeepSeek on OpenCode carries the same field today and is accepted upstream, so the
    // fix must not widen beyond the Z.AI dialect.
    const body = applyThinking("openai", "deepseek-v4.1-flash(max)", {}, "opencode");

    expect(body.thinking).toBeDefined();
  });
});

// The reported model was oc/glm-5.3-flash-free(thinking). Z.AI's level set is the toggle
// ["none", "thinking"], so the intent carries the level name "thinking" — not an effort.
// With the Z.AI format correctly kept off this wire, applyFormat routes to the OpenAI
// branch, where the old normalizeOpenAILevel returned that name unchanged:
//
//   400 [invalid_value] unsupported reasoning_effort value "thinking"
//
// The wire accepts none|minimal|low|medium|high|xhigh only. The model cannot disable
// thinking here, so "reasoning on" is the faithful translation.
describe("reasoning_effort is always a value the OpenAI wire accepts", () => {
  it.each([
    ["thinking", "high"],
    ["auto", "high"],
    ["high", "high"],
    ["max", "xhigh"],
  ])("level %s becomes %s", (level, expected) => {
    const body = applyThinking("openai", "glm-5.3-flash-free", {}, "opencode", {
      mode: level === "auto" ? "auto" : "level",
      ...(level === "auto" ? {} : { level }),
    });

    expect(body.reasoning_effort).toBe(expected);
    expect(body.thinking).toBeUndefined();
  });
});
