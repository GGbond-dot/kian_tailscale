#[derive(Clone, Copy, Debug)]
pub(crate) struct DeviceProfile {
    pub(crate) id: &'static str,
    pub(crate) display_name: &'static str,
    pub(crate) role: &'static str,
    pub(crate) tailscale_hostname: &'static str,
    pub(crate) ssh_user: &'static str,
    pub(crate) ssh_port: u16,
    pub(crate) remote_folder: &'static str,
}

pub(crate) const DEVICES: [DeviceProfile; 3] = [
    DeviceProfile {
        id: "dk2500",
        display_name: "DK2500",
        role: "Linux Server",
        tailscale_hostname: "dk2500",
        ssh_user: "kian",
        ssh_port: 22,
        remote_folder: "/home/kian",
    },
    DeviceProfile {
        id: "desktop-5060",
        display_name: "Desktop 5060",
        role: "GPU / WSL2",
        tailscale_hostname: "desktop-ltuqmcm",
        ssh_user: "kian",
        ssh_port: 2222,
        remote_folder: "/home/kian",
    },
    DeviceProfile {
        id: "desktop-5060-windows",
        display_name: "Desktop 5060 Windows",
        role: "Windows / PowerShell",
        tailscale_hostname: "desktop-ltuqmcm",
        ssh_user: "kian",
        ssh_port: 2224,
        remote_folder: r"C:\Users\kian",
    },
];

pub(crate) fn profile(device_id: &str) -> Result<&'static DeviceProfile, String> {
    DEVICES
        .iter()
        .find(|device| device.id == device_id)
        .ok_or_else(|| "Unknown device identifier".to_string())
}
