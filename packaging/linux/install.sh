#!/usr/bin/env bash
# Register the .vessel file type + icon with the freedesktop desktop environment
# for the CURRENT USER (no root). A .vessel is a ZIP, so without this the desktop
# sees it as application/zip and you can't associate the .vessel extension on its
# own. This installs an application/vessel MIME type (subclass of zip, matched by
# the *.vessel glob) and the Vessel document icon.
#
#   ./install.sh              register the MIME type + icons
#   ./install.sh --uninstall  remove them
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
data="${XDG_DATA_HOME:-$HOME/.local/share}"
mime_dir="$data/mime"
icon_dir="$data/icons/hicolor"
sizes=(16 32 48 256)

refresh() {
  update-mime-database "$mime_dir" || true
  gtk-update-icon-cache -f -t "$icon_dir" 2>/dev/null || true
}

if [ "${1:-}" = "--uninstall" ]; then
  rm -f "$mime_dir/packages/vessel.xml"
  for s in "${sizes[@]}"; do rm -f "$icon_dir/${s}x${s}/mimetypes/application-vessel.png"; done
  refresh
  echo "Removed the application/vessel MIME type and icons."
  exit 0
fi

# Preflight: the companion files must sit next to this script.
if [ ! -f "$here/vessel.xml" ] || [ ! -d "$here/icons" ]; then
  echo "error: this script must be run from the packaging/linux/ directory —" >&2
  echo "       vessel.xml and icons/ have to be alongside install.sh." >&2
  echo "       (ran from: $here)" >&2
  echo "       Copy the whole packaging/linux/ folder, then: cd packaging/linux && ./install.sh" >&2
  exit 1
fi

# 1. MIME type
mkdir -p "$mime_dir/packages"
cp "$here/vessel.xml" "$mime_dir/packages/vessel.xml"

# 2. File icon (the same .vessel document icon the host declares)
for s in "${sizes[@]}"; do
  dest="$icon_dir/${s}x${s}/mimetypes"
  mkdir -p "$dest"
  cp "$here/icons/application-vessel-${s}.png" "$dest/application-vessel.png"
done

refresh

echo "Registered application/vessel + icons for $USER."
echo
echo "Verify:"
echo "  xdg-mime query filetype SOMEFILE.vessel      # expect: application/vessel"
echo
echo "Associate .vessel with the installed Vessel host (PWA .desktop file):"
echo "  app=\$(ls \"$data/applications/\" | grep -i vessel | head -1)"
echo "  xdg-mime default \"\$app\" application/vessel"
echo
echo "Then restart the file manager (e.g. 'nautilus -q') or log out/in to refresh."
