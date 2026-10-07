// Live clock for the taskbar. Shows minutes, so it only updates on each
// minute boundary rather than every second.

(() => {
  const timeEl = document.getElementById("clock-time");
  const dateEl = document.getElementById("clock-date");
  if (!timeEl || !dateEl) return;

  const pad = (n) => String(n).padStart(2, "0");

  const tick = () => {
    const now = new Date();
    timeEl.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    dateEl.textContent = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
    // Re-arm for just after the next minute starts.
    setTimeout(tick, 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50);
  };

  tick();
})();
