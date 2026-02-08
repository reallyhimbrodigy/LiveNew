import { bootstrapApp } from "./app.core.202602082317-60c1044.js";

function shouldAutoBoot() {
  return (
    typeof window !== "undefined" &&
    typeof document !== "undefined" &&
    !globalThis.__LIVENEW_NO_AUTOBOOT__
  );
}

if (shouldAutoBoot()) {
  bootstrapApp().catch((err) => console.error(err));
}

export { bootstrapApp };
