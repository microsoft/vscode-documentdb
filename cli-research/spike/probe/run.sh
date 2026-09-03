#!/usr/bin/env bash
# Run from cli-research/spike after `npm install`:  bash probe/run.sh
# Needs node >= 22 and bun on PATH (bun is a devDependency: node_modules/.bin). Linux/macOS.
# On macOS, wrap the postject step in `codesign --remove-signature` / `codesign --sign -`.
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$PWD/../node_modules/.bin:$PATH"
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
mkdir -p "$W/build/src" "$W/dist" "$W/hostile/node_modules/probe-pkg" "$W/empty" "$W/bindir/node_modules/probe-pkg"
cp main.cjs "$W/build/src/main.cjs"
plant() { # $1 = directory holding node_modules, $2 = label
    mkdir -p "$1/node_modules/probe-pkg"
    echo '{"name":"probe-pkg","version":"1.0.0","main":"index.js"}' > "$1/node_modules/probe-pkg/package.json"
    echo "module.exports = 'LOADED FROM $2';" > "$1/node_modules/probe-pkg/index.js"
}
plant "$W/hostile" hostile; plant "$W/bindir" "next-to-binary"

build_sea() { # $1 = main as written into the SEA config, $2 = output name
    (cd "$W/build" && echo "{\"main\":\"$1\",\"output\":\"$W/dist/$2.blob\",\"disableExperimentalSEAWarning\":true}" > sea.json \
        && node --experimental-sea-config sea.json >/dev/null 2>&1)
    cp "$(command -v node)" "$W/dist/$2" && chmod 755 "$W/dist/$2"
    node ../node_modules/postject/dist/cli.js "$W/dist/$2" NODE_SEA_BLOB "$W/dist/$2.blob" \
        --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 >/dev/null 2>&1
}
build_sea "src/main.cjs" sea-relative-main          # what Node's docs show and what ../sea-config.json does
build_sea "$W/build/src/main.cjs" sea-absolute-main
bun build --compile main.cjs --external probe-pkg --outfile "$W/dist/bun" >/dev/null 2>&1
cp "$W"/dist/sea-* "$W/dist/bun" "$W/bindir/"

show() { python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print({k:v for k,v in d.items() if k!='cwd'})"; }
for b in sea-relative-main sea-absolute-main bun; do
    echo "=== $b ==="
    echo "  cwd=hostile:                       $(cd "$W/hostile" && "$W/dist/$b" | show)"
    echo "  cwd=empty:                         $(cd "$W/empty"   && "$W/dist/$b" | show)"
    echo "  cwd=empty, node_modules by binary: $(cd "$W/empty"   && "$W/bindir/$b" | show)"
done
plant "$W/build" "the-build-host-path"
echo "=== sea-absolute-main, cwd=empty, package planted at the BUILD host's path ==="
echo "  $(cd "$W/empty" && "$W/dist/sea-absolute-main" | show)"
