#!/usr/bin/env bash
set -euo pipefail

ros_distro="${ROS_DISTRO:-humble}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
app_dir="$HOME/.local/share/kian-remote-lab"
install_dir="$app_dir/visualization"
user_root="$app_dir/ros-user"
cache_dir="$app_dir/package-cache"

if [[ ! -r "/opt/ros/$ros_distro/setup.bash" ]]; then
  echo "ROS $ros_distro is not installed under /opt/ros/$ros_distro" >&2
  exit 1
fi

install -d -m 700 "$install_dir" "$user_root" "$cache_dir"
if [[ "$script_dir/start-foxglove.sh" != "$install_dir/start-foxglove.sh" ]]; then
  install -m 700 "$script_dir/start-foxglove.sh" "$install_dir/start-foxglove.sh"
fi

cd "$cache_dir"
rm -f -- "ros-$ros_distro-foxglove-bridge"_*.deb "ros-$ros_distro-rosx-introspection"_*.deb
apt-get download "ros-$ros_distro-foxglove-bridge" "ros-$ros_distro-rosx-introspection"
for package in ./*.deb; do
  dpkg-deb --extract "$package" "$user_root"
done

"$install_dir/start-foxglove.sh"
echo "Foxglove Bridge is ready on local-only port 8765 (user install)."
