const { test } = require("node:test");
const assert = require("node:assert/strict");
const { releaseTag, requireUnusedVersion } = require("./release-metadata.cjs");

function fixture({ release, ref } = {}) {
  const absent = async () => { throw Object.assign(new Error("Not Found"), { status: 404 }); };
  const calls = [];
  const outputs = {};
  return {
    calls, outputs,
    github: { paginate: async (_method, args) => { calls.push(args); return release ? release() : []; }, rest: {
      repos: { listReleases: () => {} },
      git: { getRef: async args => { calls.push(args); return (ref || absent)(); } },
    } },
    context: { repo: { owner: "owner", repo: "chattask" } },
    core: { setOutput: (key, value) => { outputs[key] = value; } },
  };
}

test("正式版の番号から更新確認と同じ形式のタグを作る", () => {
  assert.equal(releaseTag("0.1.0"), "v0.1.0");
  assert.equal(releaseTag("10.20.30"), "v10.20.30");
  for (const version of [undefined, 1, "v0.1.0", "01.0.0", "1.0", "1.0.0-beta", "1.0.0+build", "1.0.0\n", "$(whoami)"]) {
    assert.throws(() => releaseTag(version));
  }
});

test("リリース・タグが未使用の時だけ作成を許可する", async () => {
  const deps = fixture();
  await requireUnusedVersion(deps, "0.1.0");
  assert.deepEqual(deps.outputs, { version: "0.1.0", tag: "v0.1.0" });
  assert.deepEqual(deps.calls, [
    { owner: "owner", repo: "chattask", per_page: 100 },
    { owner: "owner", repo: "chattask", ref: "tags/v0.1.0" },
  ]);
});

for (const draft of [true, false]) {
  test(`既存の${draft ? "下書き" : "公開リリース"}を上書きしない`, async () => {
    const deps = fixture({ release: async () => [{ tag_name: "v0.1.0", draft }] });
    await assert.rejects(requireUnusedVersion(deps, "0.1.0"), /既に存在/);
    assert.deepEqual(deps.outputs, {});
  });
}

test("別バージョンのリリースがあっても新しい版を作成できる", async () => {
  const deps = fixture({ release: async () => [{ tag_name: "v0.0.1" }] });
  await requireUnusedVersion(deps, "0.1.0");
  assert.equal(deps.outputs.tag, "v0.1.0");
});

test("リリース一覧の404は取得成功として扱わない", async () => {
  const deps = fixture({ release: async () => { throw Object.assign(new Error("repo unavailable"), { status: 404 }); } });
  await assert.rejects(requireUnusedVersion(deps, "0.1.0"), /repo unavailable/);
  assert.deepEqual(deps.outputs, {});
});

test("リリースがなくても既存タグを使い回さない", async () => {
  const deps = fixture({ ref: async () => ({ data: { object: { sha: "another-commit" } } }) });
  await assert.rejects(requireUnusedVersion(deps, "0.1.0"), /タグが既に存在/);
  assert.deepEqual(deps.outputs, {});
});

for (const endpoint of ["release", "ref"]) {
  for (const status of [401, 403, 429, 500, undefined]) {
    test(`${endpoint} の ${status || "通信"} エラーを未公開と誤認しない`, async () => {
      const failure = Object.assign(new Error("API failed"), { status });
      const deps = fixture({ [endpoint]: async () => { throw failure; } });
      await assert.rejects(requireUnusedVersion(deps, "0.1.0"), error => error === failure);
      assert.deepEqual(deps.outputs, {});
    });
  }
}
