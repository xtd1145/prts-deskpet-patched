// Trigger the build-mac GitHub Actions workflow (workflow_dispatch) for a
// version, then optionally watch the run. The workflow builds the universal
// dmg + zip + one-click pkg and uploads them to the existing v<version>
// release.
//
// Usage:
//   node build/release/trigger-mac-build.js [version] [--wait] [--status]
//
//   version  defaults to package.json's version
//   --wait   poll the run until it finishes (prints the html url meanwhile)
//   --status do not dispatch anything: just report the latest runs and the
//            assets currently attached to the v<version> release
//
// The token comes from the git credential manager; the workflow needs a token
// with Actions write access (a classic PAT with the `workflow` scope works).
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const OWNER = "xtd1145";
const REPO = "prts-deskpet-patched";
const WORKFLOW = "build-mac.yml";

const args = process.argv.slice(2);
const wait = args.includes("--wait");
const version =
  args.find((a) => !a.startsWith("--")) ||
  JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;

function token() {
  const out = execFileSync("git", ["credential", "fill"], {
    input: "protocol=https\nhost=github.com\n\n",
    encoding: "utf8"
  });
  const line = out.split(/\r?\n/).find((l) => l.startsWith("password="));
  if (!line) throw new Error("no stored GitHub credential found (git credential fill)");
  return line.slice("password=".length);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(url, init, attempts = 5) {
  let lastError;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      const res = await fetch(url, init);
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (error) {
      lastError = error;
      console.log(`  request attempt ${i} failed: ${error.message}`);
      await sleep(5000 * i);
    }
  }
  throw lastError;
}

async function main() {
  const auth = {
    Authorization: `Bearer ${token()}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "prts-mac-trigger",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  const base = `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}`;

  if (args.includes("--status")) {
    const runsRes = await request(`${base}/runs?event=workflow_dispatch&per_page=5`, { headers: auth });
    const runs = (await runsRes.json()).workflow_runs || [];
    console.log(`recent ${WORKFLOW} runs:`);
    for (const run of runs.slice(0, 3)) {
      console.log(`  ${run.id} status=${run.status} conclusion=${run.conclusion || "-"} ${run.html_url}`);
    }
    const relRes = await request(`https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/v${version}`, {
      headers: auth
    });
    if (relRes.ok) {
      const release = await relRes.json();
      console.log(`release v${version} assets:`);
      for (const asset of release.assets || []) {
        console.log(`  ${asset.name} (${(asset.size / 1024 / 1024).toFixed(1)} MB)`);
      }
    } else {
      console.log(`release v${version}: HTTP ${relRes.status}`);
    }
    return;
  }

  const dispatched = await request(`${base}/dispatches`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ ref: "main", inputs: { version } })
  });
  if (dispatched.status !== 204) {
    throw new Error(`dispatch failed: ${dispatched.status} ${await dispatched.text()}`);
  }
  console.log(`dispatched ${WORKFLOW} for v${version} on main`);

  if (!wait) {
    console.log(`watch: https://github.com/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}`);
    return;
  }

  // The run appears a moment after the dispatch call.
  let run = null;
  for (let i = 0; i < 12 && !run; i += 1) {
    await sleep(5000);
    const res = await request(`${base}/runs?event=workflow_dispatch&per_page=5`, { headers: auth });
    const json = await res.json();
    run = (json.workflow_runs || []).find((r) => r.head_branch === "main");
  }
  if (!run) {
    console.log("could not locate the run; check the Actions page");
    return;
  }
  console.log(`run: ${run.html_url}`);
  for (;;) {
    await sleep(30000);
    const res = await request(`https://api.github.com/repos/${OWNER}/${REPO}/actions/runs/${run.id}`, {
      headers: auth
    });
    const json = await res.json();
    console.log(`  status=${json.status} conclusion=${json.conclusion || "-"}`);
    if (json.status === "completed") {
      console.log(`finished: ${json.conclusion} — ${json.html_url}`);
      process.exit(json.conclusion === "success" ? 0 : 1);
    }
  }
}

main().catch((error) => {
  console.error(`TRIGGER FAILED: ${error.message}`);
  process.exit(1);
});
