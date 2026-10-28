"""Inspect OhMyTab's two built release ZIPs with Python's standard ZIP reader."""
import argparse
import json
from pathlib import Path
import re
import sys
import zipfile


def inspect(root, browser):
    public = root / "public"
    built = root / ("dist_" + browser)
    manifest = json.loads((public / (browser + ".json")).read_text(encoding="utf-8"))
    expected = {"manifest.json", "background.mjs", "options.mjs", "options.html",
                "preview.mjs", "preview.html", "undo.mjs", "undo.html"}
    expected.update("_locales/" + p.name + "/messages.json"
                    for p in (public / "_locales").iterdir() if p.is_dir())
    expected.update(manifest.get("icons", {}).values())
    action = manifest.get("action", manifest.get("browser_action", {}))
    icons = action.get("default_icon", {})
    expected.update([icons] if isinstance(icons, str) else icons.values())
    background = manifest.get("background", {})
    expected.update(background.get("scripts", []))
    if background.get("service_worker"):
        expected.add(background["service_worker"])
    page = manifest.get("options_ui", {}).get("page", manifest.get("options_page"))
    if page:
        expected.add(page)
    for name in ("options.html", "preview.html", "undo.html"):
        html = (built / name).read_text(encoding="utf-8")
        expected.update(re.findall(r'''(?:src|href)\s*=\s*["']([^"']+)["']''', html, re.I))
    allowed = re.compile(r"(?:manifest\.json|(?:background|options|preview|undo)\.mjs|(?:options|preview|undo)\.html|image/[^/]+\.(?:png|svg|ico)|_locales/[^/]+/messages\.json)")
    if any(not allowed.fullmatch(name) for name in expected):
        raise ValueError("Unexpected runtime asset reference")
    with zipfile.ZipFile(root / "dist" / (browser + ".zip")) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or set(names) != expected:
            raise ValueError(browser + ": missing, duplicate or extra ZIP entries")
        bad = archive.testzip()
        if bad:
            raise ValueError(browser + ": CRC failure in " + bad)
        if json.loads(archive.read("manifest.json")) != manifest:
            raise ValueError(browser + ": wrong manifest")
        for name in names:
            if archive.read(name) != (built / name).read_bytes():
                raise ValueError(browser + ": ZIP/build byte mismatch: " + name)
    print(browser + ": " + str(len(expected)) + " entries, CRC/manifest/assets/build bytes OK")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    args = parser.parse_args()
    try:
        for browser in ("chrome", "firefox"):
            inspect(args.root, browser)
    except (OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile, RuntimeError) as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
