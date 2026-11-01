#!/bin/bash
#
# Copies the app's SQLite database off the phone so it can be read here.
#
# The database never leaves the device on its own — section 8 keeps everything
# local and the release manifest has no INTERNET permission — so the only way
# to see it is to pull a copy over the USB cable with adb.
#
# The write-ahead log has to come with it. op-sqlite runs in WAL mode, which
# means a committed row sits in find-my-expense.sqlite-wal until a checkpoint
# folds it into the main file. That log is routinely larger than the database,
# so copying the .sqlite alone shows an older version of the data and the rows
# you are looking for are usually the ones missing. The copy here is
# checkpointed on arrival, which merges the log and leaves one self-contained
# file.
#
# Usage:  npm run db                     fresh copy, then an interactive shell
#         npm run db -- "SELECT 1"       fresh copy, run one query, print it
#         npm run db -- --stale          reuse the copy already pulled
#
set -e

PACKAGE=com.findmyexpense
REMOTE=databases/find-my-expense.sqlite
# Gitignored: this is the user's real spending, and it does not belong in the
# repository.
LOCAL_DIR="$(cd "$(dirname "$0")/.." && pwd)/.local/db"
LOCAL="$LOCAL_DIR/find-my-expense.sqlite"

ADB="adb"
[ -n "$ANDROID_SERIAL" ] && ADB="adb -s $ANDROID_SERIAL"

PULL=true
if [ "$1" = "--stale" ]; then
  PULL=false
  shift
fi

if [ "$PULL" = true ]; then
  if ! $ADB get-state >/dev/null 2>&1; then
    echo "No device or emulator is connected, or ANDROID_SERIAL names one that is not."
    echo "Attached devices:"
    adb devices -l | tail -n +2
    exit 1
  fi

  mkdir -p "$LOCAL_DIR"

  # run-as is what gets at a debuggable app's private directory without root.
  # exec-out rather than shell: shell mangles binary on the way through by
  # translating line endings, which corrupts the database just enough that
  # sqlite3 reports "file is not a database".
  $ADB exec-out run-as "$PACKAGE" cat "$REMOTE"     > "$LOCAL"
  $ADB exec-out run-as "$PACKAGE" cat "$REMOTE-wal" > "$LOCAL-wal" 2>/dev/null || true

  # Checked by its header, not its size. A failed `run-as` prints its refusal
  # to stdout, so the file is there and plausible and contains an error
  # message — and the next command to read it reports a corrupt database
  # rather than a build that cannot be read.
  if [ "$(head -c 15 "$LOCAL" 2>/dev/null)" != "SQLite format 3" ]; then
    echo "Nothing came across."
    echo "run-as only reaches a debuggable app, so a release build cannot be"
    echo "read this way. Install the debug build to inspect the database:"
    echo "  ANDROID_SERIAL=${ANDROID_SERIAL:-<serial>} npm run android"
    rm -f "$LOCAL" "$LOCAL-wal"
    exit 1
  fi

  # Folds the log into the database, then deletes it, so what is left is one
  # file that can be copied around or opened by anything.
  sqlite3 "$LOCAL" "PRAGMA journal_mode=DELETE;" >/dev/null

  echo "Pulled to .local/db/find-my-expense.sqlite ($(du -h "$LOCAL" | cut -f1))"
  sqlite3 "$LOCAL" <<'SQL'
.mode list
.separator ' '
SELECT 'transactions', COUNT(*) FROM transactions
UNION ALL SELECT 'unreadable', COUNT(*) FROM sms_messages WHERE parse_status = 'NO_MATCH'
UNION ALL SELECT 'accounts', COUNT(*) FROM accounts
UNION ALL SELECT 'merchants', COUNT(*) FROM merchants;
SQL
  echo
fi

# A copy that is not today's is the most dangerous thing this script can
# hand back: the numbers look real and answer a question about the past. It
# says how old it is, every time, rather than leaving that to be remembered.
if [ "$PULL" = false ]; then
  if [ ! -s "$LOCAL" ]; then
    echo "There is no local copy yet. Run without --stale first."
    exit 1
  fi
  AGE_MIN=$(( ($(date +%s) - $(stat -f %m "$LOCAL" 2>/dev/null || stat -c %Y "$LOCAL")) / 60 ))
  if [ "$AGE_MIN" -gt 10 ]; then
    echo "Reading a copy pulled ${AGE_MIN} minutes ago, not the phone."
  fi
fi

if [ $# -gt 0 ]; then
  sqlite3 -box "$LOCAL" "$@"
else
  # .headers and .mode are set here rather than in a dotfile so the shell looks
  # the same on any machine.
  sqlite3 -cmd ".headers on" -cmd ".mode box" "$LOCAL"
fi
