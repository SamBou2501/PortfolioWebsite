// Live clock for the taskbar. Updates every second.

(() => {
  const timeEl = document.getElementById("clock-time");
  const dateEl = document.getElementById("clock-date");
  if (!timeEl || !dateEl) return;

  const pad = (n) => String(n).padStart(2, "0");

  const tick = () => {
    const now = new Date();
    timeEl.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    dateEl.textContent = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
  };

  tick();
  setInterval(tick, 1000);
})();
