#!/bin/sh
set -eu

PROFILE_DIR="${CHROME_USER_DATA_DIR:-/data/.retweet-bot-chrome-profile}"
SEED_DIR="${CHROME_PROFILE_SEED_DIR:-/app/profile-seed}"

mkdir -p "$PROFILE_DIR"

seed_if_needed() {
  if [ ! -d "$SEED_DIR" ]; then
    return
  fi

  if [ -z "$(find "$SEED_DIR" -mindepth 1 -print -quit 2>/dev/null)" ]; then
    return
  fi

  if [ -n "$(find "$PROFILE_DIR" -mindepth 1 -print -quit 2>/dev/null)" ]; then
    echo "Chrome profile already exists at $PROFILE_DIR. Skipping seed."
    return
  fi

  echo "Seeding Chrome profile from $SEED_DIR to $PROFILE_DIR"
  cp -a "$SEED_DIR"/. "$PROFILE_DIR"/
}

seed_if_needed

Xvfb :99 -screen 0 1920x1080x24 &
exec npm start
