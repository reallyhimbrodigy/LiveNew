// LiveNew init shim (must remain minimal).
// verify-assets requires app.init to import ONLY bootstrapApp from app.core.
import { bootstrapApp } from "./app.core.js";
bootstrapApp();
