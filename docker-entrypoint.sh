#!/bin/sh
set -eu

PROFILE_DIR="${CHROME_USER_DATA_DIR:-/data/.retweet-bot-chrome-profile}"
SEED_DIR="${CHROME_PROFILE_SEED_DIR:-/app/profile-seed}"
FORCE_SEED="${FORCE_PROFILE_SEED:-false}"

mkdir -p "$PROFILE_DIR"

seed_if_needed() {
  if [ ! -d "$SEED_DIR" ]; then
    echo "No Chrome profile seed directory found at $SEED_DIR"
    return
  fi

  if [ -z "$(find "$SEED_DIR" -mindepth 1 -print -quit 2>/dev/null)" ]; then
    echo "Chrome profile seed directory is empty at $SEED_DIR"
    return
  fi

  if [ "$FORCE_SEED" = "true" ]; then
    echo "FORCE_PROFILE_SEED=true: resetting Chrome profile at $PROFILE_DIR"
    rm -rf "$PROFILE_DIR"/*
  elif [ -n "$(find "$PROFILE_DIR" -mindepth 1 -print -quit 2>/dev/null)" ]; then
    echo "Chrome profile already exists at $PROFILE_DIR. Skipping seed. Set FORCE_PROFILE_SEED=true to re-seed from $SEED_DIR"
    return
  fi

  echo "Seeding Chrome profile from $SEED_DIR to $PROFILE_DIR"
  cp -a "$SEED_DIR"/. "$PROFILE_DIR"/
}

seed_if_needed

Xvfb :99 -screen 0 1920x1080x24 &
exec npm start
