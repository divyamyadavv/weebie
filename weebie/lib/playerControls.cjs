function formatTime(seconds) {
  const value = Number(seconds);
  const totalSeconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  const pad = value => String(value).padStart(2, "0");

  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(remainingSeconds)}`;
  return `${minutes}:${pad(remainingSeconds)}`;
}

function clampSeek(current, delta, duration) {
  const start = Number.isFinite(Number(current)) ? Number(current) : 0;
  const change = Number.isFinite(Number(delta)) ? Number(delta) : 0;
  const target = Math.max(0, start + change);
  const end = Number(duration);
  return Number.isFinite(end) && end >= 0 ? Math.min(target, end) : target;
}

module.exports = { clampSeek, formatTime };
