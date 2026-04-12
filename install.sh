#!/bin/bash
# Neurotokens Installer
# Copies hook files to ~/.claude/hooks/ and updates settings.json
# Run from the neurotoken project root: ./install.sh

set -euo pipefail

HOOKS_DIR="$HOME/.claude/hooks"
HOOKS_LIB="$HOOKS_DIR/lib"
CLAUDE_DIR="$HOME/.claude"

echo "Neurotokens Installer"
echo "====================="
echo ""

# Check prerequisites
if [ ! -f src/neurotoken-scorer.mjs ]; then
  echo "Error: Run this from the neurotoken project root"
  exit 1
fi

# Copy hook files
echo "1. Copying hook files..."
cp src/neurotoken-scorer.mjs "$HOOKS_DIR/neurotoken-scorer.mjs"
cp src/lib/neurotoken-signals.mjs "$HOOKS_LIB/neurotoken-signals.mjs"
# Only copy normalize.mjs if it doesn't already exist (other hooks may share it)
if [ ! -f "$HOOKS_LIB/normalize.mjs" ]; then
  cp src/lib/normalize.mjs "$HOOKS_LIB/normalize.mjs"
fi
echo "   -> $HOOKS_DIR/neurotoken-scorer.mjs"
echo "   -> $HOOKS_LIB/neurotoken-signals.mjs"

# Copy grader
echo "2. Copying grader script..."
cp src/neurotoken-grader.mjs "$HOOKS_DIR/neurotoken-grader.mjs"
echo "   -> $HOOKS_DIR/neurotoken-grader.mjs"

# Copy policy document
echo "3. Copying policy document..."
cp docs/neurotokens.md "$CLAUDE_DIR/neurotokens.md"
echo "   -> $CLAUDE_DIR/neurotokens.md"

echo ""
echo "Files installed. You still need to manually:"
echo ""
echo "  1. Add hook to settings.json UserPromptSubmit hooks array:"
echo '     { "type": "command", "command": "node '$HOOKS_DIR'/neurotoken-scorer.mjs", "timeout": 3 }'
echo ""
echo "  2. Add env vars to settings.json:"
echo '     "NEUROTOKEN_MODE": "shadow"'
echo '     "NEUROTOKEN_SESSION": "A"'
echo '     "NEUROTOKEN_PROJECTS": "project1,project2"'
echo ""
echo "  3. Add to ~/.claude/CLAUDE.md Core Values section:"
echo '     - Adaptive thinking — check `[neurotoken]` context on every prompt; follow `~/.claude/neurotokens.md`'
echo ""
echo "  4. (Optional) Add to session-cleanup.mjs:"
echo '     Clean up $TMPDIR/neurotoken-hwm.json'
echo ""
echo "  5. (Optional) Append contents of docs/orchestrator-patch.md to your orchestrator agent"
echo ""
echo "Done. Start with NEUROTOKEN_MODE=shadow to validate before activating."
