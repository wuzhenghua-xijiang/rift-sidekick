/** Read executable identity with limited access, including clients launched through UAC. */
export const WINDOWS_PROCESS_IDENTITY = String.raw`
public static class RiftProcessIdentity {
  [System.Runtime.InteropServices.DllImport("kernel32.dll")] private static extern System.IntPtr OpenProcess(uint access, bool inherit, int pid);
  [System.Runtime.InteropServices.DllImport("kernel32.dll")] private static extern bool CloseHandle(System.IntPtr handle);
  [System.Runtime.InteropServices.DllImport("kernel32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)] private static extern bool QueryFullProcessImageName(System.IntPtr process, uint flags, System.Text.StringBuilder path, ref int size);
  public static string PathFor(int pid) {
    var handle = OpenProcess(0x1000, false, pid);
    if (handle == System.IntPtr.Zero) return null;
    try {
      var path = new System.Text.StringBuilder(32768); int size = path.Capacity;
      return QueryFullProcessImageName(handle, 0, path, ref size) ? path.ToString() : null;
    } finally { CloseHandle(handle); }
  }
}
`
