#!/usr/bin/env bash
set -euo pipefail

state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/kian-remote-lab"
pid_file="$state_dir/foxglove-bridge.pid"
log_file="$state_dir/foxglove-bridge.log"
mkdir -p "$state_dir"

if [[ -f "$pid_file" ]]; then
  old_pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [[ "$old_pid" =~ ^[0-9]+$ ]] && kill -0 "$old_pid" 2>/dev/null; then
    exit 0
  fi
  rm -f "$pid_file"
fi

ros_distro="${ROS_DISTRO:-humble}"
ros_setup="/opt/ros/$ros_distro/setup.bash"
if [[ ! -r "$ros_setup" ]]; then
  echo "ROS setup not found: $ros_setup" >&2
  exit 20
fi
# ROS environment hooks commonly read unset variables, so nounset must be
# disabled only while sourcing them.
set +u
# shellcheck disable=SC1090
source "$ros_setup"
set -u

# setup-node-user.sh extracts the two visualization-only packages here when
# sudo is unavailable. Existing system ROS dependencies continue to come from
# /opt/ros.
user_ros_prefix="$HOME/.local/share/kian-remote-lab/ros-user/opt/ros/$ros_distro"
if [[ -d "$user_ros_prefix/share/ament_index" ]]; then
  export AMENT_PREFIX_PATH="$user_ros_prefix${AMENT_PREFIX_PATH:+:$AMENT_PREFIX_PATH}"
  export CMAKE_PREFIX_PATH="$user_ros_prefix${CMAKE_PREFIX_PATH:+:$CMAKE_PREFIX_PATH}"
  export LD_LIBRARY_PATH="$user_ros_prefix/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
  export PATH="$user_ros_prefix/bin${PATH:+:$PATH}"
fi

workspace_file="${XDG_CONFIG_HOME:-$HOME/.config}/kian-remote-lab/ros-workspace"
if [[ -r "$workspace_file" ]]; then
  workspace="$(head -n 1 "$workspace_file")"
  if [[ -r "$workspace/install/setup.bash" ]]; then
    # shellcheck disable=SC1090
    set +u
    source "$workspace/install/setup.bash"
    set -u
  fi
else
  for workspace in "$HOME/ros2_ws" "$HOME/dev_ws" "$HOME/robot_ws"; do
    if [[ -r "$workspace/install/setup.bash" ]]; then
      # shellcheck disable=SC1090
      set +u
      source "$workspace/install/setup.bash"
      set -u
      break
    fi
  done
fi

if ! ros2 pkg prefix foxglove_bridge >/dev/null 2>&1; then
  echo "foxglove_bridge is not installed for ROS $ros_distro" >&2
  exit 21
fi

nohup ros2 launch foxglove_bridge foxglove_bridge_launch.xml \
  address:=127.0.0.1 port:=8765 >"$log_file" 2>&1 </dev/null &
bridge_pid=$!
echo "$bridge_pid" >"$pid_file"

for _ in {1..50}; do
  if ! kill -0 "$bridge_pid" 2>/dev/null; then
    tail -n 20 "$log_file" >&2 || true
    rm -f "$pid_file"
    exit 22
  fi
  if (echo >/dev/tcp/127.0.0.1/8765) >/dev/null 2>&1; then
    exit 0
  fi
  sleep 0.1
done

echo "foxglove_bridge did not listen on 127.0.0.1:8765" >&2
exit 23
