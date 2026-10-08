// Publish a GitHub release for this repo and upload the Windows installer
// together with the electron-updater metadata (latest.yml + blockmap).
//
// Usage:
//   node build/release/publish-github-release.js [version] [--notes=notes.md]
//
//   version   defaults to the "version" field of package.json
//   --notes   optional markdown file used as the release body
//   --dry-run only list the assets that would be uploaded (no network)
//   --update-notes rewrite the body of an already published release only
//
// The GitHub token is read from the git credential manager (the same stored
// credential `git push` uses), so no token is written to disk. Building with
// electron-builder --publish never first is expected; the assets are picked up
// from release/.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const OWNER = "xtd1145";
const REPO = "prts-deskpet-patched";
const RELEASE_DIR = path.join(ROOT, "release");

const args = process.argv.slice(2);
const notesArg = args.find((a) => a.startsWith("--notes="));
const version =
  args.find((a) => !a.startsWith("--")) ||
  JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
const tag = `v${version}`;

function token() {
  const out = execFileSync("git", ["credential", "fill"], {
    input: "protocol=https\nhost=github.com\n\n",
    encoding: "utf8"
  });
  const line = out.split(/\r?\n/).find((l) => l.startsWith("password="));
  if (!line) throw new Error("no stored GitHub credential found (git credential fill)");
  return line.slice("password=".length);
}

function defaultBody() {
  return `## PRTS 桌宠 ${tag}

Windows 安装包见下方资产；安装过程中可选择一并安装 DeepSeek Harness。
`;
}

// The network to api.github.com drops out regularly here, so every call gets a
// few retries with growing backoff.
async function fetchRetry(url, init, attempts = 5) {
  let last;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      const res = await fetch(url, init);
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (error) {
      last = error;
      console.log(`  request attempt ${i} failed: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 5000 * i));
    }
  }
  throw last;
}

async function main() {
  const auth = {
    Authorization: `Bearer ${token()}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "prts-release-script"
  };
  const body = notesArg
    ? fs.readFileSync(path.resolve(ROOT, notesArg.slice("--notes=".length)), "utf8")
    : defaultBody();

  // --update-notes rewrites only the release body (no build, no upload) — the
  // way to amend a release that is already published.
  if (args.includes("--update-notes")) {
    const found = await fetchRetry(`https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${tag}`, {
      headers: auth
    });
    if (!found.ok) throw new Error(`release ${tag} not found (HTTP ${found.status})`);
    const release = await found.json();
    const patched = await fetchRetry(`https://api.github.com/repos/${OWNER}/${REPO}/releases/${release.id}`, {
      method: "PATCH",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ body })
    });
    if (!patched.ok) throw new Error(`update failed: ${patched.status} ${await patched.text()}`);
    console.log(`notes updated for ${tag}: ${(await patched.json()).html_url}`);
    return;
  }

  const assets = fs
    .readdirSync(RELEASE_DIR)
    .filter(
      (name) =>
        name === "latest.yml" ||
        (name.startsWith(`PRTS-Installer-${tag}-`) &&
          (name.endsWith(".exe") || name.endsWith(".exe.blockmap")))
    );
  if (!assets.length) throw new Error(`no release assets found in ${RELEASE_DIR}`);
  if (args.includes("--dry-run")) {
    console.log(`tag ${tag} — assets to upload:`);
    for (const name of assets) console.log(`  ${name}`);
    return;
  }

  const existing = await fetchRetry(
    `https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${tag}`,
    { headers: auth }
  );
  let release;
  if (existing.ok) {
    release = await existing.json();
    console.log(`release ${tag} already exists (#${release.id})`);
  } else {
    const created = await fetchRetry(`https://api.github.com/repos/${OWNER}/${REPO}/releases`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ tag_name: tag, name: `PRTS 桌宠 ${tag}`, body, draft: false, prerelease: false })
    });
    if (!created.ok) throw new Error(`create failed: ${created.status} ${await created.text()}`);
    release = await created.json();
    console.log(`created release ${tag} (#${release.id})`);
  }

  const uploadBase = release.upload_url.replace(/\{.*\}$/, "");
  const uploaded = new Set((release.assets || []).map((asset) => asset.name));
  for (const name of assets) {
    if (uploaded.has(name)) {
      console.log(`asset already uploaded: ${name}`);
      continue;
    }
    const data = fs.readFileSync(path.join(RELEASE_DIR, name));
    const res = await fetchRetry(`${uploadBase}?name=${encodeURIComponent(name)}`, {
      method: "POST",
      headers: {
        ...auth,
        "Content-Type": "application/octet-stream",
        "Content-Length": String(data.length)
      },
      body: data
    });
    const detail = res.ok ? "" : ` — ${res.status} ${await res.text()}`;
    console.log(`${res.ok ? "uploaded" : "FAILED"} ${name} (${data.length} bytes)${detail}`);
  }
  console.log(`release url: ${release.html_url}`);
}

main().catch((error) => {
  console.error(`RELEASE FAILED: ${error.message}`);
  process.exit(1);
});
