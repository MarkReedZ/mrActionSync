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
    this.actionQueue = []; // Pending actions not yet synced
    this.fullQueue = []; // All finalized actions that have been synced
    this.lastActionId = '0';
    this.actionIdCounter = 0;
    this.syncTimer = null;
    this.storageKey = `actionsync_${this.deviceId}`;
    this.fullQueueStorageKey = `actionsync_full_${this.deviceId}`;

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
   * @param {Array<string>} filterKeys - Keys to use for deduplication (removes matching actions from queue)
   * @returns {string} The generated unique action ID
   */
  dispatch(action, filterKeys = []) {
    if (!action || typeof action !== 'object') {
      throw new Error('Action must be a valid object');
    }

    if (!Array.isArray(filterKeys)) {
      throw new Error('filterKeys must be an array');
    }

    const actionId = this._generateActionId();
    const timestamp = Date.now();
    
    const enhancedAction = {
      actionId,
      timestamp,
      deviceId: this.deviceId,
      payload: { ...action }
    };

    // Apply filtering if filterKeys is provided and the new action contains all filter keys
    let removedCount = 0;
    if (filterKeys.length > 0 && this._actionContainsKeys(enhancedAction.payload, filterKeys)) {
      removedCount = this._removeMatchingActions(enhancedAction.payload, filterKeys);
    }

    this.actionQueue.push(enhancedAction);
    this._enforceQueueSize();
    
    // Persist changes to storage
    this._saveToStorage();
    
    this._log('Action dispatched', { 
      actionId, 
      action, 
      filterKeys: filterKeys.length > 0 ? filterKeys : undefined,
      removedDuplicates: removedCount || undefined
    });
    
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

      // Move successfully synced actions from actionQueue to fullQueue
      this.fullQueue.push(...this.actionQueue);
      this.actionQueue = [];

      // Enforce queue size for fullQueue
      this._enforceFullQueueSize();

      // Persist changes to storage (save both queues since fullQueue changed)
      await Promise.all([
        this._saveToStorage(),
        this._saveFullQueueToStorage()
      ]);

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
   * Export all actions (fullQueue + actionQueue) as JSON string
   * @returns {string} JSON representation of all actions
   */
  export() {
    // Combine fullQueue and actionQueue for complete export
    const allActions = [...this.fullQueue, ...this.actionQueue];

    const exportData = {
      deviceId: this.deviceId,
      timestamp: Date.now(),
      actions: allActions,
      lastActionId: this.lastActionId
    };

    const jsonString = JSON.stringify(exportData, null, 2);
    
    this._log('All actions exported', { 
      totalCount: allActions.length,
      fullQueueCount: this.fullQueue.length,
      actionQueueCount: this.actionQueue.length
    });
    
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
      fullQueueLength: this.fullQueue.length,
      totalActionsCount: this.fullQueue.length + this.actionQueue.length,
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
   * Clear the full queue (use with caution - this will remove sync history)
   */
  async clearFullQueue() {
    this.fullQueue = [];
    
    // Persist changes to storage
    await this._saveFullQueueToStorage();
    
    this._log('Full queue cleared');
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
    this.fullQueue = [];
    
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
      // Load both regular state and fullQueue in parallel
      const [regularResult, fullQueueResult] = await Promise.all([
        new Promise((resolve, reject) => {
          chrome.storage.local.get([this.storageKey], (result) => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else {
              resolve(result);
            }
          });
        }),
        new Promise((resolve, reject) => {
          chrome.storage.local.get([this.fullQueueStorageKey], (result) => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else {
              resolve(result);
            }
          });
        })
      ]);

      // Load regular state
      const storedData = regularResult[this.storageKey];
      if (storedData) {
        this.actionQueue = storedData.actionQueue || [];
        this.lastActionId = storedData.lastActionId || '0';
        this.actionIdCounter = storedData.actionIdCounter || 0;
      }

      // Load fullQueue separately
      const fullQueueData = fullQueueResult[this.fullQueueStorageKey];
      if (fullQueueData && fullQueueData.compressedFullQueue) {
        this.fullQueue = this._decompressData(fullQueueData.compressedFullQueue);
      } else {
        this.fullQueue = [];
      }
        
      this._log('State loaded from storage', { 
        queueLength: this.actionQueue.length,
        fullQueueLength: this.fullQueue.length
      });
    } catch (error) {
      this._log('Failed to load from storage', { error: error.message });
    }
  }

  /**
   * Save regular state to Chrome storage (excluding fullQueue)
   * @returns {Promise<void>}
   */
  async _saveToStorage() {
    if (!this._isChromeStorageAvailable()) {
      return;
    }

    try {
      const dataToStore = {
        actionQueue: this.actionQueue,
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
        queueLength: this.actionQueue.length
      });
    } catch (error) {
      this._log('Failed to save to storage', { error: error.message });
    }
  }

  /**
   * Save fullQueue to Chrome storage separately
   * @returns {Promise<void>}
   */
  async _saveFullQueueToStorage() {
    if (!this._isChromeStorageAvailable()) {
      return;
    }

    try {
      const dataToStore = {
        compressedFullQueue: this._compressData(this.fullQueue),
        timestamp: Date.now()
      };

      await new Promise((resolve, reject) => {
        chrome.storage.local.set({ [this.fullQueueStorageKey]: dataToStore }, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      });

      this._log('FullQueue saved to storage', { 
        fullQueueLength: this.fullQueue.length
      });
    } catch (error) {
      this._log('Failed to save fullQueue to storage', { error: error.message });
    }
  }

  /**
   * Clear storage data (both regular and fullQueue storage)
   * @returns {Promise<void>}
   */
  async _clearStorage() {
    if (!this._isChromeStorageAvailable()) {
      return;
    }

    try {
      await new Promise((resolve, reject) => {
        chrome.storage.local.remove([this.storageKey, this.fullQueueStorageKey], () => {
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
   * Enforce maximum full queue size (keep only recent actions)
   */
  _enforceFullQueueSize() {
    const maxFullQueueSize = this.maxQueueSize * 5; // Allow fullQueue to be 5x larger
    if (this.fullQueue.length > maxFullQueueSize) {
      const removed = this.fullQueue.splice(0, this.fullQueue.length - maxFullQueueSize);
      
      this._log('Full queue size enforced', { 
        removed: removed.length, 
        remaining: this.fullQueue.length 
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
   * Compress data using simple string compression (can be enhanced with actual compression libraries)
   * @param {Array} data - Data to compress
   * @returns {string} Compressed data
   */
  _compressData(data) {
    // For now, use JSON.stringify as basic compression
    // In production, you might want to use actual compression libraries like pako
    return JSON.stringify(data);
  }

  /**
   * Decompress data
   * @param {string} compressedData - Compressed data
   * @returns {Array} Decompressed data
   */
  _decompressData(compressedData) {
    try {
      return JSON.parse(compressedData);
    } catch (error) {
      this._log('Failed to decompress data', { error: error.message });
      return [];
    }
  }

  /**
   * Check if an action payload contains all the specified keys
   * @param {Object} payload - Action payload to check
   * @param {Array<string>} keys - Keys that must be present
   * @returns {boolean} True if all keys are present
   */
  _actionContainsKeys(payload, keys) {
    return keys.every(key => payload.hasOwnProperty(key));
  }

  /**
   * Remove actions from actionQueue that match the new action on all filter keys
   * @param {Object} newPayload - Payload of the new action
   * @param {Array<string>} filterKeys - Keys to match on
   * @returns {number} Number of actions removed
   */
  _removeMatchingActions(newPayload, filterKeys) {
    const initialLength = this.actionQueue.length;
    
    this.actionQueue = this.actionQueue.filter(existingAction => {
      // Keep actions that don't match ALL filter key values
      return !filterKeys.every(key => 
        existingAction.payload.hasOwnProperty(key) &&
        existingAction.payload[key] === newPayload[key]
      );
    });
    
    const removedCount = initialLength - this.actionQueue.length;
    if (removedCount > 0) {
      this._log('Filtered duplicate actions', { removedCount, filterKeys });
    }
    
    return removedCount;
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