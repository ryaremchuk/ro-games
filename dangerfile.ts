import { danger, warn, fail, message, schedule } from 'danger'

const pr = danger.github.pr
const created = danger.git.created_files
const modified = danger.git.modified_files
const touched = [...created, ...modified]

// --- PR hygiene -------------------------------------------------------------

// We squash-merge, so the PR title becomes the commit subject.
const conventional =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+\))?!?: .+/
if (!conventional.test(pr.title)) {
  fail(
    `PR title must follow Conventional Commits, e.g. \`feat: add memory game\`. Got: "${pr.title}"`,
  )
}

if (!pr.body || pr.body.trim().length < 10) {
  fail('Add a PR description explaining **what** changed and **why**.')
}

const changedLines = pr.additions + pr.deletions
if (changedLines > 400) {
  warn(`Large PR (${changedLines} lines changed). Consider splitting it into smaller PRs.`)
}

if (modified.includes('package.json') && !modified.includes('package-lock.json')) {
  warn('`package.json` changed but `package-lock.json` did not — did you run `npm install`?')
}

// --- Project-specific -------------------------------------------------------

// A new game folder must be registered so it shows up on the home screen.
const newGames = Array.from(
  new Set(
    created
      .filter((file) => file.startsWith('src/games/'))
      .map((file) => file.split('/')[2])
      .filter(Boolean),
  ),
)
if (newGames.length > 0 && !touched.includes('src/games/registry.tsx')) {
  fail(
    `New game folder(s) added (${newGames.join(', ')}) but src/games/registry.tsx was not updated — the game will not appear on the home screen.`,
  )
}

// --- Async checks -----------------------------------------------------------

schedule(async () => {
  const sourceFiles = touched.filter((file) => /^src\/.*\.(ts|tsx)$/.test(file))
  for (const file of sourceFiles) {
    const diff = await danger.git.diffForFile(file)
    if (diff && /^\+\s*console\.log\(/m.test(diff.diff)) {
      warn(`Leftover \`console.log\` in \`${file}\`.`)
    }
  }
})

message('🎮 CI runs lint, types, tests, build, and Lighthouse on this PR.')
