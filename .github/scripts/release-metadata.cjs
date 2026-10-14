const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

function releaseTag(version) {
  if (typeof version !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error("tauri.conf.json の version は 0.1.0 のような正式版の番号にしてください。");
  }
  return `v${version}`;
}

async function requireUnusedVersion({ github, context, core }, version) {
  const tag = releaseTag(version);
  const repo = context.repo;
  // List all pages so draft releases without a published tag are checked too.
  // The final check runs with contents:write, which can see repository drafts.
  const releases = await github.paginate(github.rest.repos.listReleases, { ...repo, per_page: 100 });
  if (releases.some(release => release.tag_name === tag)) {
    throw new Error(`${tag} のリリース（下書きを含む）が既に存在します。既存ファイルは上書きしません。新しいバージョン番号を使用してください。`);
  }
  let tagExists = true;
  try {
    await github.rest.git.getRef({ ...repo, ref: `tags/${tag}` });
  } catch (error) {
    // Only a missing ref is allowed. API/permission errors must stop the release.
    if (error.status !== 404) throw error;
    tagExists = false;
  }
  if (tagExists) {
    throw new Error(`${tag} のタグが既に存在します。既存ファイルは上書きしません。新しいバージョン番号を使用してください。`);
  }
  core.setOutput("version", version);
  core.setOutput("tag", tag);
}

module.exports = async function releaseMetadata(dependencies) {
  const config = JSON.parse(readFileSync(resolve(__dirname, "../../chattask-desktop/src-tauri/tauri.conf.json"), "utf8"));
  await requireUnusedVersion(dependencies, config.version);
};
module.exports.releaseTag = releaseTag;
module.exports.requireUnusedVersion = requireUnusedVersion;
