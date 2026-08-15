/**
 * deepshui-translator - 许可协议窗口（v2.4.1）
 * 首次启动时显示：勾选同意后才能进入主界面；点「退出」或直接关窗则退出程序。
 */

window.addEventListener('DOMContentLoaded', () => {
  const checkbox = document.getElementById('license-agree');
  const acceptBtn = document.getElementById('btn-license-accept');
  const declineBtn = document.getElementById('btn-license-decline');
  const versionEl = document.getElementById('license-version');

  // 标题栏显示版本号
  (async () => {
    try {
      const v = await window.deepshui.getAppVersion();
      if (v && versionEl) versionEl.textContent = 'v' + v;
    } catch { /* 忽略 */ }
  })();

  // 「接受」需先勾选同意
  const sync = () => { acceptBtn.disabled = !checkbox.checked; };
  checkbox.addEventListener('change', sync);
  sync();

  let busy = false;

  acceptBtn.addEventListener('click', async () => {
    if (busy || !checkbox.checked) return;
    busy = true;
    acceptBtn.disabled = true;
    acceptBtn.textContent = '正在进入...';
    try {
      await window.deepshui.licenseAccept();
    } catch {
      busy = false;
      acceptBtn.textContent = '接受';
      sync();
    }
  });

  declineBtn.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    declineBtn.disabled = true;
    try {
      await window.deepshui.licenseDecline();
    } catch { /* 主进程退出时 IPC 可能中断，忽略 */ }
    window.close();
  });
});
