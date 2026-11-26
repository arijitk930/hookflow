import { describe, it, expect } from "vitest";
import { MAX_JSON_DEPTH, findJsonProblem } from "./jsonSafety.js";

function nested(levels: number): unknown {
  let value: unknown = 1;
  for (let i = 0; i < levels; i++) value = { child: value };
  return value;
}

describe("findJsonProblem", () => {
  it("accepts ordinary JSON, including emoji and non-Latin text", () => {
    expect(
      findJsonProblem({ id: "ord_1", amount: 1499, note: "ধন্যবাদ 🎉", tags: [null, true] })
    ).toBeNull();
  });

  it.each([
    ["NUL in a value", { a: "x\u0000y" }],
    ["NUL in a key", { "x\u0000": 1 }],
    ["lone surrogate", { a: ["\ud800"] }],
    ["overflowing number", JSON.parse('{"a":1e999}')],
  ])("rejects %s", (_name, value) => {
    expect(findJsonProblem(value)).not.toBeNull();
  });

  it("limits nesting depth without overflowing the stack", () => {
    expect(findJsonProblem(nested(MAX_JSON_DEPTH))).toBeNull();
    expect(findJsonProblem(nested(MAX_JSON_DEPTH + 1))).toMatch(/Nested/);
    expect(findJsonProblem(nested(100_000))).toMatch(/Nested/);
  });
});
