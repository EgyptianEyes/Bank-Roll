import {APP_VERSION, APP_BUILD} from "../core/version.js";

for (const element of document.querySelectorAll("[data-app-version]")){
  element.textContent = `Version ${APP_VERSION} · Build ${APP_BUILD}`;
}