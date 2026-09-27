#!/usr/bin/env bash
# Configure Eclipse in its own build tree, leaving the regular build alone.
set -euo pipefail
repo=$1
arch=$2
cd "$repo"

[[ -f cmake/eclipse.cmake ]] || { echo "This checkout does not have Eclipse support. Choose the port's eclipse branch." >&2; exit 1; }
case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=macos; [[ "$arch" == 64 ]] || { echo "macOS supports 64 bit only." >&2; exit 1; } ;;
  MINGW*|MSYS*) os=windows; [[ "$arch" == 32 && "${MSYSTEM:-}" == MINGW32 ]] || { echo "Windows needs the MSYS2 MINGW32 32 bit toolchain." >&2; exit 1; } ;;
  *) echo "Unsupported operating system." >&2; exit 1 ;;
esac
bdir="build/$os-$arch-eclipse"
cmake_args=(-DSMS_ARCH="$arch" -DSMS_ECLIPSE=ON -DSMS_BUNDLE_DISC= -DSMS_GX_BUILD_TESTS=OFF)
if [[ "$os" == windows ]]; then cmake_args+=(-G Ninja); fi

if [[ "$os" == macos ]]; then
  command -v brew >/dev/null || { echo "Install Homebrew and LLVM; see BUILD.md." >&2; exit 1; }
  llvm_bin="$(brew --prefix llvm)/bin"
  [[ -x "$llvm_bin/llvm-objcopy" ]] || { echo "Install Homebrew LLVM; see BUILD.md." >&2; exit 1; }
  export PATH="$llvm_bin:$PATH"
  if [[ "$(uname -m)" == arm64 ]] && ! arch -x86_64 true >/dev/null 2>&1; then
    echo "Install Rosetta 2; see BUILD.md." >&2; exit 1
  fi
  framework="$repo/build/deps/SDL2.framework"
  if [[ ! -f "$framework/SDL2" ]]; then
    mkdir -p build/deps
    dmg="$repo/build/deps/SDL2-2.30.11.dmg"
    if [[ ! -f "$dmg" ]]; then curl -fsSL -o "$dmg.part" 'https://github.com/libsdl-org/SDL/releases/download/release-2.30.11/SDL2-2.30.11.dmg'; mv "$dmg.part" "$dmg"; fi
    mountpoint="$(hdiutil attach "$dmg" -nobrowse -readonly | awk -F '\t' '/\/Volumes\//{print $NF; exit}')"
    [[ -n "$mountpoint" && -d "$mountpoint/SDL2.framework" ]] || { echo "Could not mount SDL2 framework." >&2; exit 1; }
    rm -rf "$framework"
    cp -R "$mountpoint/SDL2.framework" "$framework"
    hdiutil detach "$mountpoint" -quiet || true
  fi
  cmake_args+=(-DCMAKE_OSX_ARCHITECTURES=x86_64 -DCMAKE_C_COMPILER="$llvm_bin/clang" -DCMAKE_CXX_COMPILER="$llvm_bin/clang++" -DSMS_SDL2_FRAMEWORK="$framework")
fi

git submodule update --init decomp
cmake -S . -B "$bdir" "${cmake_args[@]}"
cmake --build "$bdir" --target sms --parallel "${JOBS:-4}"
if [[ "$os" == macos ]]; then
  rm -rf "$bdir/SDL2.framework"
  cp -R "$framework" "$bdir/SDL2.framework"
fi
echo "Built $bdir/sms for Eclipse."
