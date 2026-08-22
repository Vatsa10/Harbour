import { createRequire as __createRequire } from 'module';
const require = __createRequire(import.meta.url);

// twenty-sdk-define-stub:__twenty-sdk-define-stub__
var __defineFactoryStub = (config) => ({
  success: true,
  config,
  errors: []
});
var __anyHandler = {
  get(_target, prop) {
    if (prop === "__esModule") return true;
    if (prop === Symbol.toPrimitive) return () => "";
    if (typeof prop === "symbol") return void 0;
    return new Proxy(() => void 0, __anyHandler);
  },
  apply() {
    return new Proxy(() => void 0, __anyHandler);
  }
};
var __anyStub = new Proxy(() => void 0, __anyHandler);
var defineUninstallLogicFunction = __defineFactoryStub;

// src/constants/universal-identifiers.ts
var UNINSTALL_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER = "da17fcfa-1187-4b24-bb33-1b31f0a13c30";

// src/logic-functions/uninstall.ts
var handler = async (payload) => {
  console.log(
    "Uninstalling Customer Support \u2014 all tickets, queues, and their records will be removed. Company, Person, and WorkspaceMember records are untouched; only this app's relation fields on them are removed.",
    payload
  );
};
var uninstall_default = defineUninstallLogicFunction({
  universalIdentifier: UNINSTALL_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: "uninstall",
  description: "Logs the scope of teardown before Customer Support is removed.",
  timeoutSeconds: 60,
  handler
});
export {
  uninstall_default as default
};
//# sourceMappingURL=uninstall.mjs.map
