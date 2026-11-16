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
  formats: call("formats"),
  download: call("download"),
  addFile: call("add-file"),
  pause: call("pause"),
  resume: call("resume"),
  pauseAll: call("pause-all"),
  resumeAll: call("resume-all"),
  cancel: call("cancel"),
  remove: call("remove"),
  clear: call("clear"),
  openFile: call("open-file"),
  reveal: call("reveal"),
  openFolder: call("open-folder"),
  windowAction: call("window"),
  openChrome: call("extension:open-chrome"),
  copyExtensionPath: call("extension:copy-path"),
  showExtensionFolder: call("extension:show-folder"),
  onExtension: on("extension"),
  onDownloads: on("downloads"),
  onSettings: on("settings"),
  onFocus: on("focus-download"),
  onWindow: on("window"),
});
