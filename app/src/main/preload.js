const { contextBridge, ipcRenderer } = require("electron");

const call = (name) => (...args) => ipcRenderer.invoke(name, ...args);
const on = (channel) => (cb) => {
  const fn = (_e, data) => cb(data);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld("downy", {
  state: call("state"),
  setSettings: call("settings:set"),
  chooseFolder: call("settings:choose-folder"),
  recheckTools: call("tools:recheck"),
  installTools: call("tools:install"),
  onInstall: on("install"),
  formats: call("formats"),
  download: call("download"),
  checkClip: call("clip:check"),
  addFile: call("add-file"),
  checkFile: call("file:check"),
  pause: call("pause"),
  resume: call("resume"),
  pauseAll: call("pause-all"),
  resumeAll: call("resume-all"),
  cancel: call("cancel"),
  remove: call("remove"),
  move: call("move"),
  moveToTop: call("move-to-top"),
  startBatch: call("batch:start"),
  pauseBatch: call("batch:pause"),
  resumeBatch: call("batch:resume"),
  retryBatch: call("batch:retry"),
  cancelBatch: call("batch:cancel"),
  dismissBatch: call("batch:dismiss"),
  clear: call("clear"),
  openFile: call("open-file"),
  reveal: call("reveal"),
  openFolder: call("open-folder"),
  windowAction: call("window"),
  openChrome: call("extension:open-chrome"),
  copyExtensionPath: call("extension:copy-path"),
  showExtensionFolder: call("extension:show-folder"),
  checkUpdate: call("update:check"),
  restartToUpdate: call("update:restart"),
  onUpdate: on("update"),
  // The confirm window (prompt.html).
  promptGet: call("prompt:get"),
  promptChooseFolder: call("prompt:choose-folder"),
  promptSubmit: call("prompt:submit"),
  promptCancel: call("prompt:cancel"),
  promptSize: (h) => ipcRenderer.send("prompt:size", h),
  promptBatch: call("prompt:batch"),
  promptRemove: call("prompt:remove"),
  promptClip: call("prompt:clip"),
  onPrompt: on("prompt:update"),
  onExtension: on("extension"),
  onDownloads: on("downloads"),
  onSettings: on("settings"),
  onFocus: on("focus-download"),
  onWindow: on("window"),
});
