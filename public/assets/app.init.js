// LiveNew init shim. Keep this file minimal.
// verify-assets expects app.init to import ONLY bootstrapApp from app.core.
import { bootstrapApp } from "./app.core.js";
bootstrapApp();
