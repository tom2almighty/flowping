// Runs before the app so the first paint already has the right theme.
try {
  var t = localStorage.getItem("fp-theme");
  var dark = t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  if (dark) document.documentElement.classList.add("dark");
} catch (e) {}
