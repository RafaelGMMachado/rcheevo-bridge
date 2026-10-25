# Builds millennium/bin/ac-rhash.exe with zig cc. Windows counterpart of build-ra-hash.sh:
# same pinned sources, but without the Rust nod library (see native/ra_hash/windows/nod.h).
$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$revision = "1433173220a7eaede6a9ed7a18e94117be1821e0"
$libchdrRevision = "93d8c239ff0d4e8d7722985992649fce12d2463b"
$lz4Revision = "ebb370ca83af193212df4dcbadcc5d87bc0de2f0"
$buildDir = Join-Path ([System.IO.Path]::GetTempPath()) ("ac-rhash-" + [guid]::NewGuid())

$zig = (Get-Command zig -ErrorAction SilentlyContinue).Source
if (-not $zig) {
  # winget does not always put zig on PATH; fall back to its package folder.
  $zig = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\zig.zig_*\*\zig.exe" -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $zig) { throw "zig not found. Install it with: winget install zig.zig" }

function Checkout($url, $dir, $commit, $branch) {
  if ($branch) { git clone --quiet --depth 1 --branch $branch $url $dir } else { git clone --quiet $url $dir }
  if ($LASTEXITCODE -ne 0) { throw "git clone failed: $url" }
  git -C $dir -c advice.detachedHead=false checkout --quiet $commit
  if ((git -C $dir rev-parse HEAD) -ne $commit) { throw "$url is not at $commit" }
}

try {
  Checkout "https://github.com/RetroAchievements/rcheevos.git" "$buildDir/rcheevos" $revision "v12.5.0"
  Checkout "https://github.com/rtissera/libchdr.git" "$buildDir/libchdr" $libchdrRevision $null
  Checkout "https://github.com/lz4/lz4.git" "$buildDir/lz4" $lz4Revision "v1.10.0"

  $src = "$buildDir/rcheevos/src"
  $native = "$root/native/ra_hash"
  $outDir = "$root/millennium/bin"
  New-Item -ItemType Directory -Force $outDir | Out-Null

  & $zig cc -target x86_64-windows-gnu -std=c11 -O2 -static `
    -D_FILE_OFFSET_BITS=64 -DWANT_RAW_DATA_SECTOR=1 -DWANT_SUBCODE=1 -DVERIFY_BLOCK_CRC=1 `
    -I"$native/windows" `
    -I"$buildDir/rcheevos/include" `
    -I"$buildDir/libchdr/include" `
    -I"$buildDir/libchdr/deps/lzma-25.01/include" `
    -I"$buildDir/libchdr/deps/miniz-3.1.1" `
    -I"$buildDir/libchdr/deps/zstd-1.5.7" `
    -I"$buildDir/libchdr" `
    -I"$buildDir/lz4/lib" `
    "$native/main.c" "$native/media_reader.c" "$native/chd_reader.c" `
    "$native/compressed_iso_reader.c" "$native/playlist_reader.c" `
    "$src/rc_compat.c" "$src/rc_util.c" `
    "$src/rhash/hash.c" "$src/rhash/hash_rom.c" "$src/rhash/hash_disc.c" `
    "$src/rhash/hash_zip.c" "$src/rhash/hash_encrypted.c" "$src/rhash/cdreader.c" `
    "$src/rhash/md5.c" "$src/rhash/aes.c" `
    "$buildDir/libchdr/unity.c" `
    "$buildDir/lz4/lib/lz4.c" `
    -o "$outDir/ac-rhash.exe"
  if ($LASTEXITCODE -ne 0) { throw "zig cc failed" }
  Write-Host "Built $outDir/ac-rhash.exe"
}
finally {
  Remove-Item -Recurse -Force $buildDir -ErrorAction SilentlyContinue
}
