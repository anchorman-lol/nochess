#!/bin/sh
# Builds the web app for production and force-pushes it to the gh-pages branch of origin. VITE_*
# from the shell are dropped, so the build's settings are only those in apps/web/.env.production.
set -eu
for name in $(env | sed -n 's/^\(VITE_[A-Z_]*\)=.*/\1/p'); do unset "$name"; done
remote=$(git remote get-url origin)
commit=$(git rev-parse --short HEAD)
pnpm build
dist=apps/web/dist
touch "$dist/.nojekyll"
rm -rf "$dist/.git"
git -C "$dist" init -q -b gh-pages
git -C "$dist" add -A
git -C "$dist" commit -qm "chore: deploy $commit"
git -C "$dist" push -qf "$remote" gh-pages
rm -rf "$dist/.git"
