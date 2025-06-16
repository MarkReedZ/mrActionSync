/**
 * ActionSync Simple - Synchronize user actions across devices (No Device IDs)
 * A minimal JavaScript module for action synchronization
 */
export default class ActionSyncSimple {
  constructor(options = {}) {
    this.serverUrl = options.serverUrl;
    this.autoSync = options.autoSync !== undefined ? options.autoSync : true;
    this.syncInterval = options.syncInterval || 30000;
    this.maxQueueSize = options.maxQueueSize || 1000;
    this.retryAttempts = options.retryAttempts || 3;
    this.debug = options.debug || false;

    // Internal state
    this.actionQueue = [];
    this.lastActionId = '0';
    this.actionIdCounter = 0;
    this.syncTimer = null;

    if (this.autoSync && this.serverUrl) {
      this._startAutoSync();
    }

    this._log('ActionSync initialized');
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
      payload: { ...action }
    };

    this.actionQueue.push(enhancedAction);
    this._enforceQueueSize();
    
    this._log('Action dispatched', { actionId, action });
    
    if (this.autoSync && this.serverUrl) {
      this._scheduleSync();
    }

    return actionId;
  }

  /**
   * Synchronize with remote server
   * @returns {Promise<Object>} Sync result
   */
  async sync() {
    if (!this.serverUrl) {
      throw new Error('Server URL not configured');
    }

    try {
      const payload = {
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
      const appliedActions = this._applyRemoteActions(result.actions || []);
      
      if (result.lastActionId) {
        this.lastActionId = result.lastActionId;
      }

      // Clear successfully synced actions
      this.actionQueue = [];

      this._log('Sync completed', { 
        appliedCount: appliedActions.length,
        lastActionId: this.lastActionId 
      });

      return {
        success: true,
        appliedActions,
        lastActionId: this.lastActionId
      };

    } catch (error) {
      this._log('Sync failed', { error: error.message });
      throw this._createSyncError(error);
    }
  }

  /**
   * Export action queue as JSON string
   * @returns {string} JSON representation of actions
   */
  export() {
    const exportData = {
      timestamp: Date.now(),
      actions: this.actionQueue,
      lastActionId: this.lastActionId
    };

    const jsonString = JSON.stringify(exportData, null, 2);
    this._log('Actions exported', { count: this.actionQueue.length });
    
    return jsonString;
  }

  /**
   * Import actions from JSON string
   * @param {string} jsonString - JSON data from export()
   * @returns {Object} Import result
   */
  import(jsonString) {
    try {
      const importData = JSON.parse(jsonString);
      
      if (!importData.actions || !Array.isArray(importData.actions)) {
        throw new Error('Invalid import data: missing or invalid actions array');
      }

      const importedActions = this._mergeActions(importData.actions);
      
      if (importData.lastActionId && importData.lastActionId > this.lastActionId) {
        this.lastActionId = importData.lastActionId;
      }

      this._log('Actions imported', { 
        importedCount: importedActions.length
      });

      return {
        success: true,
        importedCount: importedActions.length,
        timestamp: importData.timestamp
      };

    } catch (error) {
      this._log('Import failed', { error: error.message });
      throw new Error(`Import failed: ${error.message}`);
    }
  }

  /**
   * Export actions to clipboard
   * @returns {Promise<boolean>} Success status
   */
  async exportToClipboard() {
    try {
      if (!navigator.clipboard) {
        throw new Error('Clipboard API not available');
      }

      const exportData = this.export();
      await navigator.clipboard.writeText(exportData);
      
      this._log('Actions exported to clipboard');
      return true;

    } catch (error) {
      this._log('Clipboard export failed', { error: error.message });
      throw new Error(`Clipboard export failed: ${error.message}`);
    }
  }

  /**
   * Import actions from clipboard
   * @returns {Promise<Object>} Import result
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

      const result = this.import(clipboardText);
      this._log('Actions imported from clipboard');
      
      return result;

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
      queueLength: this.actionQueue.length,
      lastActionId: this.lastActionId,
      autoSync: this.autoSync,
      serverUrl: this.serverUrl
    };
  }

  /**
   * Clear the action queue
   */
  clearQueue() {
    this.actionQueue = [];
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
    this._log('ActionSync destroyed');
  }

  // Private methods

  /**
   * Generate a 64-bit unique action ID with timestamp in leftmost bits
   * @returns {string} Unique action ID
   */
  _generateActionId() {
    const timestamp = Date.now();
    const counter = (this.actionIdCounter++) & 0xFFFF; // 16-bit counter
    
    // Combine 48-bit timestamp + 16-bit counter for 64-bit ID
    const high32 = Math.floor(timestamp / 0x10000);
    const low32 = ((timestamp & 0xFFFF) << 16) | counter;
    
    return `${high32.toString(16).padStart(8, '0')}${low32.toString(16).padStart(8, '0')}`;
  }

  /**
   * Merge imported actions with existing queue
   * @param {Array} newActions - Actions to merge
   * @returns {Array} Successfully merged actions
   */
  _mergeActions(newActions) {
    const existingIds = new Set(this.actionQueue.map(a => a.actionId));
    const uniqueActions = newActions.filter(action => !existingIds.has(action.actionId));
    
    // Add unique actions and sort by timestamp
    this.actionQueue.push(...uniqueActions);
    this.actionQueue.sort((a, b) => a.timestamp - b.timestamp);
    
    this._enforceQueueSize();
    return uniqueActions;
  }

  /**
   * Apply remote actions received from sync
   * @param {Array} remoteActions - Actions from server
   * @returns {Array} Applied actions
   */
  _applyRemoteActions(remoteActions) {
    if (!Array.isArray(remoteActions) || remoteActions.length === 0) {
      return [];
    }

    const appliedActions = this._mergeActions(remoteActions);
    
    if (appliedActions.length > 0) {
      this._onActionsApplied(appliedActions);
    }

    return appliedActions;
  }

  /**
   * Event handler for when actions are applied
   * @param {Array} actions - Applied actions
   */
  _onActionsApplied(actions) {
    this._log('Actions applied', { count: actions.length });
  }

  /**
   * Enforce maximum queue size
   */
  _enforceQueueSize() {
    if (this.actionQueue.length > this.maxQueueSize) {
      const removed = this.actionQueue.splice(0, this.actionQueue.length - this.maxQueueSize);
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
    }, 1000);
  }

  /**
   * Fetch with retry logic
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
          await this._delay(Math.pow(2, attempt) * 1000);
        }
      }
    }
    
    throw lastError;
  }

  /**
   * Create a structured sync error
   */
  _createSyncError(originalError) {
    const error = new Error(originalError.message);
    
    if (originalError.name === 'TypeError' && originalError.message.includes('fetch')) {
      error.code = 'NETWORK_ERROR';
    } else if (originalError.message.includes('Sync failed:')) {
      error.code = 'INVALID_RESPONSE';
    } else {
      error.code = 'UNKNOWN_ERROR';
    }
    
    return error;
  }

  /**
   * Utility delay function
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Debug logging
   */
  _log(message, data = {}) {
    if (this.debug) {
      console.log(`[ActionSync] ${message}`, data);
    }
  }
} 