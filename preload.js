'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Secure bridge between renderer and main process.
// Renderer never touches Node directly.
contextBridge.exposeInMainWorld('nebula', {
  // ---- Auth ----
  register: (data) => ipcRenderer.invoke('auth:register', data),
  login: (data) => ipcRenderer.invoke('auth:login', data),
  getProfile: (userId) => ipcRenderer.invoke('auth:profile', userId),
  updateProfile: (data) => ipcRenderer.invoke('auth:updateProfile', data),

  // ---- Models ----
  listModels: () => ipcRenderer.invoke('models:list'),

  // ---- Chats ----
  listChats: (userId) => ipcRenderer.invoke('chats:list', userId),
  createChat: (data) => ipcRenderer.invoke('chats:create', data),
  getMessages: (chatId) => ipcRenderer.invoke('chats:messages', chatId),
  renameChat: (data) => ipcRenderer.invoke('chats:rename', data),
  deleteChat: (chatId) => ipcRenderer.invoke('chats:delete', chatId),

  // ---- Settings ----
  getSettings: (userId) => ipcRenderer.invoke('settings:get', userId),
  saveSettings: (data) => ipcRenderer.invoke('settings:save', data),

  // ---- Streaming chat ----
  // Returns a requestId; tokens arrive via onToken/onDone/onError.
  sendMessage: (payload) => ipcRenderer.invoke('chat:send', payload),
  onToken: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('chat:token', listener);
    return () => ipcRenderer.removeListener('chat:token', listener);
  },
  onDone: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('chat:done', listener);
    return () => ipcRenderer.removeListener('chat:done', listener);
  },
  onError: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('chat:error', listener);
    return () => ipcRenderer.removeListener('chat:error', listener);
  }
});
