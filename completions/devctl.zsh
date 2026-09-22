#!/usr/bin/env zsh
# Zsh completion for devctl, the development CLI of Fairfox.
# Source this file from .zshrc:
#   source ~/projects/fairfox/completions/devctl.zsh
#
# It is written by hand. `devctl ci` runs the check "completion", which fails
# when this file and the command table (packages/devctl/src/commands.ts)
# name different commands, flags or packages.

# `devctl` runs the devctl of the checkout you are in. Outside a checkout it
# fails; it never falls back to another one.
devctl() {
  local root
  root=$(git rev-parse --show-toplevel 2>/dev/null)
  if [[ -z "$root" || ! -f "$root/packages/devctl/src/index.ts" ]]; then
    echo "devctl: not inside a Fairfox checkout" >&2
    return 1
  fi
  bun "$root/packages/devctl/src/index.ts" "$@"
}

_devctl() {
  local -a commands
  commands=(
    'help:List every command, or show the help of one'
    'build:Type-check and bundle each package of the workspace'
  )

  if (( CURRENT == 2 )); then
    _describe -t commands 'devctl command' commands
    return
  fi

  local cmd=${words[2]}
  shift words
  (( CURRENT-- ))

  case $cmd in
    help)
      _describe -t commands 'devctl command' commands
      ;;
    build)
      _arguments \
        '(-h --help)'{-h,--help}'[show the help of build]' \
        '*:package:(server client cli shell permissions devctl)'
      ;;
  esac
}

compdef _devctl devctl
