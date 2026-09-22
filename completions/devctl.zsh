#!/usr/bin/env zsh
# Zsh completion for devctl, the development CLI of Fairfox.
# Source this file from .zshrc:
#   source ~/projects/fairfox/completions/devctl.zsh
#
# It is written by hand. `devctl ci` runs the check "completion", which fails
# when this file and the command table (packages/devctl/src/commands.ts)
# name different commands, flags or packages.

# `devctl` runs the devctl of the checkout you are in. Outside a checkout it
# fails; it never falls back to another one. lingua's completions/devctl.zsh
# defines the same `devctl` and `_devctl`: whichever is sourced last wins.
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
    'ci:Run every registered check on the commit that is checked out'
    'mutation:Run Stryker on named packages, or on the packages a branch touched'
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
    ci)
      _arguments \
        '(-h --help)'{-h,--help}'[show the help of ci]' \
        '*--only[run only this check; writes no record]:check:_devctl_checks' \
        '--red[see each check red with its recorded change, then green again]' \
        '--list[list the registered checks and what each catches]'
      ;;
    mutation)
      _arguments \
        '(-h --help)'{-h,--help}'[show the help of mutation]' \
        '--since[run on the packages this branch touched since a ref]:ref:__git_references' \
        '*:package:_devctl_mutated'
      ;;
  esac
}

# The registered checks, asked of devctl itself so the list cannot drift.
_devctl_checks() {
  local -a checks
  checks=(${${(f)"$(devctl ci --list 2>/dev/null)"}%% *})
  compadd -a checks
}

# The packages with a Stryker config, from stryker/*.conf.json.
_devctl_mutated() {
  local root
  root=$(git rev-parse --show-toplevel 2>/dev/null) || return
  local -a packages
  packages=("$root"/stryker/*.conf.json(N:t:r:r))
  compadd -a packages
}

compdef _devctl devctl
