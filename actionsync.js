/**
 * ActionSync - Synchronize user actions across devices
 * A JavaScript module for real-time action synchronization
 */
export default class ActionSync {
  constructor(options = {}) {
    this.serverUrl = options.serverUrl;
    this.deviceId = options.deviceId || this._generateDeviceId();
    this.autoSync = options.autoSync !== undefined ? options.autoSync : true;
    this.syncInterval = options.syncInterval || 30000;
    this.maxQueueSize = options.maxQueueSize || 1000;
    this.retryAttempts = options.retryAttempts || 3;
    this.debug = options.debug || false;
    this.onRemoteActions = options.onRemoteActions || null; // Callback for auto sync
    this.enablePersistence = options.enablePersistence !== undefined ? options.enablePersistence : true;

    // Internal state
    this.actionQueue = [];
    this.lastExportQueue = []; // Backup of last exported queue
    this.lastActionId = '0';
    this.actionIdCounter = 0;
    this.syncTimer = null;
    this.storageKey = `actionsync_${this.deviceId}`;

    // Load persisted state if available
    this._initializationPromise = this._loadFromStorage().then(() => {
      if (this.autoSync && this.serverUrl) {
        this._startAutoSync();
      }
    });

    this._log('ActionSync initialized', { deviceId: this.deviceId });
  }

  /**
   * Check if all actions are synced (no pending actions in queue)
   * @returns {boolean} True if synced, false if there are queued actions
   */
  isSynced() {
    return this.actionQueue.length === 0;
  }

  /**
   * Wait for initialization to complete
   * @returns {Promise<void>} Promise that resolves when initialization is complete
   */
  async waitForInitialization() {
    return this._initializationPromise || Promise.resolve();
  }

  /**
   * Dispatch an action with unique 64-bit ID
   * @param {Object} action - The action object to dispatch
   * @returns {string} The generated unique action ID
   */
  dispatch(action) {
    if (!action || typeof action !== 'object') {
      throw new Error('Action must be a valid object');
    }

    const actionId = this._generateActionId();
    const timestamp = Date.now();
    
    const enhancedAction = {
      actionId,
      timestamp,
      deviceId: this.deviceId,
      payload: { ...action }
    };

    this.actionQueue.push(enhancedAction);
    this._enforceQueueSize();
    
    // Persist changes to storage
    this._saveToStorage();
    
    this._log('Action dispatched', { actionId, action });
    
    if (this.autoSync && this.serverUrl) {
      // Debounced auto-sync
      this._scheduleSync();
    }

    return actionId;
  }

