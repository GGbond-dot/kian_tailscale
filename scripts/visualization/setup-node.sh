#!/usr/bin/env bash
set -euo pipefail

ros_distro="${ROS_DISTRO:-humble}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
install_dir="$HOME/.local/share/kian-remote-lab/visualization"

if [[ ! -r "/opt/ros/$ros_distro/setup.bash" ]]; then
  echo "ROS $ros_distro is not installed under /opt/ros/$ros_distro" >&2
  exit 1
fi

if ! dpkg-query -W -f='${Status}' "ros-$ros_distro-foxglove-bridge" 2>/dev/null | grep -q 'install ok installed'; then
  sudo apt-get update
  sudo apt-get install -y "ros-$ros_distro-foxglove-bridge"
fi

install -d -m 700 "$install_dir"
if [[ "$script_dir/start-foxglove.sh" != "$install_dir/start-foxglove.sh" ]]; then
  install -m 700 "$script_dir/start-foxglove.sh" "$install_dir/start-foxglove.sh"
fi
"$install_dir/start-foxglove.sh"
echo "Foxglove Bridge is ready on local-only port 8765."
