import { supabase } from './supabase';

let queue = [];
let listeners = [];

// Cargar cola respaldada en localStorage para persistencia tras recargas del navegador
try {
  const savedQueue = localStorage.getItem('sheets_sync_queue');
  if (savedQueue) {
    queue = JSON.parse(savedQueue);
  }
} catch (e) {
  console.error('Error al cargar la cola de sincronización:', e);
}

const saveQueue = () => {
  try {
    localStorage.setItem('sheets_sync_queue', JSON.stringify(queue));
  } catch (e) {
    console.error('Error al guardar la cola de sincronización:', e);
  }
};

const notifyListeners = (event, data) => {
  listeners.forEach((cb) => {
    try {
      cb(event, data);
    } catch (e) {
      console.error('Error en listener de sincronización:', e);
    }
  });
};

export const sheetSyncService = {
  getQueueLength() {
    return queue.length;
  },

  getQueue() {
    return [...queue];
  },

  getDriveFolderId() {
    return localStorage.getItem('drive_folder_id') || '';
  },

  saveDriveFolderId(folderId) {
    if (folderId && folderId.trim()) {
      localStorage.setItem('drive_folder_id', folderId.trim());
    } else {
      localStorage.removeItem('drive_folder_id');
    }
  },

  async syncImportFromDrive(folderIdOrUrl) {
    const payload = {};
    const target = (folderIdOrUrl || '').trim();
    if (target) {
      if (target.includes('/d/')) {
        payload.url = target;
      } else {
        payload.folder_id = target;
      }
    } else {
      const savedFolder = this.getDriveFolderId();
      if (savedFolder) {
        if (savedFolder.includes('/d/')) {
          payload.url = savedFolder;
        } else {
          payload.folder_id = savedFolder;
        }
      }
    }

    const { data, error } = await supabase.functions.invoke('import-sheet', {
      body: payload
    });

    if (error) {
      let errMsg = error.message;
      if (error.context) {
        try {
          const bodyJson = await error.context.json();
          if (bodyJson?.error) {
            errMsg = bodyJson.error;
          }
        } catch (_) {}
      }
      throw new Error(errMsg);
    }

    if (data?.error) {
      throw new Error(data.error);
    }

    return data;
  },

  subscribe(callback) {
    listeners.push(callback);
    // Retornar función para desuscribirse
    return () => {
      listeners = listeners.filter((cb) => cb !== callback);
    };
  },

  _isAutoSyncing: false,

  async addToQueue(record) {
    // Capturar el spreadsheet_id activo al momento de agregarse a la cola
    const activeSpreadsheetId = localStorage.getItem('active_spreadsheet_id') || null;
    const enrichedRecord = {
      ...record,
      spreadsheet_id: record.spreadsheet_id || activeSpreadsheetId,
      codigo_temporal_origen: record.codigo_temporal_origen || null
    };

    // Añadir a la cola local en memoria y persistir en localStorage
    queue.push(enrichedRecord);
    saveQueue();
    
    notifyListeners('added', { 
      record: enrichedRecord, 
      queueLength: queue.length 
    });

    // Disparar chequeo centralizado en Supabase (global entre todos los operadores)
    this.checkAndTriggerAutoSync().catch((err) => {
      console.warn('Aviso en checkAndTriggerAutoSync:', err);
    });
  },

  // Consulta centralizada en Supabase: si entre todos los dispositivos suman 10 o más pendientes
  async checkAndTriggerAutoSync() {
    if (this._isAutoSyncing) return;
    try {
      const { count, error } = await supabase
        .from('registros_importacion')
        .select('id', { count: 'exact', head: true })
        .eq('is_verified', true)
        .is('last_sync', null);

      if (error) {
        console.warn('Aviso consultando pendientes en Supabase para autosync:', error.message);
        return;
      }

      console.log(`[sheetSyncService] Conteo global de verificados pendientes de sincronizar: ${count}`);

      // Si el conteo global en Supabase alcanza o supera 10, inyectar automáticamente
      if (count !== null && count >= 10) {
        this._isAutoSyncing = true;
        await this.syncPendingBatchToDrive();
      }
    } catch (err) {
      console.warn('Error en checkAndTriggerAutoSync:', err);
    } finally {
      this._isAutoSyncing = false;
    }
  },

  // Inyecta el lote de pendientes a Google Drive y actualiza last_sync en Supabase
  async syncPendingBatchToDrive() {
    notifyListeners('syncing', { queueLength: queue.length });

    try {
      // 1. Invocar automáticamente la Edge Function write-verification con { sync_all_pending: true }
      // Asegurando el reenvío de codigo_temporal_origen para la trazabilidad de reetiquetado
      const { data, error } = await supabase.functions.invoke('write-verification', {
        body: { 
          sync_all_pending: true,
          records: queue.map((item) => ({
            id: item.id,
            colada: item.colada,
            coil: item.coil,
            sheet_name: item.sheet_name,
            row_number: item.row_number,
            is_verified: item.is_verified,
            verified_by: item.verified_by,
            verified_at: item.verified_at,
            codigo_temporal_origen: item.codigo_temporal_origen || null
          }))
        }
      });

      if (error) {
        let errMsg = error.message;
        if (error.context) {
          try {
            const bodyJson = await error.context.json();
            if (bodyJson?.error) errMsg = bodyJson.error;
          } catch (_) {}
        }
        throw new Error(errMsg);
      }

      // 2. Actualizar en Supabase last_sync = NOW() para todas las filas verificadas pendientes
      const nowIso = new Date().toISOString();
      try {
        await supabase
          .from('registros_importacion')
          .update({
            last_sync: nowIso,
            updated_at: nowIso
          })
          .eq('is_verified', true)
          .is('last_sync', null);
      } catch (dbErr) {
        console.warn('Aviso no crítico al actualizar last_sync en Supabase tras sync a Drive:', dbErr);
      }

      // 3. Limpiar cola local sincronizada
      const syncedIds = queue.map((item) => item.id);
      queue = [];
      saveQueue();

      notifyListeners('synced', { 
        syncedIds,
        queueLength: 0,
        count: data?.count || 0
      });

      return { success: true, count: data?.count || 0 };
    } catch (e) {
      console.warn('Aviso en sincronización automática centralizada hacia Drive:', e.message);
      return { success: false, error: e.message };
    }
  },

  async flushQueue() {
    return this.syncPendingBatchToDrive();
  },

  // Finalizar turno: Fuerza la inyección de todos los pendientes en Supabase a Google Drive
  async finalizeShiftSync() {
    return this.syncPendingBatchToDrive();
  }
};