  /**
   * Synchronize with remote server
   * @returns {Promise<Object>} Sync result with remote action payloads
   */
  async sync() {
    if (!this.serverUrl) {
      throw new Error('Server URL not configured');
    }

    try {
      const payload = {
        deviceId: this.deviceId,
        lastActionId: this.lastActionId,
        actions: this.actionQueue
      };

      const response = await this._fetchWithRetry('/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Sync failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      const remotePayloads = this._processRemoteActions(result.actions || []);
      
      if (result.lastActionId) {
        this.lastActionId = result.lastActionId;
      }

      // Clear successfully synced actions
      this.actionQueue = [];

      // Persist changes to storage
      this._saveToStorage();

      this._log('Sync completed', { 
        remotePayloadsCount: remotePayloads.length,
        lastActionId: this.lastActionId 
      });

      return {
        success: true,
        remotePayloads,
        lastActionId: this.lastActionId
      };

    } catch (error) {
      this._log('Sync failed', { error: error.message });
      throw this._createSyncError(error);
    }
  }

  /**
   * Export action queue as JSON string and clear the queue
   * @returns {string} JSON representation of actions
   */
  export() {
    // Save current queue as backup
    this.lastExportQueue = [...this.actionQueue];

    const exportData = {
      deviceId: this.deviceId,
      timestamp: Date.now(),
      actions: this.actionQueue,
      lastActionId: this.lastActionId
    };

    const jsonString = JSON.stringify(exportData, null, 2);
    
    // Clear the queue after export
    this.actionQueue = [];
    
    // Persist changes to storage
    this._saveToStorage();
    
    this._log('Actions exported and queue cleared', { count: this.lastExportQueue.length });
    
    return jsonString;
  }

  /**
   * Re-export the last exported queue
   * @returns {string} JSON representation of last exported actions
   */
  reexportLast() {
    if (this.lastExportQueue.length === 0) {
      throw new Error('No previous export to re-export');
    }

    const exportData = {
      deviceId: this.deviceId,
      timestamp: Date.now(),
      actions: this.lastExportQueue,
      lastActionId: this.lastActionId
    };

    const jsonString = JSON.stringify(exportData, null, 2);
    this._log('Last export re-exported', { count: this.lastExportQueue.length });
    
    return jsonString;
  }

  /**
   * Import actions from JSON string
   * @param {string} jsonString - JSON data from export()
   * @returns {Array} Array of action payloads to apply
   */
  import(jsonString) {
    try {
      const importData = JSON.parse(jsonString);
      
      if (!importData.actions || !Array.isArray(importData.actions)) {
        throw new Error('Invalid import data: missing or invalid actions array');
      }

      // Extract payloads from imported actions, sorted by timestamp
      const sortedActions = importData.actions.sort((a, b) => a.timestamp - b.timestamp);
      const payloads = sortedActions.map(action => action.payload);
      
      if (importData.lastActionId && importData.lastActionId > this.lastActionId) {
        this.lastActionId = importData.lastActionId;
      }

      this._log('Actions imported', { 
        payloadCount: payloads.length,
        fromDevice: importData.deviceId 
      });

      return payloads;

    } catch (error) {
      this._log('Import failed', { error: error.message });
      throw new Error(`Import failed: ${error.message}`);
    }
  }

  /**
   * Export actions to clipboard and clear the queue
   * @returns {Promise<boolean>} Success status
   */
  async exportToClipboard() {
    try {
      if (!navigator.clipboard) {
        throw new Error('Clipboard API not available');
      }

      const exportData = this.export(); // This will clear the queue
      await navigator.clipboard.writeText(exportData);
      
      this._log('Actions exported to clipboard and queue cleared');
      return true;

    } catch (error) {
      this._log('Clipboard export failed', { error: error.message });
      throw new Error(`Clipboard export failed: ${error.message}`);
    }
  }

  /**
   * Import actions from clipboard
   * @returns {Promise<Array>} Array of action payloads to apply
   */
  async importFromClipboard() {
    try {
      if (!navigator.clipboard) {
        throw new Error('Clipboard API not available');
      }

      const clipboardText = await navigator.clipboard.readText();
      
      if (!clipboardText.trim()) {
        throw new Error('Clipboard is empty');
      }

      const payloads = this.import(clipboardText);
      this._log('Actions imported from clipboard');
      
      return payloads;

    } catch (error) {
      this._log('Clipboard import failed', { error: error.message });
      throw new Error(`Clipboard import failed: ${error.message}`);
    }
  }

  /**
   * Get current queue status
   * @returns {Object} Queue information
   */
  getStatus() {
    return {
      deviceId: this.deviceId,
      queueLength: this.actionQueue.length,
      lastExportQueueLength: this.lastExportQueue.length,
      lastActionId: this.lastActionId,
      autoSync: this.autoSync,
      serverUrl: this.serverUrl,
      isSynced: this.isSynced()
    };
  }

  /**
   * Clear the action queue
   */
  clearQueue() {
    this.actionQueue = [];
    
    // Persist changes to storage
    this._saveToStorage();
    
    this._log('Action queue cleared');
  }

  /**
   * Destroy the instance and cleanup
   */
  destroy() {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
    this.actionQueue = [];
    this.lastExportQueue = [];
    
    // Clear storage on destroy
    this._clearStorage();
    
    this._log('ActionSync destroyed');
  }

  // Private methods

  /**
   * Check if Chrome storage is available
   * @returns {boolean} True if Chrome storage is available
   */
  _isChromeStorageAvailable() {
    return typeof chrome !== 'undefined' && 
           chrome.storage && 
           chrome.storage.local &&
           this.enablePersistence;
  }

  /**
   * Load state from Chrome storage
   * @returns {Promise<void>}
   */
  async _loadFromStorage() {
    if (!this._isChromeStorageAvailable()) {
      return;
    }

    try {
      const result = await new Promise((resolve, reject) => {
        chrome.storage.local.get([this.storageKey], (result) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(result);
          }
        });
      });

      const storedData = result[this.storageKey];
      if (storedData) {
        this.actionQueue = storedData.actionQueue || [];
        this.lastExportQueue = storedData.lastExportQueue || [];
        this.lastActionId = storedData.lastActionId || '0';
        this.actionIdCounter = storedData.actionIdCounter || 0;
        
        this._log('State loaded from storage', { 
          queueLength: this.actionQueue.length,
          lastExportQueueLength: this.lastExportQueue.length 
        });
      }
    } catch (error) {
      this._log('Failed to load from storage', { error: error.message });
    }
  }

  /**
   * Save state to Chrome storage
   * @returns {Promise<void>}
   */
  async _saveToStorage() {
    if (!this._isChromeStorageAvailable()) {
      return;
    }

    try {
      const dataToStore = {
        actionQueue: this.actionQueue,
        lastExportQueue: this.lastExportQueue,
        lastActionId: this.lastActionId,
        actionIdCounter: this.actionIdCounter,
        timestamp: Date.now()
      };

      await new Promise((resolve, reject) => {
        chrome.storage.local.set({ [this.storageKey]: dataToStore }, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      });

      this._log('State saved to storage', { 
        queueLength: this.actionQueue.length,
        lastExportQueueLength: this.lastExportQueue.length 
      });
    } catch (error) {
      this._log('Failed to save to storage', { error: error.message });
    }
  }

  /**
   * Clear storage data
   * @returns {Promise<void>}
   */
  async _clearStorage() {
    if (!this._isChromeStorageAvailable()) {
      return;
    }

    try {
      await new Promise((resolve, reject) => {
        chrome.storage.local.remove([this.storageKey], () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      });

      this._log('Storage cleared');
    } catch (error) {
      this._log('Failed to clear storage', { error: error.message });
    }
  }

  /**
   * Generate a 64-bit unique action ID with timestamp in leftmost bits
   * @returns {string} Unique action ID
   */
  _generateActionId() {
    const timestamp = Date.now();
    const counter = (this.actionIdCounter++) & 0xFFFF; // 16-bit counter
    
    // Combine 48-bit timestamp + 16-bit counter for 64-bit ID
    const high32 = Math.floor(timestamp / 0x10000); // Upper 32 bits of timestamp
    const low32 = ((timestamp & 0xFFFF) << 16) | counter; // Lower 16 bits of timestamp + counter
    
    return `${high32.toString(16).padStart(8, '0')}${low32.toString(16).padStart(8, '0')}`;
  }

  /**
   * Generate a unique device ID
   * @returns {string} Device identifier
   */
  _generateDeviceId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 9);
    return `device-${timestamp}-${random}`;
  }

  /**
   * Process remote actions and return only payloads
   * @param {Array} remoteActions - Actions from server
   * @returns {Array} Array of payloads for user to apply
   */
  _processRemoteActions(remoteActions) {
    if (!Array.isArray(remoteActions) || remoteActions.length === 0) {
      return [];
    }

    // Sort by timestamp and extract payloads
    const sortedActions = remoteActions.sort((a, b) => a.timestamp - b.timestamp);
    const payloads = sortedActions.map(action => action.payload);

    this._log('Remote actions processed', { count: payloads.length });
    
    // Call user callback for auto sync if provided
    if (this.onRemoteActions && typeof this.onRemoteActions === 'function') {
      try {
        this.onRemoteActions(payloads);
      } catch (error) {
        this._log('User callback error', { error: error.message });
      }
    }

    return payloads;
  }

  /**
   * Enforce maximum queue size
   */
  _enforceQueueSize() {
    if (this.actionQueue.length > this.maxQueueSize) {
      const removed = this.actionQueue.splice(0, this.actionQueue.length - this.maxQueueSize);
      
      // Persist changes if items were removed
      if (removed.length > 0) {
        this._saveToStorage();
      }
      
      this._log('Queue size enforced', { 
        removed: removed.length, 
        remaining: this.actionQueue.length 
      });
    }
  }

  /**
   * Start automatic synchronization
   */
  _startAutoSync() {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
    }
    
    this.syncTimer = setTimeout(() => {
      this.sync().catch(error => {
        this._log('Auto-sync failed', { error: error.message });
      }).finally(() => {
        if (this.autoSync) {
          this._startAutoSync();
        }
      });
    }, this.syncInterval);
  }

  /**
   * Schedule a sync with debouncing
   */
  _scheduleSync() {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
    }
    
    this.syncTimer = setTimeout(() => {
      this.sync().catch(error => {
        this._log('Scheduled sync failed', { error: error.message });
      });
    }, 1000); // 1 second debounce
  }

  /**
   * Fetch with retry logic
   * @param {string} endpoint - API endpoint
   * @param {Object} options - Fetch options
   * @returns {Promise<Response>} Fetch response
   */
  async _fetchWithRetry(endpoint, options) {
    let lastError;
    
    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        const url = `${this.serverUrl}${endpoint}`;
        const response = await fetch(url, options);
        return response;
      } catch (error) {
        lastError = error;
        this._log(`Fetch attempt ${attempt} failed`, { error: error.message });
        
        if (attempt < this.retryAttempts) {
          await this._delay(Math.pow(2, attempt) * 1000); // Exponential backoff
        }
      }
    }
    
    throw lastError;
  }

  /**
   * Create a structured sync error
   * @param {Error} originalError - Original error
   * @returns {Error} Structured error
   */
  _createSyncError(originalError) {
    const message = originalError?.message || 'Unknown sync error';
    const error = new Error(message);
    
    if (originalError?.name === 'TypeError' && message.includes('fetch')) {
      error.code = 'NETWORK_ERROR';
    } else if (message.includes('Sync failed:')) {
      error.code = 'INVALID_RESPONSE';
    } else {
      error.code = 'UNKNOWN_ERROR';
    }
    
    return error;
  }

  /**
   * Utility delay function
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise} Delay promise
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Debug logging
   * @param {string} message - Log message
   * @param {Object} data - Additional data
   */
  _log(message, data = {}) {
    if (this.debug) {
      console.log(`[ActionSync] ${message}`, data);
    }
  }
} 